import "server-only";
import { and, asc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  branches,
  maintenanceBlocks,
  reservations,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
  fuelType,
  transmission,
  type Branch,
  type Vehicle,
  type VehicleCategory,
} from "@/lib/db/schema";
import { db, type Executor } from "./db";
import { parseInput, ServiceError } from "./errors";
import { dailyRateFor, loadActiveRules, rentalWindowSchema, validateRentalWindow } from "./pricing";
import { computeQuote } from "./pricing-core";
import { addDaysToDate, localDate, zonedDayStart } from "./time";

/** Vehicles in these statuses never appear in search (out of service). */
const UNRENTABLE = ["RETIRED", "MAINTENANCE"] as const;

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * SQL condition "this reservation row blocks the vehicle at `now`": confirmed / on rent, or a
 * PENDING hold that has not expired yet. Expired holds are ignored even before the cleanup job runs.
 */
export function blockingReservation(now: Date): SQL {
  return sql`(${reservations.status} IN ('CONFIRMED', 'PICKED_UP') OR (${reservations.status} = 'PENDING' AND ${reservations.holdExpiresAt} > ${ts(now)}))`;
}

/** SQL condition: vehicle has no blocking reservation / maintenance overlapping [from, to). */
export function vehicleFreeSql(from: Date, to: Date, now: Date, excludeReservationId?: string): SQL {
  const range = sql`tstzrange(${ts(from)}, ${ts(to)}, '[)')`;
  const exclude = excludeReservationId ? sql` AND ${reservations.id} <> ${excludeReservationId}` : sql``;
  return sql`NOT EXISTS (SELECT 1 FROM ${reservations} WHERE ${reservations.vehicleId} = ${vehicles.id}
      AND ${reservations.period} && ${range} AND ${blockingReservation(now)}${exclude})
    AND NOT EXISTS (SELECT 1 FROM ${maintenanceBlocks} WHERE ${maintenanceBlocks.vehicleId} = ${vehicles.id}
      AND ${maintenanceBlocks.cancelledAt} IS NULL AND ${maintenanceBlocks.period} && ${range})`;
}

export interface Feature {
  id: string;
  code: string;
  name: string;
}

async function featuresFor(ex: Executor, vehicleIds: string[]): Promise<Map<string, Feature[]>> {
  const map = new Map<string, Feature[]>();
  if (vehicleIds.length === 0) return map;
  const rows = await ex
    .select({ vehicleId: vehicleFeatureMap.vehicleId, id: vehicleFeatures.id, code: vehicleFeatures.code, name: vehicleFeatures.name })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, vehicleIds))
    .orderBy(asc(vehicleFeatures.name));
  for (const r of rows) {
    const list = map.get(r.vehicleId) ?? [];
    list.push({ id: r.id, code: r.code, name: r.name });
    map.set(r.vehicleId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchVehiclesInput = rentalWindowSchema.extend({
  categoryId: z.uuid().optional(),
  transmission: z.enum(transmission.enumValues).optional(),
  fuelType: z.enum(fuelType.enumValues).optional(),
  minSeats: z.number().int().min(1).max(15).optional(),
  minDailyRateFils: z.number().int().min(0).optional(),
  maxDailyRateFils: z.number().int().min(0).optional(),
  sort: z.enum(["price_asc", "price_desc", "seats_desc"]).default("price_asc"),
});
export type SearchVehiclesInput = z.input<typeof searchVehiclesInput>;

export interface SearchResult {
  vehicle: Vehicle;
  category: VehicleCategory;
  branch: Branch;
  features: Feature[];
  dailyRateFils: number;
  rentalDays: number;
  /** Base + one-way fee + VAT, without extras. */
  estimatedTotalFils: number;
  depositFils: number;
}

/** Vehicles at the pick-up branch that are free for the whole period and match every filter. */
export async function searchVehicles(input: SearchVehiclesInput, now: Date = new Date()): Promise<SearchResult[]> {
  const i = parseInput(searchVehiclesInput, input);
  const returnBranchId = i.returnBranchId ?? i.pickupBranchId;
  const branchRows = await db
    .select()
    .from(branches)
    .where(inArray(branches.id, [i.pickupBranchId, returnBranchId]));
  const pickupBranch = branchRows.find((b) => b.id === i.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === returnBranchId);
  if (!pickupBranch || !returnBranch) throw new ServiceError("NOT_FOUND", "Branch not found");
  validateRentalWindow(pickupBranch, returnBranch, i.pickupAt, i.returnAt, now);

  const conds: SQL[] = [
    eq(vehicles.branchId, i.pickupBranchId),
    notInArray(vehicles.status, [...UNRENTABLE]),
    vehicleFreeSql(i.pickupAt, i.returnAt, now),
  ];
  if (i.categoryId) conds.push(eq(vehicles.categoryId, i.categoryId));
  if (i.transmission) conds.push(eq(vehicles.transmission, i.transmission));
  if (i.fuelType) conds.push(eq(vehicles.fuelType, i.fuelType));
  if (i.minSeats) conds.push(sql`${vehicles.seats} >= ${i.minSeats}`);

  const rows = await db
    .select({ vehicle: vehicles, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(and(...conds));
  const rules = await loadActiveRules(db);
  const features = await featuresFor(
    db,
    rows.map((r) => r.vehicle.id),
  );
  const oneWayFeeFils = returnBranch.id === pickupBranch.id ? 0 : returnBranch.oneWayFeeFils;

  const results: SearchResult[] = [];
  for (const r of rows) {
    const daily = dailyRateFor(rules, r.vehicle, pickupBranch, i.pickupAt, i.returnAt);
    if (daily === undefined) continue; // unpriced vehicles cannot be booked
    if (i.minDailyRateFils !== undefined && daily < i.minDailyRateFils) continue;
    if (i.maxDailyRateFils !== undefined && daily > i.maxDailyRateFils) continue;
    const q = computeQuote({
      pickupAt: i.pickupAt,
      returnAt: i.returnAt,
      dailyRateFils: daily,
      extras: [],
      oneWayFeeFils,
      vatRateBp: pickupBranch.vatRateBp,
      depositFils: r.category.securityDepositFils,
    });
    results.push({
      vehicle: r.vehicle,
      category: r.category,
      branch: pickupBranch,
      features: features.get(r.vehicle.id) ?? [],
      dailyRateFils: daily,
      rentalDays: q.rentalDays,
      estimatedTotalFils: q.totalFils,
      depositFils: q.depositFils,
    });
  }
  results.sort((a, b) =>
    i.sort === "price_desc"
      ? b.dailyRateFils - a.dailyRateFils
      : i.sort === "seats_desc"
        ? b.vehicle.seats - a.vehicle.seats
        : a.dailyRateFils - b.dailyRateFils || a.vehicle.make.localeCompare(b.vehicle.make),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Single vehicle
// ---------------------------------------------------------------------------

export async function getVehicle(
  vehicleId: string,
): Promise<{ vehicle: Vehicle; category: VehicleCategory; branch: Branch; features: Feature[] } | null> {
  if (!z.uuid().safeParse(vehicleId).success) return null;
  const [row] = await db
    .select({ vehicle: vehicles, category: vehicleCategories, branch: branches })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, vehicleId));
  if (!row) return null;
  const features = await featuresFor(db, [vehicleId]);
  return { ...row, features: features.get(vehicleId) ?? [] };
}

/** True when the vehicle is rentable and nothing overlaps [pickupAt, returnAt). */
export async function isVehicleAvailable(
  vehicleId: string,
  pickupAt: Date,
  returnAt: Date,
  opts: { now?: Date; excludeReservationId?: string; ex?: Executor } = {},
): Promise<boolean> {
  const p = parseInput(z.object({ vehicleId: z.uuid(), pickupAt: z.date(), returnAt: z.date() }), {
    vehicleId,
    pickupAt,
    returnAt,
  });
  if (!(p.returnAt > p.pickupAt)) return false;
  const rows = await (opts.ex ?? db)
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, p.vehicleId),
        notInArray(vehicles.status, [...UNRENTABLE]),
        vehicleFreeSql(p.pickupAt, p.returnAt, opts.now ?? new Date(), opts.excludeReservationId),
      ),
    );
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type CalendarDayStatus = "available" | "partial" | "booked" | "maintenance";

export interface VehicleCalendar {
  vehicleId: string;
  timeZone: string;
  days: { date: string; status: CalendarDayStatus }[];
  /** Busy intervals (UTC), no customer details. */
  busy: { start: Date; end: Date; kind: "reservation" | "maintenance" }[];
}

const calendarInput = z
  .object({
    vehicleId: z.uuid(),
    /** Branch-local dates YYYY-MM-DD, inclusive. Defaults: today .. +59 days. */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "from must be <= to");

export async function getVehicleCalendar(
  vehicleId: string,
  range: { from?: string; to?: string } = {},
  now: Date = new Date(),
): Promise<VehicleCalendar> {
  const i = parseInput(calendarInput, { vehicleId, ...range });
  const [row] = await db
    .select({ status: vehicles.status, timeZone: branches.timeZone })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, i.vehicleId));
  if (!row) throw new ServiceError("NOT_FOUND", "Vehicle not found");
  const tzName = row.timeZone;
  const from = i.from ?? localDate(now, tzName);
  const to = i.to ?? addDaysToDate(from, 59);
  const dayCount = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (dayCount > 400) throw new ServiceError("VALIDATION_ERROR", "Calendar range is limited to 400 days");

  const start = zonedDayStart(from, tzName);
  const end = zonedDayStart(addDaysToDate(to, 1), tzName);
  const range_ = sql`tstzrange(${ts(start)}, ${ts(end)}, '[)')`;

  const res = await db
    .select({ start: reservations.pickupAt, end: reservations.returnAt })
    .from(reservations)
    .where(
      and(eq(reservations.vehicleId, i.vehicleId), sql`${reservations.period} && ${range_}`, blockingReservation(now)),
    );
  const mb = await db
    .select({ start: maintenanceBlocks.startsAt, end: maintenanceBlocks.endsAt })
    .from(maintenanceBlocks)
    .where(
      and(
        eq(maintenanceBlocks.vehicleId, i.vehicleId),
        sql`${maintenanceBlocks.cancelledAt} IS NULL`,
        sql`${maintenanceBlocks.period} && ${range_}`,
      ),
    );
  const busy = [
    ...res.map((r) => ({ ...r, kind: "reservation" as const })),
    ...mb.map((m) => ({ ...m, kind: "maintenance" as const })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const days: VehicleCalendar["days"] = [];
  for (let d = 0; d < dayCount; d++) {
    const date = addDaysToDate(from, d);
    if (row.status === "RETIRED") {
      days.push({ date, status: "booked" });
      continue;
    }
    if (row.status === "MAINTENANCE") {
      days.push({ date, status: "maintenance" });
      continue;
    }
    const ds = zonedDayStart(date, tzName).getTime();
    const de = zonedDayStart(addDaysToDate(date, 1), tzName).getTime();
    const overlaps = busy
      .map((b) => ({ s: Math.max(ds, b.start.getTime()), e: Math.min(de, b.end.getTime()), kind: b.kind }))
      .filter((b) => b.e > b.s);
    // Union length of the overlapping intervals (they are sorted by start).
    let covered = 0;
    let curS = -1;
    let curE = -1;
    for (const o of overlaps) {
      if (o.s > curE) {
        covered += curE - curS;
        curS = o.s;
        curE = o.e;
      } else curE = Math.max(curE, o.e);
    }
    covered += curE - curS;
    let status: CalendarDayStatus = "available";
    if (covered >= de - ds) status = overlaps.every((o) => o.kind === "maintenance") ? "maintenance" : "booked";
    else if (covered > 0) status = "partial";
    days.push({ date, status });
  }
  return { vehicleId: i.vehicleId, timeZone: tzName, days, busy };
}

import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  branches,
  deposits,
  driverProfiles,
  extras,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
  users,
  vehicleCategories,
  vehicles,
  type Reservation,
} from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { isVehicleAvailable } from "./availability";
import { db, mapOverlapError, pgError, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, type Executor, type Tx } from "./db";
import { parseInput, ServiceError } from "./errors";
import { LICENCE_KEY_RE, isLicenceKeyFor } from "./files";
import { log } from "./log";
import { extraSelectionSchema, HOLD_MINUTES, quoteVehicle, rentalWindowSchema, type Quote } from "./pricing";

export const MIN_DRIVER_AGE = 21;

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newReference(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `DE-${s}`;
}

export const driverSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Invalid phone number"),
  dateOfBirth: z.iso.date(),
  nationality: z.string().trim().max(60).optional(),
  licenceNumber: z.string().trim().min(3).max(40),
  licenceCountry: z
    .string()
    .trim()
    .length(2)
    .transform((c) => c.toUpperCase()),
  licenceExpiry: z.iso.date(),
  /** Key returned by uploadLicence(). */
  licenceFileKey: z.string().regex(LICENCE_KEY_RE, "Invalid licence file key").optional(),
});
export type DriverInput = z.input<typeof driverSchema>;

export const createReservationInput = rentalWindowSchema.extend({
  userId: z.uuid(),
  /** Generate once per checkout attempt (e.g. crypto.randomUUID() stored in the form); reuse on retry. */
  idempotencyKey: z.string().min(8).max(200),
  vehicleId: z.uuid(),
  extras: extraSelectionSchema,
  driver: driverSchema,
});
export type CreateReservationInput = z.input<typeof createReservationInput>;

export interface CreateReservationResult {
  reservationId: string;
  reference: string;
  status: Reservation["status"];
  holdExpiresAt: Date | null;
  totalFils: number;
  depositFils: number;
  /** True when an earlier request with the same idempotency key already created it. */
  replayed: boolean;
}

function ageOn(dob: string, at: Date): number {
  const [y, m, d] = dob.split("-").map(Number);
  let age = at.getUTCFullYear() - y;
  if (at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d)) age--;
  return age;
}

function toResult(r: Reservation, replayed: boolean): CreateReservationResult {
  return {
    reservationId: r.id,
    reference: r.reference,
    status: r.status,
    holdExpiresAt: r.holdExpiresAt,
    totalFils: r.totalFils,
    depositFils: r.depositFils,
    replayed,
  };
}

async function findByIdempotencyKey(ex: Executor, key: string) {
  const [r] = await ex.select().from(reservations).where(eq(reservations.idempotencyKey, key));
  return r;
}

function replay(existing: Reservation, userId: string): CreateReservationResult {
  if (existing.userId !== userId) throw new ServiceError("CONFLICT", "Idempotency key already used");
  return toResult(existing, true);
}

/**
 * Create a PENDING reservation that holds the vehicle for HOLD_MINUTES while the customer pays.
 *
 * Transaction: lock the vehicle row (SELECT ... FOR UPDATE) -> expire stale PENDING holds for the
 * vehicle -> check overlaps (reservations + maintenance) -> price server-side -> insert. The
 * exclusion constraint and overlap triggers are the final guard; their 23P01 becomes
 * VEHICLE_UNAVAILABLE. Same idempotency key = same reservation (no duplicates on retry).
 */
export async function createReservation(
  input: CreateReservationInput,
  opts: { now?: Date } = {},
): Promise<CreateReservationResult> {
  const i = parseInput(createReservationInput, input);
  const now = opts.now ?? new Date();
  const returnBranchId = i.returnBranchId ?? i.pickupBranchId;

  const existing = await findByIdempotencyKey(db, i.idempotencyKey);
  if (existing) return replay(existing, i.userId);

  if (ageOn(i.driver.dateOfBirth, i.pickupAt) < MIN_DRIVER_AGE) {
    throw new ServiceError("VALIDATION_ERROR", `Driver must be at least ${MIN_DRIVER_AGE}`, { field: "driver.dateOfBirth" });
  }
  if (i.driver.licenceExpiry < i.returnAt.toISOString().slice(0, 10)) {
    throw new ServiceError("VALIDATION_ERROR", "Driving licence expires before the return date", {
      field: "driver.licenceExpiry",
    });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, i.vehicleId)).for("update");
        if (!vehicle) throw new ServiceError("NOT_FOUND", "Vehicle not found");

        // A concurrent retry may have committed while we waited for the lock.
        const again = await findByIdempotencyKey(tx, i.idempotencyKey);
        if (again) return replay(again, i.userId);

        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, i.userId));
        if (!user) throw new ServiceError("NOT_FOUND", "User not found");

        const expired = await expireStaleHoldsForVehicle(tx, vehicle.id, now);
        if (expired.length) log.info("holds.expired_inline", { vehicleId: vehicle.id, reservationIds: expired });

        if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
          throw new ServiceError("VEHICLE_UNAVAILABLE", "This vehicle is not available for rent");
        }
        if (vehicle.branchId !== i.pickupBranchId) {
          throw new ServiceError("VEHICLE_UNAVAILABLE", "This vehicle is not available at the chosen pick-up branch");
        }

        const { quote } = await quoteVehicle(tx, {
          vehicleId: vehicle.id,
          pickupBranchId: i.pickupBranchId,
          returnBranchId,
          pickupAt: i.pickupAt,
          returnAt: i.returnAt,
          extras: i.extras,
          now,
        });

        if (!(await isVehicleAvailable(vehicle.id, i.pickupAt, i.returnAt, { now, ex: tx }))) {
          throw new ServiceError("VEHICLE_UNAVAILABLE", "The vehicle is not available for these dates");
        }

        const profileId = await upsertDriverProfile(tx, i.userId, i.driver);
        const [created] = await tx
          .insert(reservations)
          .values({
            reference: newReference(),
            userId: i.userId,
            vehicleId: vehicle.id,
            pickupBranchId: i.pickupBranchId,
            returnBranchId,
            pickupAt: i.pickupAt,
            returnAt: i.returnAt,
            status: "PENDING",
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            idempotencyKey: i.idempotencyKey,
            driverName: i.driver.fullName,
            driverEmail: i.driver.email,
            driverPhone: i.driver.phone,
            driverProfileId: profileId,
            ...snapshot(quote),
          })
          .returning();
        await insertExtras(tx, created.id, quote);
        await writeAudit(tx, {
          actorUserId: i.userId,
          action: "reservation.created",
          entityType: "reservation",
          entityId: created.id,
          data: { reference: created.reference, vehicleId: vehicle.id, totalFils: quote.totalFils },
        });
        return toResult(created, false);
      });
      log.info("reservation.created", { reservationId: result.reservationId, replayed: result.replayed });
      return result;
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === "reservations_idempotency_key_unique") {
        const winner = await findByIdempotencyKey(db, i.idempotencyKey);
        if (winner) return replay(winner, i.userId);
      }
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === "reservations_reference_unique") continue;
      if (pg?.code === PG_EXCLUSION_VIOLATION) {
        log.info("reservation.conflict", { vehicleId: i.vehicleId, constraint: pg.constraint });
      }
      mapOverlapError(err);
    }
  }
  throw new ServiceError("CONFLICT", "Could not allocate a booking reference, please retry");
}

export function snapshot(q: Quote) {
  return {
    currency: q.currency,
    rentalDays: q.rentalDays,
    dailyRateFils: q.dailyRateFils,
    baseFils: q.baseFils,
    extrasFils: q.extrasFils,
    oneWayFeeFils: q.oneWayFeeFils,
    subtotalFils: q.subtotalFils,
    vatRateBp: q.vatRateBp,
    vatFils: q.vatFils,
    totalFils: q.totalFils,
    depositFils: q.depositFils,
  };
}

export async function insertExtras(tx: Tx, reservationId: string, q: Quote) {
  if (q.extras.length === 0) return;
  await tx.insert(reservationExtras).values(
    q.extras.map((e) => ({
      reservationId,
      extraId: e.extraId,
      quantity: e.quantity,
      pricing: e.pricing,
      unitPriceFils: e.priceFils,
      totalFils: e.totalFils,
    })),
  );
}

async function upsertDriverProfile(tx: Tx, userId: string, d: z.output<typeof driverSchema>): Promise<string> {
  const values = {
    userId,
    fullName: d.fullName,
    dateOfBirth: d.dateOfBirth,
    nationality: d.nationality ?? null,
    phone: d.phone,
    licenceNumber: d.licenceNumber,
    licenceCountry: d.licenceCountry,
    licenceExpiry: d.licenceExpiry,
    ...(d.licenceFileKey ? { licenceFileKey: d.licenceFileKey } : {}),
  };
  if (d.licenceFileKey && !isLicenceKeyFor(d.licenceFileKey, userId)) {
    throw new ServiceError("FORBIDDEN", "Licence file does not belong to this user");
  }
  const [p] = await tx
    .insert(driverProfiles)
    .values(values)
    .onConflictDoUpdate({ target: driverProfiles.userId, set: { ...values, updatedAt: new Date() } })
    .returning({ id: driverProfiles.id });
  return p.id;
}

/** Mark PENDING holds whose hold_expires_at passed as EXPIRED, for one vehicle. Caller holds the vehicle lock. */
export async function expireStaleHoldsForVehicle(tx: Tx, vehicleId: string, now: Date): Promise<string[]> {
  const rows = await tx
    .update(reservations)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(
      and(
        eq(reservations.vehicleId, vehicleId),
        eq(reservations.status, "PENDING"),
        sql`${reservations.holdExpiresAt} <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: reservations.id });
  for (const r of rows) {
    await writeAudit(tx, { actorUserId: null, action: "reservation.expired", entityType: "reservation", entityId: r.id });
  }
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const pickupBranch = alias(branches, "pickup_branch");
const returnBranch = alias(branches, "return_branch");

export async function loadReservationDetail(ex: Executor, reservationId: string) {
  const [row] = await ex
    .select({
      reservation: reservations,
      vehicle: vehicles,
      category: vehicleCategories,
      pickupBranch,
      returnBranch,
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(pickupBranch, eq(pickupBranch.id, reservations.pickupBranchId))
    .innerJoin(returnBranch, eq(returnBranch.id, reservations.returnBranchId))
    .where(eq(reservations.id, reservationId));
  if (!row) return null;
  const [extraRows, paymentRows, depositRows, agreementRows] = await Promise.all([
    ex
      .select({
        extraId: reservationExtras.extraId,
        code: extras.code,
        name: extras.name,
        pricing: reservationExtras.pricing,
        quantity: reservationExtras.quantity,
        unitPriceFils: reservationExtras.unitPriceFils,
        totalFils: reservationExtras.totalFils,
      })
      .from(reservationExtras)
      .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
      .where(eq(reservationExtras.reservationId, reservationId))
      .orderBy(asc(extras.name)),
    ex.select().from(payments).where(eq(payments.reservationId, reservationId)).orderBy(asc(payments.createdAt)),
    ex.select().from(deposits).where(eq(deposits.reservationId, reservationId)).orderBy(desc(deposits.createdAt)),
    ex.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, reservationId)),
  ]);
  return {
    ...row,
    extras: extraRows,
    payments: paymentRows,
    /** The latest charge attempt (null before checkout). */
    payment: paymentRows.filter((p) => p.purpose === "CHARGE").at(-1) ?? null,
    deposit: depositRows[0] ?? null,
    agreement: agreementRows[0] ?? null,
  };
}
export type ReservationDetail = NonNullable<Awaited<ReturnType<typeof loadReservationDetail>>>;

const uuidOk = (v: string) => z.uuid().safeParse(v).success;

/** Owner-only view. Returns null when the reservation does not exist or belongs to someone else. */
export async function getReservationForUser(reservationId: string, userId: string): Promise<ReservationDetail | null> {
  if (!uuidOk(reservationId) || !uuidOk(userId)) return null;
  const d = await loadReservationDetail(db, reservationId);
  return d && d.reservation.userId === userId ? d : null;
}

/** Voucher lookup by booking reference, owner only. */
export async function getReservationByReferenceForUser(reference: string, userId: string) {
  if (!uuidOk(userId)) return null;
  const [r] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.reference, reference.toUpperCase()), eq(reservations.userId, userId)));
  return r ? getReservationForUser(r.id, userId) : null;
}

export async function listReservationsForUser(userId: string) {
  if (!uuidOk(userId)) return [];
  return db
    .select({
      reservation: reservations,
      vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, imageUrl: vehicles.imageUrl, plateNumber: vehicles.plateNumber },
      pickupBranch: { id: pickupBranch.id, name: pickupBranch.name, code: pickupBranch.code, timeZone: pickupBranch.timeZone },
      returnBranch: { id: returnBranch.id, name: returnBranch.name, code: returnBranch.code, timeZone: returnBranch.timeZone },
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(pickupBranch, eq(pickupBranch.id, reservations.pickupBranchId))
    .innerJoin(returnBranch, eq(returnBranch.id, reservations.returnBranchId))
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.pickupAt));
}

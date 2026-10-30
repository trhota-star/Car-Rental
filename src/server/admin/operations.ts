import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { PaymentProvider } from "@/lib/payments";
import { getFileStorage, type FileStorage } from "@/lib/storage";
import {
  auditLogs,
  branches,
  damageReports,
  damageSeverity,
  damageStage,
  damageStatus,
  maintenanceBlocks,
  rentalAgreements,
  reservations,
  reservationStatus,
  users,
  vehicles,
} from "@/lib/db/schema";
import { writeAudit } from "../audit";
import { flagStrandedBookings } from "../availability";
import { assertAdmin, db, mapOverlapError } from "../db";
import { parseInput, ServiceError } from "../errors";
import { storeDamagePhotos } from "../files";
import { log } from "../log";
import { settleReservation, type SettlementResult } from "../payments";
import { computeLateFee, vatOn } from "../pricing-core";
import { loadReservationDetail, type ReservationDetail } from "../reservations";

type Opts = { provider?: PaymentProvider; now?: Date; storage?: FileStorage };
const uuid = z.uuid();
const fils = z.number().int().min(0).max(100_000_000);

/** Refuelling charge per missing percent of tank (before VAT): AED 5. */
export const FUEL_CHARGE_PER_PERCENT_FILS = 500;

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

const pickupBranch = alias(branches, "pickup_branch");

const listInput = z.object({
  status: z.enum(reservationStatus.enumValues).optional(),
  branchId: uuid.optional(),
  vehicleId: uuid.optional(),
  /** Pick-up on/after `from` and before `to`. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  reference: z.string().trim().max(20).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export async function listReservations(actorUserId: string, filter: z.input<typeof listInput> = {}) {
  const f = parseInput(listInput, filter);
  await assertAdmin(db, parseInput(uuid, actorUserId));
  return db
    .select({
      reservation: reservations,
      vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, plateNumber: vehicles.plateNumber },
      customer: { id: users.id, name: users.name, email: users.email },
      pickupBranch: { id: pickupBranch.id, code: pickupBranch.code, name: pickupBranch.name, timeZone: pickupBranch.timeZone },
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(users, eq(users.id, reservations.userId))
    .innerJoin(pickupBranch, eq(pickupBranch.id, reservations.pickupBranchId))
    .where(
      and(
        f.status ? eq(reservations.status, f.status) : undefined,
        f.branchId ? eq(reservations.pickupBranchId, f.branchId) : undefined,
        f.vehicleId ? eq(reservations.vehicleId, f.vehicleId) : undefined,
        f.from ? gte(reservations.pickupAt, f.from) : undefined,
        f.to ? lt(reservations.pickupAt, f.to) : undefined,
        f.reference ? eq(reservations.reference, f.reference.toUpperCase()) : undefined,
      ),
    )
    .orderBy(desc(reservations.pickupAt))
    .limit(f.limit)
    .offset(f.offset);
}

export async function getReservationByIdForAdmin(actorUserId: string, reservationId: string): Promise<ReservationDetail | null> {
  await assertAdmin(db, parseInput(uuid, actorUserId));
  if (!uuid.safeParse(reservationId).success) return null;
  return loadReservationDetail(db, reservationId);
}

// ---------------------------------------------------------------------------
// Check-out (pick-up) / check-in (return)
// ---------------------------------------------------------------------------

const checkOutInput = z.object({
  reservationId: uuid,
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelPercent: z.number().int().min(0).max(100),
  notes: z.string().max(2000).optional(),
});

/** CONFIRMED -> PICKED_UP. Records mileage + fuel, vehicle -> ON_RENT. */
export async function checkOut(actorUserId: string, input: z.input<typeof checkOutInput>, opts: Opts = {}) {
  const i = parseInput(checkOutInput, input);
  const now = opts.now ?? new Date();
  const agreement = await db.transaction(async (tx) => {
    await assertAdmin(tx, parseInput(uuid, actorUserId));
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, i.reservationId)).for("update");
    if (!r) throw new ServiceError("NOT_FOUND", "Reservation not found");
    if (r.status !== "CONFIRMED") throw new ServiceError("INVALID_STATE", `Reservation is ${r.status.toLowerCase()}`);
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
    if (v.status === "ON_RENT") throw new ServiceError("INVALID_STATE", "Vehicle is already on rent");
    if (i.mileageKm < v.mileageKm) {
      throw new ServiceError("VALIDATION_ERROR", `Mileage is below the recorded ${v.mileageKm} km`, { field: "mileageKm" });
    }
    const [a] = await tx
      .insert(rentalAgreements)
      .values({
        reservationId: r.id,
        vehicleId: v.id,
        pickedUpAt: now,
        pickupMileageKm: i.mileageKm,
        pickupFuelPercent: i.fuelPercent,
        pickupStaffId: actorUserId,
        pickupNotes: i.notes,
      })
      .returning();
    await tx.update(reservations).set({ status: "PICKED_UP" }).where(eq(reservations.id, r.id));
    await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: i.mileageKm }).where(eq(vehicles.id, v.id));
    await writeAudit(tx, {
      actorUserId,
      action: "reservation.checked_out",
      entityType: "reservation",
      entityId: r.id,
      data: { mileageKm: i.mileageKm, fuelPercent: i.fuelPercent },
    });
    return a;
  });
  log.info("reservation.checked_out", { reservationId: i.reservationId, actorUserId });
  return agreement;
}

const checkInInput = z.object({
  reservationId: uuid,
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelPercent: z.number().int().min(0).max(100),
  /** Defaults to the booked return branch. */
  returnBranchId: uuid.optional(),
  /** Defaults to now. */
  returnedAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
  /** Damage amount to collect from the deposit (VAT inclusive). Record details with createDamageReport. */
  damageChargeFils: fils.default(0),
  /** Send the car to the workshop after return. */
  needsMaintenance: z.boolean().default(false),
});

export interface CheckInResult {
  lateFeeFils: number;
  lateMinutes: number;
  fuelChargeFils: number;
  damageChargeFils: number;
  /** Total collected from the deposit hold (capped at the deposit). */
  totalChargesFils: number;
  settlement: SettlementResult;
}

/**
 * PICKED_UP -> RETURNED. Computes the late-return fee (60 min grace, then hourly, capped per day) and a
 * refuelling charge, stores them on the agreement, then captures charges from the deposit hold and
 * releases the rest. Vehicle -> AVAILABLE (or MAINTENANCE) at the actual return branch.
 */
export async function checkIn(actorUserId: string, input: z.input<typeof checkInInput>, opts: Opts = {}): Promise<CheckInResult> {
  const i = parseInput(checkInInput, input);
  const returnedAt = i.returnedAt ?? opts.now ?? new Date();
  const res = await db.transaction(async (tx) => {
    await assertAdmin(tx, parseInput(uuid, actorUserId));
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, i.reservationId)).for("update");
    if (!r) throw new ServiceError("NOT_FOUND", "Reservation not found");
    if (r.status !== "PICKED_UP") throw new ServiceError("INVALID_STATE", `Reservation is ${r.status.toLowerCase()}`);
    const [a] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
    if (!a) throw new ServiceError("INVALID_STATE", "No rental agreement for this reservation");
    if (i.mileageKm < a.pickupMileageKm) {
      throw new ServiceError("VALIDATION_ERROR", `Mileage is below the pick-up reading ${a.pickupMileageKm} km`, { field: "mileageKm" });
    }
    if (returnedAt < a.pickedUpAt) throw new ServiceError("VALIDATION_ERROR", "Return time is before pick-up");
    const returnBranchId = i.returnBranchId ?? r.returnBranchId;
    const [rb] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, returnBranchId));
    if (!rb) throw new ServiceError("NOT_FOUND", "Return branch not found");

    const late = computeLateFee({
      scheduledReturnAt: r.returnAt,
      actualReturnAt: returnedAt,
      dailyRateFils: r.dailyRateFils,
      vatRateBp: r.vatRateBp,
    });
    const missing = Math.max(0, a.pickupFuelPercent - i.fuelPercent);
    const fuelNet = missing * FUEL_CHARGE_PER_PERCENT_FILS;
    const fuelChargeFils = fuelNet + vatOn(fuelNet, r.vatRateBp);
    const total = late.totalFils + fuelChargeFils + i.damageChargeFils;

    await tx
      .update(rentalAgreements)
      .set({
        returnedAt,
        returnMileageKm: i.mileageKm,
        returnFuelPercent: i.fuelPercent,
        returnStaffId: actorUserId,
        returnBranchId,
        returnNotes: i.notes,
        lateFeeFils: late.totalFils,
        fuelChargeFils,
      })
      .where(eq(rentalAgreements.id, a.id));
    await tx.update(reservations).set({ status: "RETURNED", lateFeeFils: total }).where(eq(reservations.id, r.id));
    await tx
      .update(vehicles)
      .set({ status: i.needsMaintenance ? "MAINTENANCE" : "AVAILABLE", mileageKm: i.mileageKm, branchId: returnBranchId })
      .where(eq(vehicles.id, r.vehicleId));
    // Returned somewhere other than booked: the next booking may need the car moved.
    if (returnBranchId !== r.returnBranchId) await flagStrandedBookings(tx, r.vehicleId, returnedAt, returnedAt, actorUserId);
    await writeAudit(tx, {
      actorUserId,
      action: "reservation.checked_in",
      entityType: "reservation",
      entityId: r.id,
      data: { mileageKm: i.mileageKm, fuelPercent: i.fuelPercent, lateFeeFils: late.totalFils, fuelChargeFils, damageChargeFils: i.damageChargeFils, returnBranchId },
    });
    return { late, fuelChargeFils, total };
  });
  log.info("reservation.checked_in", { reservationId: i.reservationId, actorUserId, totalChargesFils: res.total });
  const settlement = await settleReservation(i.reservationId, opts);
  return {
    lateFeeFils: res.late.totalFils,
    lateMinutes: res.late.lateMinutes,
    fuelChargeFils: res.fuelChargeFils,
    damageChargeFils: i.damageChargeFils,
    totalChargesFils: res.total,
    settlement,
  };
}

// ---------------------------------------------------------------------------
// Damage reports
// ---------------------------------------------------------------------------

const damageInput = z.object({
  vehicleId: uuid,
  reservationId: uuid.optional(),
  stage: z.enum(damageStage.enumValues),
  severity: z.enum(damageSeverity.enumValues),
  description: z.string().trim().min(3).max(4000),
  repairCostFils: fils.default(0),
  chargedFils: fils.default(0),
  photos: z.array(z.object({ data: z.instanceof(Uint8Array), contentType: z.string() })).max(10).default([]),
});

export async function createDamageReport(actorUserId: string, input: z.input<typeof damageInput>, opts: Opts = {}) {
  const i = parseInput(damageInput, input);
  await assertAdmin(db, parseInput(uuid, actorUserId));
  const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, i.vehicleId));
  if (!v) throw new ServiceError("NOT_FOUND", "Vehicle not found");
  if (i.reservationId) {
    const [r] = await db.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, i.reservationId));
    if (!r || r.vehicleId !== i.vehicleId) throw new ServiceError("VALIDATION_ERROR", "Reservation does not match the vehicle");
  }
  const storage = opts.storage ?? getFileStorage();
  const imageKeys = await storeDamagePhotos(i.vehicleId, i.photos, storage);
  try {
    return await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(damageReports)
        .values({
          vehicleId: i.vehicleId,
          reservationId: i.reservationId ?? null,
          reportedById: actorUserId,
          stage: i.stage,
          severity: i.severity,
          description: i.description,
          repairCostFils: i.repairCostFils,
          chargedFils: i.chargedFils,
          imageKeys,
        })
        .returning();
      await writeAudit(tx, {
        actorUserId,
        action: "damage_report.created",
        entityType: "damage_report",
        entityId: d.id,
        data: { vehicleId: i.vehicleId, reservationId: i.reservationId, severity: i.severity, photos: imageKeys.length },
      });
      return d;
    });
  } catch (err) {
    await Promise.all(imageKeys.map((k) => storage.delete(k).catch(() => {})));
    throw err;
  }
}

const damagePatch = z.object({
  id: uuid,
  status: z.enum(damageStatus.enumValues).optional(),
  repairCostFils: fils.optional(),
  chargedFils: fils.optional(),
  description: z.string().trim().min(3).max(4000).optional(),
});

export async function updateDamageReport(actorUserId: string, input: z.input<typeof damagePatch>) {
  const { id, ...patch } = parseInput(damagePatch, input);
  return db.transaction(async (tx) => {
    await assertAdmin(tx, parseInput(uuid, actorUserId));
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [d] = await tx.update(damageReports).set(set).where(eq(damageReports.id, id)).returning();
    if (!d) throw new ServiceError("NOT_FOUND", "Damage report not found");
    await writeAudit(tx, { actorUserId, action: "damage_report.updated", entityType: "damage_report", entityId: id, data: patch });
    return d;
  });
}

export async function listDamageReports(
  actorUserId: string,
  filter: { vehicleId?: string; reservationId?: string; status?: "OPEN" | "RESOLVED" } = {},
) {
  const f = parseInput(
    z.object({ vehicleId: uuid.optional(), reservationId: uuid.optional(), status: z.enum(damageStatus.enumValues).optional() }),
    filter,
  );
  await assertAdmin(db, parseInput(uuid, actorUserId));
  return db
    .select({ report: damageReports, vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, plateNumber: vehicles.plateNumber } })
    .from(damageReports)
    .innerJoin(vehicles, eq(vehicles.id, damageReports.vehicleId))
    .where(
      and(
        f.vehicleId ? eq(damageReports.vehicleId, f.vehicleId) : undefined,
        f.reservationId ? eq(damageReports.reservationId, f.reservationId) : undefined,
        f.status ? eq(damageReports.status, f.status) : undefined,
      ),
    )
    .orderBy(desc(damageReports.createdAt));
}

// ---------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------

const blockInput = z
  .object({
    vehicleId: uuid,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((b) => b.endsAt > b.startsAt, "End must be after start");

/** Fails with VEHICLE_UNAVAILABLE if it overlaps an active reservation or another block. */
export async function createMaintenanceBlock(actorUserId: string, input: z.input<typeof blockInput>) {
  const i = parseInput(blockInput, input);
  try {
    return await db.transaction(async (tx) => {
      await assertAdmin(tx, parseInput(uuid, actorUserId));
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, i.vehicleId)).for("update");
      if (!v) throw new ServiceError("NOT_FOUND", "Vehicle not found");
      const [b] = await tx.insert(maintenanceBlocks).values({ ...i, createdById: actorUserId }).returning();
      await writeAudit(tx, { actorUserId, action: "maintenance.created", entityType: "maintenance_block", entityId: b.id, data: i });
      return b;
    });
  } catch (err) {
    mapOverlapError(err);
  }
}

export async function cancelMaintenanceBlock(actorUserId: string, blockId: string) {
  parseInput(uuid, blockId);
  return db.transaction(async (tx) => {
    await assertAdmin(tx, parseInput(uuid, actorUserId));
    const [b] = await tx
      .update(maintenanceBlocks)
      .set({ cancelledAt: new Date() })
      .where(and(eq(maintenanceBlocks.id, blockId), sql`${maintenanceBlocks.cancelledAt} IS NULL`))
      .returning();
    if (!b) throw new ServiceError("NOT_FOUND", "Active maintenance block not found");
    await writeAudit(tx, { actorUserId, action: "maintenance.cancelled", entityType: "maintenance_block", entityId: b.id });
    return b;
  });
}

export async function listMaintenanceBlocks(actorUserId: string, filter: { vehicleId?: string; includeCancelled?: boolean } = {}) {
  const f = parseInput(z.object({ vehicleId: uuid.optional(), includeCancelled: z.boolean().default(false) }), filter);
  await assertAdmin(db, parseInput(uuid, actorUserId));
  return db
    .select({ block: maintenanceBlocks, vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, plateNumber: vehicles.plateNumber } })
    .from(maintenanceBlocks)
    .innerJoin(vehicles, eq(vehicles.id, maintenanceBlocks.vehicleId))
    .where(
      and(
        f.vehicleId ? eq(maintenanceBlocks.vehicleId, f.vehicleId) : undefined,
        f.includeCancelled ? undefined : sql`${maintenanceBlocks.cancelledAt} IS NULL`,
      ),
    )
    .orderBy(desc(maintenanceBlocks.startsAt));
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAuditLogs(
  actorUserId: string,
  filter: { entityType?: string; entityId?: string; actions?: string[]; limit?: number } = {},
) {
  const f = parseInput(
    z.object({
      entityType: z.string().max(50).optional(),
      entityId: uuid.optional(),
      actions: z.array(z.string().max(80)).max(20).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    filter,
  );
  await assertAdmin(db, parseInput(uuid, actorUserId));
  return db
    .select({ log: auditLogs, actor: { id: users.id, name: users.name, email: users.email } })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        f.entityType ? eq(auditLogs.entityType, f.entityType) : undefined,
        f.entityId ? eq(auditLogs.entityId, f.entityId) : undefined,
        f.actions?.length ? inArray(auditLogs.action, f.actions) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(f.limit);
}

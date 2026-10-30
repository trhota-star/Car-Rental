import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getPaymentProvider, isPaymentError, type PaymentProvider } from "@/lib/payments";
import { payments, reservationExtras, reservations, vehicles, type Reservation } from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { findStrandedBooking, flagStrandedBookings, isVehicleAvailable } from "./availability";
import { db, isAdmin, mapOverlapError, type Executor } from "./db";
import { parseInput, ServiceError } from "./errors";
import { log } from "./log";
import { CURRENCY, paidSummary, settleReservation, type SettlementResult } from "./payments";
import { cancellationTerms, quoteVehicle, type Quote } from "./pricing";
import { expireStaleHoldsForVehicle, insertExtras, snapshot } from "./reservations";

// Cancellation policy (see pricing-core.cancellationTerms):
// - PENDING (unpaid hold): cancel any time, no fee.
// - CONFIRMED, more than 48h before pick-up: free, full refund.
// - CONFIRMED, 48h or less before pick-up (or after the pick-up time, not collected): one day's
//   rental (daily rate + VAT) is kept, the rest is refunded.
// - The security deposit hold is always released.
// - PICKED_UP / RETURNED / EXPIRED / CANCELLED / REFUNDED cannot be cancelled.
//
// Date changes: allowed for PENDING / CONFIRMED before pick-up, same vehicle and branches. The new
// price is computed server-side. Price increase on a CONFIRMED booking -> the difference is charged
// first (paymentMethod required); decrease -> the difference is refunded. No change fee.

type Opts = { provider?: PaymentProvider; now?: Date };

const idsInput = z.object({ reservationId: z.uuid(), userId: z.uuid() });

async function loadOwned(ex: Executor, reservationId: string, userId: string, lock: boolean): Promise<Reservation> {
  const q = ex.select().from(reservations).where(eq(reservations.id, reservationId));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw new ServiceError("NOT_FOUND", "Reservation not found");
  if (r.userId !== userId && !(await isAdmin(ex, userId))) throw new ServiceError("NOT_FOUND", "Reservation not found");
  return r;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export interface CancellationPreview {
  eligible: boolean;
  reason?: string;
  free: boolean;
  feeFils: number;
  refundFils: number;
  /** Net amount paid so far. */
  paidFils: number;
}

async function terms(ex: Executor, r: Reservation, now: Date): Promise<CancellationPreview> {
  if (r.status !== "PENDING" && r.status !== "CONFIRMED") {
    return { eligible: false, reason: `Reservation is ${r.status.toLowerCase()}`, free: false, feeFils: 0, refundFils: 0, paidFils: 0 };
  }
  const s = await paidSummary(ex as typeof db, r.id);
  const netPaid = Math.max(0, s.paidFils - r.refundedFils);
  if (r.status === "PENDING") return { eligible: true, free: true, feeFils: 0, refundFils: netPaid, paidFils: netPaid };
  const t = cancellationTerms({
    now,
    pickupAt: r.pickupAt,
    dailyRateFils: r.dailyRateFils,
    vatRateBp: r.vatRateBp,
    paidFils: netPaid,
  });
  return { eligible: true, ...t, paidFils: netPaid };
}

export async function previewCancellation(reservationId: string, userId: string, opts: Opts = {}): Promise<CancellationPreview> {
  const i = parseInput(idsInput, { reservationId, userId });
  const r = await loadOwned(db, i.reservationId, i.userId, false);
  return terms(db, r, opts.now ?? new Date());
}

export const cancelReservationInput = idsInput.extend({ reason: z.string().trim().max(500).optional() });
export type CancelReservationInput = z.input<typeof cancelReservationInput>;

export interface CancelResult {
  status: Reservation["status"];
  feeFils: number;
  refundFils: number;
  settlement: SettlementResult;
}

/** Cancel per the policy above. Refund + deposit release run right after commit (and again via the job if needed). */
export async function cancelReservation(input: CancelReservationInput, opts: Opts = {}): Promise<CancelResult> {
  const i = parseInput(cancelReservationInput, input);
  const now = opts.now ?? new Date();
  const t = await db.transaction(async (tx) => {
    const r = await loadOwned(tx, i.reservationId, i.userId, true);
    const t = await terms(tx, r, now);
    if (!t.eligible) throw new ServiceError("INVALID_STATE", t.reason ?? "Cannot cancel");
    await tx
      .update(reservations)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: i.reason ?? null,
        cancellationFeeFils: t.feeFils,
        refundedFils: r.refundedFils + t.refundFils,
        holdExpiresAt: null,
      })
      .where(eq(reservations.id, r.id));
    await writeAudit(tx, {
      actorUserId: i.userId,
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: r.id,
      data: { feeFils: t.feeFils, refundFils: t.refundFils, reason: i.reason },
    });
    // A cancelled one-way booking may leave the next booking's car at the wrong branch: flag for staff.
    await flagStrandedBookings(tx, r.vehicleId, r.pickupAt, now, i.userId);
    return t;
  });
  log.info("reservation.cancelled", { reservationId: i.reservationId, feeFils: t.feeFils, refundFils: t.refundFils });
  const settlement = await settleReservation(i.reservationId, opts);
  const [r] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, i.reservationId));
  return { status: r.status, feeFils: t.feeFils, refundFils: t.refundFils, settlement };
}

// ---------------------------------------------------------------------------
// Change dates
// ---------------------------------------------------------------------------

export const changeDatesInput = idsInput.extend({
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  /** Required when the new price is higher on a paid booking. */
  paymentMethod: z.string().min(1).max(200).optional(),
});
export type ChangeDatesInput = z.input<typeof changeDatesInput>;

export interface DateChangePreview {
  available: boolean;
  newQuote: Quote;
  /** Positive: to be charged now. */
  amountDueFils: number;
  /** Positive: to be refunded. */
  refundFils: number;
}

async function computeChange(ex: Executor, r: Reservation, pickupAt: Date, returnAt: Date, now: Date) {
  if (r.status !== "PENDING" && r.status !== "CONFIRMED") {
    throw new ServiceError("INVALID_STATE", `Reservation is ${r.status.toLowerCase()}`);
  }
  if (r.pickupAt <= now) throw new ServiceError("INVALID_STATE", "Dates can only be changed before pick-up");
  const extras = await ex
    .select({ extraId: reservationExtras.extraId, quantity: reservationExtras.quantity })
    .from(reservationExtras)
    .where(eq(reservationExtras.reservationId, r.id));
  const { quote } = await quoteVehicle(ex, {
    vehicleId: r.vehicleId,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
    pickupAt,
    returnAt,
    extras,
    now,
  });
  let amountDueFils = 0;
  let refundFils = 0;
  if (r.status === "CONFIRMED") {
    const s = await paidSummary(ex as typeof db, r.id);
    const netPaid = s.paidFils - r.refundedFils;
    const diff = quote.totalFils - netPaid;
    if (diff > 0) amountDueFils = diff;
    else refundFils = -diff;
  }
  const available = await isVehicleAvailable(r.vehicleId, pickupAt, returnAt, {
    now,
    excludeReservationId: r.id,
    ex,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
  });
  return { quote, amountDueFils, refundFils, available };
}

export async function previewDateChange(input: Omit<ChangeDatesInput, "paymentMethod">, opts: Opts = {}): Promise<DateChangePreview> {
  const i = parseInput(changeDatesInput, input);
  const r = await loadOwned(db, i.reservationId, i.userId, false);
  const c = await computeChange(db, r, i.pickupAt, i.returnAt, opts.now ?? new Date());
  return { available: c.available, newQuote: c.quote, amountDueFils: c.amountDueFils, refundFils: c.refundFils };
}

export interface DateChangeResult extends DateChangePreview {
  reservation: Reservation;
}

export async function changeReservationDates(input: ChangeDatesInput, opts: Opts = {}): Promise<DateChangeResult> {
  const i = parseInput(changeDatesInput, input);
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getPaymentProvider();

  // Phase 1 (no locks): price the change; charge any increase up front.
  const r0 = await loadOwned(db, i.reservationId, i.userId, false);
  const pre = await computeChange(db, r0, i.pickupAt, i.returnAt, now);
  if (!pre.available) throw new ServiceError("VEHICLE_UNAVAILABLE", "The vehicle is not available for the new dates");

  let extraPaymentId: string | null = null;
  if (pre.amountDueFils > 0) {
    if (!i.paymentMethod) {
      throw new ServiceError("VALIDATION_ERROR", "A payment method is required for the price difference", {
        amountDueFils: pre.amountDueFils,
      });
    }
    const fingerprint = createHash("sha256")
      .update(`${i.pickupAt.toISOString()}|${i.returnAt.toISOString()}|${pre.amountDueFils}`)
      .digest("hex")
      .slice(0, 16);
    const key = `${r0.id}:extra:${fingerprint}`;
    const [row] = await db
      .insert(payments)
      .values({
        reservationId: r0.id,
        provider: provider.name,
        idempotencyKey: key,
        purpose: "EXTRA_CHARGE",
        amountFils: pre.amountDueFils,
        currency: CURRENCY,
      })
      .onConflictDoUpdate({ target: payments.idempotencyKey, set: { updatedAt: now } })
      .returning();
    extraPaymentId = row.id;
    if (row.status !== "SUCCEEDED") {
      try {
        const res = await provider.createPayment({
          amount: pre.amountDueFils,
          currency: CURRENCY,
          paymentMethod: i.paymentMethod,
          idempotencyKey: key,
          metadata: { reservationId: r0.id, kind: "extra_charge", paymentId: row.id },
        });
        // Synchronous provider API response (server-to-server) is accepted for modifications.
        const status = res.status === "succeeded" ? "SUCCEEDED" : res.status === "pending" ? "PENDING" : res.status === "canceled" ? "CANCELLED" : "FAILED";
        await db
          .update(payments)
          .set({ providerPaymentId: res.id, status, failureReason: res.failureReason ?? null })
          .where(and(eq(payments.id, row.id), eq(payments.status, "PENDING")));
        if (status !== "SUCCEEDED") {
          throw new ServiceError("PAYMENT_FAILED", "The price difference could not be charged");
        }
      } catch (err) {
        if (isPaymentError(err)) throw new ServiceError("PAYMENT_PROVIDER_ERROR", err.message);
        throw err;
      }
    }
  }

  // Phase 2: apply under the vehicle lock.
  let applied: DateChangeResult;
  try {
    applied = await db.transaction(async (tx) => {
      await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, r0.vehicleId)).for("update");
      await expireStaleHoldsForVehicle(tx, r0.vehicleId, now);
      const r = await loadOwned(tx, i.reservationId, i.userId, true);
      const c = await computeChange(tx, r, i.pickupAt, i.returnAt, now);
      if (!c.available) throw new ServiceError("VEHICLE_UNAVAILABLE", "The vehicle is not available for the new dates");
      if (c.amountDueFils > 0 && c.amountDueFils !== pre.amountDueFils) {
        throw new ServiceError("CONFLICT", "The price changed, please review and try again");
      }
      const [updated] = await tx
        .update(reservations)
        .set({
          pickupAt: i.pickupAt,
          returnAt: i.returnAt,
          ...snapshot(c.quote),
          refundedFils: r.refundedFils + c.refundFils,
          ...(r.status === "PENDING" ? { holdExpiresAt: r.holdExpiresAt } : {}),
        })
        .where(eq(reservations.id, r.id))
        .returning();
      await tx.delete(reservationExtras).where(eq(reservationExtras.reservationId, r.id));
      await insertExtras(tx, r.id, c.quote);
      // Moving a one-way booking must not strand the booking that relied on it (customer-initiated, so refuse).
      const stranded = await findStrandedBooking(tx, r.vehicleId, r.pickupAt < i.pickupAt ? r.pickupAt : i.pickupAt, now);
      if (stranded) {
        throw new ServiceError("VEHICLE_UNAVAILABLE", "This change would leave the vehicle at the wrong branch for its next booking", {
          reason: "STRANDS_NEXT_BOOKING",
        });
      }
      await writeAudit(tx, {
        actorUserId: i.userId,
        action: "reservation.dates_changed",
        entityType: "reservation",
        entityId: r.id,
        data: {
          from: { pickupAt: r.pickupAt, returnAt: r.returnAt, totalFils: r.totalFils },
          to: { pickupAt: i.pickupAt, returnAt: i.returnAt, totalFils: c.quote.totalFils },
          amountDueFils: c.amountDueFils,
          refundFils: c.refundFils,
          extraPaymentId,
        },
      });
      return { reservation: updated, available: true, newQuote: c.quote, amountDueFils: c.amountDueFils, refundFils: c.refundFils };
    });
  } catch (err) {
    // Undo an up-front charge if the change could not be applied.
    if (extraPaymentId) {
      const [p] = await db.select().from(payments).where(eq(payments.id, extraPaymentId));
      if (p?.providerPaymentId && p.status === "SUCCEEDED") {
        await provider.refundPayment(p.providerPaymentId).catch((e) => log.error("change.refund_failed", { err: e }));
        await db.update(payments).set({ status: "REFUNDED", refundedFils: p.amountFils }).where(eq(payments.id, p.id));
      }
    }
    mapOverlapError(err);
  }
  log.info("reservation.dates_changed", { reservationId: i.reservationId, amountDueFils: applied.amountDueFils, refundFils: applied.refundFils });
  if (applied.refundFils > 0) await settleReservation(i.reservationId, { ...opts, provider });
  return applied;
}

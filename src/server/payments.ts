import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  getPaymentProvider,
  PaymentError,
  type DepositHold,
  type Payment as ProviderPayment,
  type PaymentEvent,
  type PaymentProvider,
} from "@/lib/payments";
import {
  deposits,
  paymentWebhookEvents,
  payments,
  reservations,
  type Deposit,
  type Payment,
  type Reservation,
} from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { pool } from "@/lib/db";
import { db, type Tx } from "./db";
import { parseInput, ServiceError } from "./errors";
import { log } from "./log";
import { loadReservationDetail, type ReservationDetail } from "./reservations";

// Flow
// 1. payReservation: records a payment row (+ deposit row) with provider idempotency keys derived
//    from the reservation id (`<reservationId>:charge:<n>`, `<reservationId>:deposit:<n>`; n grows
//    only after a failed attempt), then calls the provider. No DB locks are held during provider calls.
// 2. Status changes come from VERIFIED webhooks (handlePaymentWebhook), deduplicated by
//    (provider, event id) in payment_webhook_events. The reservation becomes CONFIRMED only when the
//    charge is SUCCEEDED and the deposit (if any) is AUTHORIZED. The only status taken from the
//    synchronous provider response is a failure (it never confirms anything).
// 3. settleReservation: idempotent money clean-up (refunds owed, deposit release/capture, cancelling
//    pending payments) for expired / cancelled / returned / modified reservations. Run after cancel,
//    check-in and date changes, and by the release-holds job for anything left over.

type Opts = { provider?: PaymentProvider; now?: Date };
const providerOf = (o: Opts) => o.provider ?? getPaymentProvider();

export const CURRENCY = "AED";

type Kind = "charge" | "deposit" | "extra_charge";

const PAYMENT_RANK: Record<Payment["status"], number> = {
  PENDING: 0,
  SUCCEEDED: 1,
  FAILED: 1,
  CANCELLED: 1,
  PARTIALLY_REFUNDED: 2,
  REFUNDED: 3,
};
const DEPOSIT_RANK: Record<Deposit["status"], number> = {
  PENDING: 0,
  AUTHORIZED: 1,
  FAILED: 1,
  RELEASED: 2,
  CAPTURED: 2,
};

function mapPaymentStatus(p: ProviderPayment): Payment["status"] {
  switch (p.status) {
    case "pending":
      return "PENDING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELLED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "refunded":
      return "REFUNDED";
  }
}

function mapDepositStatus(h: DepositHold): Deposit["status"] {
  switch (h.status) {
    case "held":
      return "AUTHORIZED";
    case "failed":
      return "FAILED";
    case "released":
      return "RELEASED";
    case "captured":
      return "CAPTURED";
  }
}

function providerFailure(err: unknown): never {
  if (err instanceof PaymentError) {
    if (err.code === "invalid_payment_method" || err.code === "invalid_amount") {
      throw new ServiceError("VALIDATION_ERROR", err.message, { providerCode: err.code });
    }
    throw new ServiceError("PAYMENT_PROVIDER_ERROR", err.message, { providerCode: err.code });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export const payReservationInput = z.object({
  reservationId: z.uuid(),
  userId: z.uuid(),
  /** Provider payment method token (fake provider: pm_fake_success / _fail / _cancel / _pending). */
  paymentMethod: z.string().min(1).max(200),
});
export type PayReservationInput = z.input<typeof payReservationInput>;

export interface PayReservationResult {
  /** Reservation status after the attempt (CONFIRMED once both webhooks were processed). */
  status: Reservation["status"];
  /** What the customer should see. */
  outcome: "CONFIRMED" | "PROCESSING" | "PAYMENT_FAILED" | "DEPOSIT_FAILED";
  message?: string;
  reservation: ReservationDetail;
}

/**
 * Charge the rental total and authorise the security deposit for a PENDING reservation.
 * Safe to retry: the same attempt reuses the same provider idempotency keys; after a failure the
 * customer can retry with another payment method (new attempt number).
 */
export async function payReservation(input: PayReservationInput, opts: Opts = {}): Promise<PayReservationResult> {
  const i = parseInput(payReservationInput, input);
  const provider = providerOf(opts);
  const now = opts.now ?? new Date();

  const prep = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, i.reservationId)).for("update");
    if (!r || r.userId !== i.userId) throw new ServiceError("NOT_FOUND", "Reservation not found");
    if (r.status === "CONFIRMED") return { done: true as const };
    if (r.status !== "PENDING") {
      throw new ServiceError("INVALID_STATE", `Reservation is ${r.status.toLowerCase()}`, { status: r.status });
    }
    if (r.holdExpiresAt && r.holdExpiresAt <= now) {
      throw new ServiceError("HOLD_EXPIRED", "Your hold on this vehicle expired, please search again");
    }
    const payment = await currentAttempt(tx, r, "charge");
    const deposit = r.depositFils > 0 ? await currentAttempt(tx, r, "deposit") : null;
    return { done: false as const, payment: payment as Payment, deposit: deposit as Deposit | null, reservation: r };
  });
  if (prep.done) return result(i.reservationId, "CONFIRMED");

  const { reservation: r } = prep;
  let payment = prep.payment;
  if (payment.status === "PENDING") {
    let res: ProviderPayment;
    try {
      res = await provider.createPayment({
        amount: payment.amountFils,
        currency: CURRENCY,
        paymentMethod: i.paymentMethod,
        idempotencyKey: payment.idempotencyKey,
        metadata: { reservationId: r.id, kind: "charge", paymentId: payment.id, reference: r.reference },
      });
    } catch (err) {
      log.warn("payment.provider_error", { reservationId: r.id, err });
      providerFailure(err);
    }
    payment = await recordProviderPayment(payment.id, res);
    log.info("payment.attempted", { reservationId: r.id, paymentId: payment.id, providerStatus: res.status });
    if (res.status === "failed" || res.status === "canceled") {
      return result(r.id, "PAYMENT_FAILED", res.status === "failed" ? "Your card was declined" : "Payment was cancelled");
    }
    if (res.status === "pending") return result(r.id, "PROCESSING", "Payment is processing");
  }
  if (payment.status === "FAILED" || payment.status === "CANCELLED") {
    return result(r.id, "PAYMENT_FAILED", "Payment failed");
  }

  const deposit = prep.deposit;
  if (deposit && deposit.status === "PENDING") {
    let hold: DepositHold;
    try {
      hold = await provider.holdDeposit({
        amount: deposit.amountFils,
        currency: CURRENCY,
        paymentMethod: i.paymentMethod,
        idempotencyKey: deposit.idempotencyKey,
        metadata: { reservationId: r.id, kind: "deposit", depositId: deposit.id, reference: r.reference },
      });
    } catch (err) {
      log.warn("deposit.provider_error", { reservationId: r.id, err });
      providerFailure(err);
    }
    await recordProviderHold(deposit.id, hold);
    log.info("deposit.attempted", { reservationId: r.id, depositId: deposit.id, providerStatus: hold.status });
    if (hold.status === "failed") {
      return result(r.id, "DEPOSIT_FAILED", "The security deposit could not be authorised");
    }
  }

  const detail = await loadReservationDetail(db, r.id);
  return result(r.id, detail?.reservation.status === "CONFIRMED" ? "CONFIRMED" : "PROCESSING");
}

async function result(reservationId: string, outcome: PayReservationResult["outcome"], message?: string) {
  const detail = await loadReservationDetail(db, reservationId);
  if (!detail) throw new ServiceError("NOT_FOUND", "Reservation not found");
  return { status: detail.reservation.status, outcome, message, reservation: detail };
}

/** Latest attempt row if it can still be used, otherwise a new attempt with the next idempotency key. */
async function currentAttempt(tx: Tx, r: Reservation, kind: "charge" | "deposit"): Promise<Payment | Deposit> {
  if (kind === "charge") {
    const rows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), eq(payments.purpose, "CHARGE")))
      .orderBy(desc(payments.createdAt));
    const latest = rows[0];
    if (latest && (latest.status === "PENDING" || latest.status === "SUCCEEDED") && latest.amountFils === r.totalFils) {
      return latest;
    }
    const [created] = await tx
      .insert(payments)
      .values({
        reservationId: r.id,
        provider: providerName(),
        idempotencyKey: `${r.id}:charge:${rows.length + 1}`,
        purpose: "CHARGE",
        amountFils: r.totalFils,
        currency: CURRENCY,
      })
      .returning();
    return created;
  }
  const rows = await tx.select().from(deposits).where(eq(deposits.reservationId, r.id)).orderBy(desc(deposits.createdAt));
  const latest = rows[0];
  if (latest && (latest.status === "PENDING" || latest.status === "AUTHORIZED")) return latest;
  const [created] = await tx
    .insert(deposits)
    .values({
      reservationId: r.id,
      provider: providerName(),
      idempotencyKey: `${r.id}:deposit:${rows.length + 1}`,
      amountFils: r.depositFils,
      currency: CURRENCY,
    })
    .returning();
  return created;
}

function providerName(): string {
  return process.env.PAYMENT_PROVIDER ?? "fake";
}

/** Store the provider id; only failures/refund amounts from the sync response are applied (never success). */
async function recordProviderPayment(paymentId: string, res: ProviderPayment): Promise<Payment> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    const next = mapPaymentStatus(res);
    const applyStatus = (next === "FAILED" || next === "CANCELLED") && row.status === "PENDING";
    const [updated] = await tx
      .update(payments)
      .set({
        providerPaymentId: row.providerPaymentId ?? res.id,
        ...(applyStatus ? { status: next, failureReason: res.failureReason ?? null } : {}),
        refundedFils: Math.max(row.refundedFils, res.refundedAmount),
      })
      .where(eq(payments.id, paymentId))
      .returning();
    return updated;
  });
}

async function recordProviderHold(depositId: string, hold: DepositHold): Promise<Deposit> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(deposits).where(eq(deposits.id, depositId)).for("update");
    const next = mapDepositStatus(hold);
    const applyStatus = next === "FAILED" && row.status === "PENDING";
    const [updated] = await tx
      .update(deposits)
      .set({
        providerHoldId: row.providerHoldId ?? hold.id,
        ...(applyStatus ? { status: next, failureReason: hold.failureReason ?? null } : {}),
      })
      .where(eq(deposits.id, depositId))
      .returning();
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookResult {
  status: "processed" | "duplicate" | "ignored";
  eventId: string;
  type: string;
  reservationId?: string;
}

/**
 * Verify and apply a provider webhook. Duplicate deliveries (same provider event id) are a no-op.
 * Throws ServiceError("INVALID_SIGNATURE") for bad signatures (respond 400).
 */
export async function handlePaymentWebhook(
  rawBody: string,
  signatureHeader: string | null,
  opts: Opts = {},
): Promise<WebhookResult> {
  const provider = providerOf(opts);
  let event: PaymentEvent;
  try {
    event = provider.verifyWebhook(rawBody, signatureHeader);
  } catch (err) {
    if (err instanceof PaymentError) throw new ServiceError("INVALID_SIGNATURE", err.message);
    throw err;
  }
  return applyPaymentEvent(event, { ...opts, provider });
}

/** Apply an already-verified event. Exported for tests and alternative webhook routes. */
export async function applyPaymentEvent(event: PaymentEvent, opts: Opts = {}): Promise<WebhookResult> {
  const provider = providerOf(opts);
  const meta = event.data.metadata ?? {};
  const reservationId = z.uuid().safeParse(meta.reservationId).success ? meta.reservationId : undefined;
  const base = { eventId: event.id, type: event.type, reservationId };

  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentWebhookEvents)
      .values({ provider: provider.name, eventId: event.id, type: event.type, payload: event })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.id });
    if (inserted.length === 0) return "duplicate" as const;

    let status: "processed" | "ignored" = "ignored";
    if (reservationId) {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
      if (r) {
        status = (await applyToRows(tx, event, meta.kind as Kind | undefined)) ? "processed" : "ignored";
        await tryConfirm(tx, r);
      }
    }
    await tx
      .update(paymentWebhookEvents)
      .set({ processedAt: new Date() })
      .where(and(eq(paymentWebhookEvents.provider, provider.name), eq(paymentWebhookEvents.eventId, event.id)));
    return status;
  });

  log.info("webhook.received", { ...base, outcome });
  if (outcome === "processed" && reservationId) {
    // Payment for an expired/cancelled reservation, refunds owed, etc.
    await settleReservation(reservationId, { ...opts, provider }).catch((err) =>
      log.error("settle.failed", { reservationId, err }),
    );
  }
  return { status: outcome, ...base };
}

async function applyToRows(tx: Tx, event: PaymentEvent, kind: Kind | undefined): Promise<boolean> {
  if (event.type.startsWith("payment.")) {
    const p = event.data as ProviderPayment;
    const where = p.metadata?.paymentId && z.uuid().safeParse(p.metadata.paymentId).success
      ? eq(payments.id, p.metadata.paymentId)
      : eq(payments.providerPaymentId, p.id);
    const [row] = await tx.select().from(payments).where(where).for("update");
    if (!row) return false;
    const next = mapPaymentStatus(p);
    const set: Partial<typeof payments.$inferInsert> = {
      providerPaymentId: row.providerPaymentId ?? p.id,
      refundedFils: Math.max(row.refundedFils, Math.min(p.refundedAmount, row.amountFils)),
    };
    if (PAYMENT_RANK[next] >= PAYMENT_RANK[row.status]) {
      set.status = next;
      if (p.failureReason) set.failureReason = p.failureReason;
    }
    await tx.update(payments).set(set).where(eq(payments.id, row.id));
    await writeAudit(tx, {
      actorUserId: null,
      action: `webhook.${event.type}`,
      entityType: "payment",
      entityId: row.id,
      data: { eventId: event.id, kind },
    });
    return true;
  }
  const h = event.data as DepositHold;
  const where = h.metadata?.depositId && z.uuid().safeParse(h.metadata.depositId).success
    ? eq(deposits.id, h.metadata.depositId)
    : eq(deposits.providerHoldId, h.id);
  const [row] = await tx.select().from(deposits).where(where).for("update");
  if (!row) return false;
  const next = mapDepositStatus(h);
  const set: Partial<typeof deposits.$inferInsert> = { providerHoldId: row.providerHoldId ?? h.id };
  if (DEPOSIT_RANK[next] >= DEPOSIT_RANK[row.status]) {
    set.status = next;
    if (next === "CAPTURED") set.capturedFils = Math.min(h.capturedAmount, row.amountFils);
    if (h.failureReason) set.failureReason = h.failureReason;
  }
  await tx.update(deposits).set(set).where(eq(deposits.id, row.id));
  await writeAudit(tx, {
    actorUserId: null,
    action: `webhook.${event.type}`,
    entityType: "deposit",
    entityId: row.id,
    data: { eventId: event.id },
  });
  return true;
}

/** PENDING -> CONFIRMED once the charge succeeded and the deposit (if any) is authorised. */
async function tryConfirm(tx: Tx, r: Reservation): Promise<void> {
  if (r.status === "CANCELLED") {
    // Fully refunded cancellation -> REFUNDED.
    const paid = await paidSummary(tx, r.id);
    if (r.refundedFils > 0 && paid.refundedFils >= r.refundedFils) {
      await tx.update(reservations).set({ status: "REFUNDED" }).where(eq(reservations.id, r.id));
      await writeAudit(tx, { actorUserId: null, action: "reservation.refunded", entityType: "reservation", entityId: r.id });
    }
    return;
  }
  if (r.status !== "PENDING") return;
  const [charge] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), eq(payments.purpose, "CHARGE"), eq(payments.status, "SUCCEEDED")))
    .limit(1);
  if (!charge || charge.amountFils < r.totalFils) return;
  if (r.depositFils > 0) {
    const [dep] = await tx
      .select()
      .from(deposits)
      .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "AUTHORIZED")))
      .limit(1);
    if (!dep) return;
  }
  const now = new Date();
  await tx
    .update(reservations)
    .set({ status: "CONFIRMED", confirmedAt: now, holdExpiresAt: null })
    .where(eq(reservations.id, r.id));
  await writeAudit(tx, { actorUserId: null, action: "reservation.confirmed", entityType: "reservation", entityId: r.id });
  log.info("reservation.confirmed", { reservationId: r.id });
}

// ---------------------------------------------------------------------------
// Settlement (refunds, deposit release / capture)
// ---------------------------------------------------------------------------

export async function paidSummary(ex: Tx | typeof db, reservationId: string) {
  const [s] = await ex
    .select({
      paidFils: sql<number>`coalesce(sum(${payments.amountFils}) filter (where ${payments.status} in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')), 0)::int`,
      refundedFils: sql<number>`coalesce(sum(${payments.refundedFils}), 0)::int`,
    })
    .from(payments)
    .where(eq(payments.reservationId, reservationId));
  return s;
}

export interface SettlementResult {
  reservationId: string;
  refundedFils: number;
  depositsReleased: number;
  depositsCaptured: number;
  paymentsCancelled: number;
}

/**
 * Idempotent: brings provider-side money in line with the reservation.
 * - EXPIRED: refund everything paid, cancel pending payments, release deposit holds.
 * - CANCELLED / REFUNDED / CONFIRMED / PENDING: refund up to reservations.refunded_fils (the refund owed).
 * - CANCELLED / REFUNDED: also release deposit holds and cancel pending payments.
 * - RETURNED: capture min(late/extra charges, deposit) from the deposit and release the rest.
 * Serialised per reservation with an advisory lock; no row locks are held while calling the provider.
 */
export async function settleReservation(reservationId: string, opts: Opts = {}): Promise<SettlementResult> {
  const provider = providerOf(opts);
  const out: SettlementResult = { reservationId, refundedFils: 0, depositsReleased: 0, depositsCaptured: 0, paymentsCancelled: 0 };
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`settle:${reservationId}`]);
    const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
    if (!r) return out;
    const pays = await db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, r.id))
      .orderBy(asc(payments.createdAt));
    const deps = await db.select().from(deposits).where(eq(deposits.reservationId, r.id));
    const closed = r.status === "EXPIRED" || r.status === "CANCELLED" || r.status === "REFUNDED";

    // Refunds
    const paid = pays.filter((p) => ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
    const paidFils = paid.reduce((s, p) => s + p.amountFils, 0);
    const refundedSoFar = pays.reduce((s, p) => s + p.refundedFils, 0);
    const target = r.status === "EXPIRED" ? paidFils : Math.min(r.refundedFils, paidFils);
    let owed = target - refundedSoFar;
    for (const p of paid) {
      if (owed <= 0) break;
      const room = p.amountFils - p.refundedFils;
      if (room <= 0 || !p.providerPaymentId) continue;
      const amount = Math.min(room, owed);
      try {
        const res = await provider.refundPayment(p.providerPaymentId, amount);
        await recordProviderPayment(p.id, res);
        owed -= amount;
        out.refundedFils += amount;
        log.info("payment.refunded", { reservationId, paymentId: p.id, amount });
      } catch (err) {
        log.error("payment.refund_failed", { reservationId, paymentId: p.id, err });
      }
    }

    if (closed) {
      for (const p of pays.filter((p) => p.status === "PENDING" && p.providerPaymentId)) {
        try {
          const res = await provider.cancelPayment(p.providerPaymentId!);
          await recordProviderPayment(p.id, res);
          await db.update(payments).set({ status: "CANCELLED" }).where(and(eq(payments.id, p.id), eq(payments.status, "PENDING")));
          out.paymentsCancelled++;
        } catch (err) {
          log.error("payment.cancel_failed", { reservationId, paymentId: p.id, err });
        }
      }
    }

    // Deposits
    const held = deps.filter((d) => d.status === "AUTHORIZED" && d.providerHoldId);
    if (closed || r.status === "RETURNED") {
      let toCapture = r.status === "RETURNED" ? r.lateFeeFils : 0;
      for (const d of held) {
        try {
          if (toCapture > 0) {
            const amount = Math.min(toCapture, d.amountFils);
            const h = await provider.captureDeposit(d.providerHoldId!, amount);
            await db
              .update(deposits)
              .set({ capturedFils: h.capturedAmount, status: "CAPTURED" })
              .where(and(eq(deposits.id, d.id), eq(deposits.status, "AUTHORIZED")));
            toCapture -= amount;
            out.depositsCaptured++;
          } else {
            await provider.releaseDeposit(d.providerHoldId!);
            await db
              .update(deposits)
              .set({ status: "RELEASED" })
              .where(and(eq(deposits.id, d.id), eq(deposits.status, "AUTHORIZED")));
            out.depositsReleased++;
          }
        } catch (err) {
          log.error("deposit.settle_failed", { reservationId, depositId: d.id, err });
        }
      }
      if (toCapture > 0 && r.status === "RETURNED") {
        log.warn("settle.uncollected_charges", { reservationId, uncollectedFils: toCapture });
      }
    }

    if (r.status === "CANCELLED" && r.refundedFils > 0) {
      const s = await paidSummary(db, r.id);
      if (s.refundedFils >= r.refundedFils) {
        const updated = await db
          .update(reservations)
          .set({ status: "REFUNDED" })
          .where(and(eq(reservations.id, r.id), eq(reservations.status, "CANCELLED")))
          .returning({ id: reservations.id });
        if (updated.length) {
          await writeAudit(db, { actorUserId: null, action: "reservation.refunded", entityType: "reservation", entityId: r.id });
        }
      }
    }
    if (out.refundedFils || out.depositsCaptured || out.depositsReleased || out.paymentsCancelled) {
      log.info("settle.done", { ...out });
    }
    return out;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`settle:${reservationId}`]).catch(() => {});
    client.release();
  }
}

/** Reservations whose money is not settled yet (used by the release-holds job). */
export async function findUnsettledReservations(limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      sql`(
        (${reservations.status} IN ('EXPIRED','CANCELLED','REFUNDED','RETURNED')
          AND EXISTS (SELECT 1 FROM ${deposits} d WHERE d.reservation_id = ${reservations.id} AND d.status = 'AUTHORIZED'))
        OR (${reservations.status} IN ('EXPIRED','CANCELLED','REFUNDED')
          AND EXISTS (SELECT 1 FROM ${payments} p WHERE p.reservation_id = ${reservations.id} AND p.status = 'PENDING' AND p.provider_payment_id IS NOT NULL))
        OR (${reservations.status} = 'EXPIRED' AND EXISTS (SELECT 1 FROM ${payments} p WHERE p.reservation_id = ${reservations.id}
              AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND p.refunded_fils < p.amount_fils))
        OR (${reservations.status} <> 'EXPIRED' AND ${reservations.refundedFils} >
              (SELECT coalesce(sum(p.refunded_fils), 0) FROM ${payments} p WHERE p.reservation_id = ${reservations.id})
            AND EXISTS (SELECT 1 FROM ${payments} p WHERE p.reservation_id = ${reservations.id}
              AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND p.refunded_fils < p.amount_fils))
      )`,
    )
    .orderBy(asc(reservations.updatedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}


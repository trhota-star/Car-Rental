import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { reservations } from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { flagStrandedBookings } from "./availability";
import { db } from "./db";
import { log } from "./log";
import { findUnsettledReservations, settleReservation } from "./payments";
import type { PaymentProvider } from "@/lib/payments";

export interface ReleaseHoldsJobResult {
  /** PENDING holds marked EXPIRED in this run. */
  released: number;
  /** Reservations whose money was settled (refunds, deposit release/capture) in this run. */
  settled: number;
  ranAt: string;
}

/**
 * Expire PENDING reservations whose hold_expires_at has passed, then settle money for any
 * expired / cancelled / returned reservation that still has something outstanding.
 * Idempotent: running it again (or concurrently) does nothing new.
 */
export async function releaseExpiredHolds(
  now: Date = new Date(),
  opts: { provider?: PaymentProvider } = {},
): Promise<ReleaseHoldsJobResult> {
  const expired = await db.transaction(async (tx) => {
    const rows = await tx
      .update(reservations)
      .set({ status: "EXPIRED", updatedAt: now })
      .where(
        and(
          eq(reservations.status, "PENDING"),
          sql`${reservations.holdExpiresAt} <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: reservations.id, vehicleId: reservations.vehicleId, pickupAt: reservations.pickupAt });
    for (const r of rows) {
      await writeAudit(tx, { actorUserId: null, action: "reservation.expired", entityType: "reservation", entityId: r.id });
      // An expired one-way hold can leave a later booking's car at the wrong branch: flag for staff.
      await flagStrandedBookings(tx, r.vehicleId, r.pickupAt, now);
    }
    return rows.map((r) => r.id);
  });

  let settled = 0;
  for (const id of await findUnsettledReservations()) {
    try {
      const s = await settleReservation(id, opts);
      if (s.refundedFils || s.depositsReleased || s.depositsCaptured || s.paymentsCancelled) settled++;
    } catch (err) {
      log.error("holds.settle_failed", { reservationId: id, err });
    }
  }
  const result = { released: expired.length, settled, ranAt: now.toISOString() };
  log.info("job.release_holds", { ...result });
  return result;
}

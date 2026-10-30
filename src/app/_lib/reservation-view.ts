import type { PriceSummary } from "@/components/price-breakdown";
import type { Reservation } from "@/lib/db/schema";

/** The price snapshot stored on a reservation, in the shape PriceBreakdown renders. */
export function reservationPrice(
  r: Reservation,
  extras: Array<{ extraId: string; name: string; pricing: string; quantity: number; unitPriceFils: number; totalFils: number }>,
): PriceSummary {
  return {
    currency: r.currency,
    rentalDays: r.rentalDays,
    dailyRateFils: r.dailyRateFils,
    baseFils: r.baseFils,
    extras,
    extrasFils: r.extrasFils,
    oneWayFeeFils: r.oneWayFeeFils,
    subtotalFils: r.subtotalFils,
    vatRateBp: r.vatRateBp,
    vatFils: r.vatFils,
    totalFils: r.totalFils,
    depositFils: r.depositFils,
  };
}

/** Statuses for which the pick-up voucher is meaningful. */
export const VOUCHER_STATUSES = new Set<Reservation["status"]>(["CONFIRMED", "PICKED_UP", "RETURNED"]);

/** True while a PENDING reservation's hold has not yet expired (request time). */
export function isHoldActive(r: Pick<Reservation, "status" | "holdExpiresAt">, now: Date = new Date()): boolean {
  return r.status === "PENDING" && r.holdExpiresAt !== null && r.holdExpiresAt.getTime() > now.getTime();
}

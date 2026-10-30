// Pure pricing rules (no DB, no server-only) so they are easy to unit test.
// All money is integer fils. VAT rates are basis points (500 = 5%).
import { DAY_MS, HOUR_MS, rentalDays } from "./time";

export const LATE_RETURN_GRACE_MINUTES = 60;
/** Each started late hour costs 1/6 of the daily rate (rounded up), capped at one daily rate per 24h. */
export const LATE_HOURS_PER_DAILY_RATE = 6;
/** Free cancellation if cancelled more than this many hours before pick-up. */
export const FREE_CANCELLATION_HOURS = 48;
/** How long a PENDING reservation holds the vehicle while the customer pays. */
export const HOLD_MINUTES = 15;

export interface RuleCandidate {
  id: string;
  vehicleId: string | null;
  categoryId: string | null;
  branchId: string | null;
  dailyRateFils: number;
  minDays: number;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  isActive: boolean;
}

/**
 * Pick the most specific rule for a vehicle: vehicle rule > category rule, branch rule > any branch,
 * larger min_days, then higher priority. `pickupDate` is the branch-local YYYY-MM-DD of pick-up.
 */
export function selectPricingRule<R extends RuleCandidate>(
  rules: R[],
  ctx: { vehicleId: string; categoryId: string; branchId: string; days: number; pickupDate: string },
): R | undefined {
  const matching = rules.filter(
    (r) =>
      r.isActive &&
      (r.vehicleId === ctx.vehicleId || (r.vehicleId === null && r.categoryId === ctx.categoryId)) &&
      (r.branchId === null || r.branchId === ctx.branchId) &&
      r.minDays <= ctx.days &&
      (r.validFrom === null || r.validFrom <= ctx.pickupDate) &&
      (r.validTo === null || ctx.pickupDate <= r.validTo),
  );
  const score = (r: R) => [r.vehicleId ? 1 : 0, r.branchId ? 1 : 0, r.minDays, r.priority];
  matching.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return a.id < b.id ? -1 : 1;
  });
  return matching[0];
}

/** VAT on an amount, rounded half-up to whole fils. */
export function vatOn(amountFils: number, vatRateBp: number): number {
  return Math.floor((amountFils * vatRateBp + 5000) / 10000);
}

export interface ExtraLineInput {
  extraId: string;
  code: string;
  name: string;
  pricing: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxChargeFils: number | null;
  quantity: number;
}

export interface ExtraLine extends ExtraLineInput {
  /** Same as priceFils (per day or per rental, see `pricing`). */
  unitPriceFils: number;
  totalFils: number;
}

export function priceExtra(extra: ExtraLineInput, days: number): ExtraLine {
  let perUnit = extra.pricing === "PER_DAY" ? extra.priceFils * days : extra.priceFils;
  if (extra.pricing === "PER_DAY" && extra.maxChargeFils !== null) perUnit = Math.min(perUnit, extra.maxChargeFils);
  return { ...extra, unitPriceFils: extra.priceFils, totalFils: perUnit * extra.quantity };
}

export interface QuoteInput {
  pickupAt: Date;
  returnAt: Date;
  dailyRateFils: number;
  extras: ExtraLineInput[];
  /** Fee charged when return branch differs from pick-up branch (0 otherwise). */
  oneWayFeeFils: number;
  vatRateBp: number;
  depositFils: number;
}

export interface Quote {
  currency: "AED";
  rentalDays: number;
  dailyRateFils: number;
  baseFils: number;
  extras: ExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  subtotalFils: number;
  vatRateBp: number;
  vatFils: number;
  totalFils: number;
  /** Held on the card, not charged. */
  depositFils: number;
}

export function computeQuote(input: QuoteInput): Quote {
  const days = rentalDays(input.pickupAt, input.returnAt);
  const baseFils = input.dailyRateFils * days;
  const extras = input.extras.map((e) => priceExtra(e, days));
  const extrasFils = extras.reduce((s, e) => s + e.totalFils, 0);
  const subtotalFils = baseFils + extrasFils + input.oneWayFeeFils;
  const vatFils = vatOn(subtotalFils, input.vatRateBp);
  return {
    currency: "AED",
    rentalDays: days,
    dailyRateFils: input.dailyRateFils,
    baseFils,
    extras,
    extrasFils,
    oneWayFeeFils: input.oneWayFeeFils,
    subtotalFils,
    vatRateBp: input.vatRateBp,
    vatFils,
    totalFils: subtotalFils + vatFils,
    depositFils: input.depositFils,
  };
}

export interface LateFee {
  lateMinutes: number;
  chargedHours: number;
  netFils: number;
  vatFils: number;
  totalFils: number;
}

/**
 * Late-return charge. Free within a 60-minute grace period. After that every started hour
 * costs ceil(daily/6), capped at one daily rate per started 24h block; full extra days are
 * charged at the daily rate. VAT is added.
 */
export function computeLateFee(input: {
  scheduledReturnAt: Date;
  actualReturnAt: Date;
  dailyRateFils: number;
  vatRateBp: number;
}): LateFee {
  const lateMs = input.actualReturnAt.getTime() - input.scheduledReturnAt.getTime();
  const lateMinutes = Math.max(0, Math.floor(lateMs / 60_000));
  if (lateMinutes <= LATE_RETURN_GRACE_MINUTES) {
    return { lateMinutes, chargedHours: 0, netFils: 0, vatFils: 0, totalFils: 0 };
  }
  const hours = Math.ceil(lateMs / HOUR_MS);
  const hourly = Math.ceil(input.dailyRateFils / LATE_HOURS_PER_DAILY_RATE);
  const fullDays = Math.floor(lateMs / DAY_MS);
  const remHours = hours - fullDays * 24;
  const netFils = fullDays * input.dailyRateFils + Math.min(remHours * hourly, input.dailyRateFils);
  const vatFils = vatOn(netFils, input.vatRateBp);
  return { lateMinutes, chargedHours: hours, netFils, vatFils, totalFils: netFils + vatFils };
}

export interface CancellationTerms {
  free: boolean;
  /** Fee kept (VAT inclusive), never more than what was paid. */
  feeFils: number;
  refundFils: number;
}

/**
 * Cancellation policy: free (full refund) when cancelled more than 48 hours before pick-up;
 * otherwise one day's rental charge (daily rate + VAT) is kept and the rest refunded.
 * The security deposit hold is always released.
 */
export function cancellationTerms(input: {
  now: Date;
  pickupAt: Date;
  dailyRateFils: number;
  vatRateBp: number;
  paidFils: number;
}): CancellationTerms {
  const hoursBefore = (input.pickupAt.getTime() - input.now.getTime()) / HOUR_MS;
  if (hoursBefore > FREE_CANCELLATION_HOURS) return { free: true, feeFils: 0, refundFils: input.paidFils };
  const oneDay = input.dailyRateFils + vatOn(input.dailyRateFils, input.vatRateBp);
  const feeFils = Math.min(oneDay, input.paidFils);
  return { free: false, feeFils, refundFils: input.paidFils - feeFils };
}

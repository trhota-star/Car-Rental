import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { branches, extras, pricingRules, vehicleCategories, vehicles, type Branch } from "@/lib/db/schema";
import { db, type Executor } from "./db";
import { parseInput, ServiceError } from "./errors";
import {
  computeQuote,
  selectPricingRule,
  type ExtraLineInput,
  type Quote,
  type RuleCandidate,
} from "./pricing-core";
import { DAY_MS, localDate, localMinuteOfDay, rentalDays } from "./time";

export * from "./pricing-core";

export const MAX_RENTAL_DAYS = 90;
/** Pick-up may be at most this far in the past (clock skew / slow forms). */
const PICKUP_PAST_TOLERANCE_MS = 5 * 60_000;

export const extraSelectionSchema = z
  .array(z.object({ extraId: z.uuid(), quantity: z.number().int().min(1).max(10).default(1) }))
  .max(20)
  .default([])
  .refine((xs) => new Set(xs.map((x) => x.extraId)).size === xs.length, "Duplicate extra");

export const rentalWindowSchema = z.object({
  pickupBranchId: z.uuid(),
  /** Defaults to the pick-up branch. */
  returnBranchId: z.uuid().optional(),
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
});

/** Check dates, opening hours and branch status. Throws VALIDATION_ERROR / BRANCH_CLOSED. */
export function validateRentalWindow(
  pickupBranch: Branch,
  returnBranch: Branch,
  pickupAt: Date,
  returnAt: Date,
  now: Date = new Date(),
): void {
  if (!(returnAt > pickupAt)) throw new ServiceError("VALIDATION_ERROR", "Return must be after pick-up");
  if (pickupAt.getTime() < now.getTime() - PICKUP_PAST_TOLERANCE_MS) {
    throw new ServiceError("VALIDATION_ERROR", "Pick-up time is in the past");
  }
  if (returnAt.getTime() - pickupAt.getTime() > MAX_RENTAL_DAYS * DAY_MS) {
    throw new ServiceError("VALIDATION_ERROR", `Rentals are limited to ${MAX_RENTAL_DAYS} days`);
  }
  for (const [branch, at, what] of [
    [pickupBranch, pickupAt, "pick-up"],
    [returnBranch, returnAt, "return"],
  ] as const) {
    if (!branch.isActive) throw new ServiceError("BRANCH_CLOSED", `${branch.name} is not accepting rentals`);
    const minute = localMinuteOfDay(at, branch.timeZone);
    if (minute < branch.opensAtMinute || minute >= branch.closesAtMinute) {
      throw new ServiceError("BRANCH_CLOSED", `${branch.name} is closed at the requested ${what} time`, {
        branchId: branch.id,
        opensAtMinute: branch.opensAtMinute,
        closesAtMinute: branch.closesAtMinute,
      });
    }
  }
}

export async function loadActiveRules(ex: Executor, filter?: { vehicleId: string; categoryId: string }) {
  const where = filter
    ? and(
        eq(pricingRules.isActive, true),
        or(eq(pricingRules.vehicleId, filter.vehicleId), eq(pricingRules.categoryId, filter.categoryId)),
      )
    : eq(pricingRules.isActive, true);
  return ex.select().from(pricingRules).where(where);
}

export function dailyRateFor(
  rules: RuleCandidate[],
  vehicle: { id: string; categoryId: string },
  pickupBranch: Branch,
  pickupAt: Date,
  returnAt: Date,
): number | undefined {
  return selectPricingRule(rules, {
    vehicleId: vehicle.id,
    categoryId: vehicle.categoryId,
    branchId: pickupBranch.id,
    days: rentalDays(pickupAt, returnAt),
    pickupDate: localDate(pickupAt, pickupBranch.timeZone),
  })?.dailyRateFils;
}

async function loadBranch(ex: Executor, id: string): Promise<Branch> {
  const [b] = await ex.select().from(branches).where(eq(branches.id, id));
  if (!b) throw new ServiceError("NOT_FOUND", "Branch not found", { branchId: id });
  return b;
}

export async function loadExtraLines(
  ex: Executor,
  selection: { extraId: string; quantity: number }[],
): Promise<ExtraLineInput[]> {
  if (selection.length === 0) return [];
  const rows = await ex
    .select()
    .from(extras)
    .where(
      inArray(
        extras.id,
        selection.map((s) => s.extraId),
      ),
    );
  return selection.map((s) => {
    const e = rows.find((r) => r.id === s.extraId);
    if (!e || !e.isActive) throw new ServiceError("VALIDATION_ERROR", "Unknown extra", { extraId: s.extraId });
    if (s.quantity > e.maxQuantity) {
      throw new ServiceError("VALIDATION_ERROR", `At most ${e.maxQuantity} × ${e.name}`, { extraId: e.id });
    }
    return {
      extraId: e.id,
      code: e.code,
      name: e.name,
      pricing: e.pricing,
      priceFils: e.priceFils,
      maxChargeFils: e.maxChargeFils,
      quantity: s.quantity,
    };
  });
}

export interface QuoteParams {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras: { extraId: string; quantity: number }[];
  now?: Date;
}

/** Server-side price for one vehicle. Used by quoteRental and inside the reservation transaction. */
export async function quoteVehicle(ex: Executor, p: QuoteParams) {
  const [row] = await ex
    .select({ vehicle: vehicles, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, p.vehicleId));
  if (!row) throw new ServiceError("NOT_FOUND", "Vehicle not found", { vehicleId: p.vehicleId });
  const pickupBranch = await loadBranch(ex, p.pickupBranchId);
  const returnBranch = p.returnBranchId === p.pickupBranchId ? pickupBranch : await loadBranch(ex, p.returnBranchId);
  validateRentalWindow(pickupBranch, returnBranch, p.pickupAt, p.returnAt, p.now);

  const rules = await loadActiveRules(ex, { vehicleId: row.vehicle.id, categoryId: row.vehicle.categoryId });
  const daily = dailyRateFor(rules, row.vehicle, pickupBranch, p.pickupAt, p.returnAt);
  if (daily === undefined) throw new ServiceError("NO_PRICE", "No price is configured for this vehicle");

  const quote: Quote = computeQuote({
    pickupAt: p.pickupAt,
    returnAt: p.returnAt,
    dailyRateFils: daily,
    extras: await loadExtraLines(ex, p.extras),
    oneWayFeeFils: returnBranch.id === pickupBranch.id ? 0 : returnBranch.oneWayFeeFils,
    vatRateBp: pickupBranch.vatRateBp,
    depositFils: row.category.securityDepositFils,
  });
  return { quote, vehicle: row.vehicle, category: row.category, pickupBranch, returnBranch };
}

export const quoteRentalInput = rentalWindowSchema.extend({
  vehicleId: z.uuid(),
  extras: extraSelectionSchema,
});
export type QuoteRentalInput = z.input<typeof quoteRentalInput>;

/** Price breakdown for the checkout page. Does not reserve anything. */
export async function quoteRental(input: QuoteRentalInput): Promise<Quote> {
  const i = parseInput(quoteRentalInput, input);
  const { quote } = await quoteVehicle(db, {
    ...i,
    returnBranchId: i.returnBranchId ?? i.pickupBranchId,
  });
  return quote;
}

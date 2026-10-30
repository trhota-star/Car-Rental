// QA-5 (unit): pure pricing rules checked against independently computed expected values (hand-worked).
// Policy (from db's spec): daily rate × started 24h (min 1); PER_DAY extras × days, optional cap per unit;
// PER_RENTAL extras flat; one-way fee when return branch differs; VAT 5% (bp) half-up on the subtotal;
// deposit = category deposit, held not charged. Late: 60 min grace, then each started hour from the
// scheduled return costs ceil(daily/6), capped at one daily rate per 24h block, + VAT.
// Cancellation: > 48h before pick-up free; otherwise one day (rate + VAT) kept, capped at what was paid.
import { describe, expect, it } from "vitest";
import {
  cancellationTerms,
  computeLateFee,
  computeQuote,
  priceExtra,
  selectPricingRule,
  vatOn,
  type ExtraLineInput,
  type RuleCandidate,
} from "@/server/pricing-core";
import { rentalDays } from "@/server/time";

const T = new Date("2026-12-01T08:00:00Z");
const H = 3_600_000;
const at = (hours: number) => new Date(T.getTime() + hours * H);

describe("rentalDays", () => {
  it.each([
    [1, 1], // 1 hour -> 1 day minimum
    [24, 1],
    [24 + 1 / 60, 2], // one minute over a day starts day 2
    [48, 2],
    [72 + 1, 4],
    [90 * 24, 90],
  ])("%f hours -> %i days", (hours, days) => {
    expect(rentalDays(T, at(hours))).toBe(days);
  });
});

describe("VAT rounding (half-up, integer fils)", () => {
  it.each([
    [10_000, 500, 500],
    [12_345, 500, 617], // 617.25
    [12_350, 500, 618], // 617.50 -> up
    [12_349, 500, 617], // 617.45
    [1, 500, 0], // 0.05
    [10, 500, 1], // 0.5 -> up
    [99_999, 0, 0],
    [100_000, 1_000, 10_000],
  ])("vat(%i, %i bp) = %i", (amount, bp, vat) => {
    expect(vatOn(amount, bp)).toBe(vat);
  });
});

const extra = (o: Partial<ExtraLineInput>): ExtraLineInput => ({
  extraId: "e",
  code: "E",
  name: "E",
  pricing: "PER_DAY",
  priceFils: 2_500,
  maxChargeFils: null,
  quantity: 1,
  ...o,
});

describe("extras", () => {
  it("PER_DAY multiplies by days and quantity", () => {
    expect(priceExtra(extra({ quantity: 2 }), 3).totalFils).toBe(2_500 * 3 * 2);
  });
  it("PER_DAY cap applies per unit for the whole rental", () => {
    expect(priceExtra(extra({ priceFils: 3_000, maxChargeFils: 8_000, quantity: 2 }), 4).totalFils).toBe(16_000);
    expect(priceExtra(extra({ priceFils: 3_000, maxChargeFils: 8_000 }), 2).totalFils).toBe(6_000); // under cap
  });
  it("PER_RENTAL is flat regardless of days", () => {
    expect(priceExtra(extra({ pricing: "PER_RENTAL", priceFils: 5_000 }), 10).totalFils).toBe(5_000);
  });
});

describe("computeQuote: full worked example", () => {
  it("4 days, 3 extras, one-way fee, 5% VAT, deposit", () => {
    // 73h -> 4 days. base 4 × 150.00 = 600.00
    // GPS 25/day × 4 = 100.00; child seat 30/day × 4 = 120 capped 80 × 2 = 160.00; insurance 50 flat
    // extras 310.00; one-way 200.00; subtotal 1110.00; VAT 55.50; total 1165.50; deposit 1000.00
    const q = computeQuote({
      pickupAt: T,
      returnAt: at(73),
      dailyRateFils: 15_000,
      extras: [
        extra({ extraId: "gps", priceFils: 2_500 }),
        extra({ extraId: "seat", priceFils: 3_000, maxChargeFils: 8_000, quantity: 2 }),
        extra({ extraId: "ins", pricing: "PER_RENTAL", priceFils: 5_000 }),
      ],
      oneWayFeeFils: 20_000,
      vatRateBp: 500,
      depositFils: 100_000,
    });
    expect(q).toMatchObject({
      currency: "AED",
      rentalDays: 4,
      baseFils: 60_000,
      extrasFils: 31_000,
      oneWayFeeFils: 20_000,
      subtotalFils: 111_000,
      vatFils: 5_550,
      totalFils: 116_550,
      depositFils: 100_000,
    });
    expect(q.extras.map((e) => e.totalFils)).toEqual([10_000, 16_000, 5_000]);
    // Deposit is never part of the charged total.
    expect(q.totalFils).toBe(q.subtotalFils + q.vatFils);
  });

  it("all amounts are integers for awkward rates", () => {
    const q = computeQuote({
      pickupAt: T,
      returnAt: at(49),
      dailyRateFils: 12_345,
      extras: [],
      oneWayFeeFils: 0,
      vatRateBp: 500,
      depositFils: 0,
    });
    // 3 days × 123.45 = 370.35; VAT 18.5175 -> 18.52; total 388.87
    expect([q.baseFils, q.vatFils, q.totalFils]).toEqual([37_035, 1_852, 38_887]);
  });
});

describe("late return fee (daily 150.00, hourly ceil(150/6) = 25.00, 5% VAT)", () => {
  it.each([
    [0, 0],
    [30, 0],
    [60, 0], // end of grace
    [61, 5_250], // 2 started hours from scheduled return: 50.00 + 2.50 VAT
    [180, 7_875], // 3h: 75.00 + 3.75
    [7 * 60, 15_750], // 7h -> 175 capped at one day 150 + 7.50
    [24 * 60, 15_750], // exactly one day
    [25 * 60, 18_375], // 1 day + 1h: 175.00 + 8.75
    [30 * 60, 31_500], // 1 day + 6h (capped day): 300 + 15
  ])("%i minutes late -> %i fils", (minutes, total) => {
    const fee = computeLateFee({
      scheduledReturnAt: T,
      actualReturnAt: new Date(T.getTime() + minutes * 60_000),
      dailyRateFils: 15_000,
      vatRateBp: 500,
    });
    expect(fee.totalFils).toBe(total);
    expect(fee.totalFils).toBe(fee.netFils + fee.vatFils);
  });

  it("early return is never charged", () => {
    expect(
      computeLateFee({ scheduledReturnAt: T, actualReturnAt: at(-5), dailyRateFils: 15_000, vatRateBp: 500 }).totalFils,
    ).toBe(0);
  });
});

describe("cancellation terms (daily 150.00 + VAT = 157.50 fee)", () => {
  const base = { pickupAt: T, dailyRateFils: 15_000, vatRateBp: 500, paidFils: 47_250 };
  it("more than 48h before pick-up: free, full refund", () => {
    expect(cancellationTerms({ ...base, now: at(-48 - 1 / 60) })).toEqual({ free: true, feeFils: 0, refundFils: 47_250 });
  });
  it("exactly 48h before: one day kept", () => {
    expect(cancellationTerms({ ...base, now: at(-48) })).toEqual({ free: false, feeFils: 15_750, refundFils: 31_500 });
  });
  it("fee never exceeds what was paid", () => {
    expect(cancellationTerms({ ...base, now: at(-1), paidFils: 10_000 })).toEqual({
      free: false,
      feeFils: 10_000,
      refundFils: 0,
    });
  });
});

describe("pricing rule selection", () => {
  const r = (o: Partial<RuleCandidate>): RuleCandidate => ({
    id: Math.random().toString(36),
    vehicleId: null,
    categoryId: "cat",
    branchId: null,
    dailyRateFils: 10_000,
    minDays: 1,
    validFrom: null,
    validTo: null,
    priority: 0,
    isActive: true,
    ...o,
  });
  const ctx = { vehicleId: "veh", categoryId: "cat", branchId: "br", days: 3, pickupDate: "2026-12-01" };
  const rules = [
    r({ dailyRateFils: 10_000 }),
    r({ dailyRateFils: 12_000, branchId: "br" }),
    r({ dailyRateFils: 14_000, vehicleId: "veh" }),
    r({ dailyRateFils: 11_000, vehicleId: "veh", minDays: 7 }),
    r({ dailyRateFils: 1_000, vehicleId: "veh", isActive: false }),
    r({ dailyRateFils: 2_000, vehicleId: "veh", branchId: "br", validFrom: "2027-01-01", validTo: "2027-01-31" }),
    r({ dailyRateFils: 3_000, vehicleId: "other" }),
    r({ dailyRateFils: 4_000, categoryId: "other-cat" }),
  ];
  it("vehicle rule beats category rules; inactive and out-of-season rules ignored", () => {
    expect(selectPricingRule(rules, ctx)?.dailyRateFils).toBe(14_000);
  });
  it("long-rental rule applies from min_days", () => {
    expect(selectPricingRule(rules, { ...ctx, days: 7 })?.dailyRateFils).toBe(11_000);
  });
  it("season rule applies inside its dates (inclusive)", () => {
    expect(selectPricingRule(rules, { ...ctx, pickupDate: "2027-01-31" })?.dailyRateFils).toBe(2_000);
  });
  it("category: branch-specific beats any-branch; none -> undefined", () => {
    const other = { ...ctx, vehicleId: "v2" };
    expect(selectPricingRule(rules, other)?.dailyRateFils).toBe(12_000);
    expect(selectPricingRule(rules, { ...other, branchId: "b2" })?.dailyRateFils).toBe(10_000);
    expect(selectPricingRule(rules, { ...other, categoryId: "nope" })).toBeUndefined();
  });
});

// QA-3: search, branch selection, date ranges, filters, availability calendar.
// QA-5 (DB level): quoteRental picks the right rule and prices extras / one-way / VAT / deposit.
import { beforeEach, describe, expect, it } from "vitest";
import { getVehicleCalendar, isVehicleAvailable, searchVehicles } from "@/server/availability";
import { quoteRental } from "@/server/pricing";
import { truncateAll } from "../helpers/db";
import {
  DAY,
  HOUR,
  createBranch,
  createCategory,
  createExtra,
  createMaintenanceBlock,
  createPricingRule,
  createReservation,
  createVehicle,
  futureAt,
} from "../helpers/factories";
import { settle } from "../helpers/booking";

async function fleet() {
  const dxb = await createBranch({ name: "Dubai Airport", oneWayFeeFils: 25_000 });
  const auh = await createBranch({ name: "Abu Dhabi", city: "Abu Dhabi", emirate: "Abu Dhabi", oneWayFeeFils: 30_000 });
  const eco = await createCategory({ name: "Economy", securityDepositFils: 50_000 });
  const suv = await createCategory({ name: "SUV", securityDepositFils: 200_000 });
  await createPricingRule({ categoryId: eco.id, dailyRateFils: 10_000 });
  await createPricingRule({ categoryId: suv.id, dailyRateFils: 30_000 });
  const corolla = await createVehicle({ branchId: dxb.id, categoryId: eco.id, make: "Toyota", model: "Corolla" });
  const sunny = await createVehicle({
    branchId: dxb.id,
    categoryId: eco.id,
    make: "Nissan",
    model: "Sunny",
    transmission: "MANUAL",
    dailyRateFils: 8_000, // vehicle rule beats the category rate
  });
  const patrol = await createVehicle({
    branchId: dxb.id,
    categoryId: suv.id,
    make: "Nissan",
    model: "Patrol",
    seats: 7,
    fuelType: "DIESEL",
  });
  const tesla = await createVehicle({ branchId: auh.id, categoryId: suv.id, make: "Tesla", model: "Y", fuelType: "ELECTRIC" });
  const unpriced = await createVehicle({ branchId: dxb.id, categoryId: (await createCategory()).id, make: "Unpriced" });
  const retired = await createVehicle({ branchId: dxb.id, categoryId: eco.id, make: "Old", status: "RETIRED" });
  return { dxb, auh, eco, suv, corolla, sunny, patrol, tesla, unpriced, retired };
}

describe("searchVehicles", () => {
  beforeEach(() => truncateAll());

  it("returns only priced, rentable vehicles at the pick-up branch, cheapest first", async () => {
    const f = await fleet();
    const p = futureAt(5);
    const res = await searchVehicles({ pickupBranchId: f.dxb.id, pickupAt: p, returnAt: new Date(+p + 2 * DAY) });
    expect(res.map((r) => r.vehicle.id)).toEqual([f.sunny.id, f.corolla.id, f.patrol.id]);
    expect(res.map((r) => r.dailyRateFils)).toEqual([8_000, 10_000, 30_000]);
    // 2 days × 100.00 = 200.00 + VAT 10.00
    expect(res[1]).toMatchObject({ rentalDays: 2, estimatedTotalFils: 21_000, depositFils: 50_000 });
    const auh = await searchVehicles({ pickupBranchId: f.auh.id, pickupAt: p, returnAt: new Date(+p + DAY) });
    expect(auh.map((r) => r.vehicle.id)).toEqual([f.tesla.id]);
  });

  it("filters: category, transmission, fuel, seats, price range, sort", async () => {
    const f = await fleet();
    const p = futureAt(5);
    const base = { pickupBranchId: f.dxb.id, pickupAt: p, returnAt: new Date(+p + DAY) };
    const ids = async (o: object) => (await searchVehicles({ ...base, ...o })).map((r) => r.vehicle.id);
    expect(await ids({ categoryId: f.suv.id })).toEqual([f.patrol.id]);
    expect(await ids({ transmission: "MANUAL" })).toEqual([f.sunny.id]);
    expect(await ids({ fuelType: "DIESEL" })).toEqual([f.patrol.id]);
    expect(await ids({ minSeats: 6 })).toEqual([f.patrol.id]);
    expect(await ids({ maxDailyRateFils: 10_000 })).toEqual([f.sunny.id, f.corolla.id]);
    expect(await ids({ minDailyRateFils: 9_000, maxDailyRateFils: 10_000 })).toEqual([f.corolla.id]);
    expect(await ids({ sort: "price_desc" })).toEqual([f.patrol.id, f.corolla.id, f.sunny.id]);
    expect((await ids({ sort: "seats_desc" }))[0]).toBe(f.patrol.id);
    expect(await ids({ categoryId: f.suv.id, transmission: "MANUAL" })).toEqual([]);
  });

  it("excludes vehicles with overlapping bookings, live holds or maintenance; includes back-to-back and expired holds", async () => {
    const f = await fleet();
    const p = futureAt(10);
    const r = new Date(+p + 2 * DAY);
    await createReservation({ vehicleId: f.corolla.id, pickupAt: new Date(+p + DAY), returnAt: new Date(+p + 5 * DAY) });
    await createMaintenanceBlock({ vehicleId: f.patrol.id, startsAt: new Date(+p - DAY), endsAt: new Date(+p + HOUR) });
    // Sunny: booked right up to pick-up (back-to-back) and an expired hold overlapping.
    await createReservation({ vehicleId: f.sunny.id, pickupAt: new Date(+p - 2 * DAY), returnAt: p });
    await createReservation({
      vehicleId: f.sunny.id,
      pickupAt: p,
      returnAt: r,
      status: "PENDING",
      holdExpiresAt: new Date(Date.now() - 60_000),
    });
    const res = await searchVehicles({ pickupBranchId: f.dxb.id, pickupAt: p, returnAt: r });
    expect(res.map((x) => x.vehicle.id)).toEqual([f.sunny.id]);
  });

  it("one-way: estimated total includes the return branch's one-way fee", async () => {
    const f = await fleet();
    const p = futureAt(5);
    const [first] = await searchVehicles({
      pickupBranchId: f.dxb.id,
      returnBranchId: f.auh.id,
      pickupAt: p,
      returnAt: new Date(+p + DAY),
    });
    // 80.00 + one-way 300.00 = 380.00 + VAT 19.00
    expect(first.estimatedTotalFils).toBe(39_900);
  });

  it.each([
    ["return before pick-up", (p: Date) => ({ pickupAt: p, returnAt: new Date(+p - HOUR) }), "VALIDATION_ERROR"],
    ["return == pick-up", (p: Date) => ({ pickupAt: p, returnAt: p }), "VALIDATION_ERROR"],
    ["pick-up yesterday", () => ({ pickupAt: new Date(Date.now() - DAY), returnAt: futureAt(2) }), "VALIDATION_ERROR"],
    ["91 days", (p: Date) => ({ pickupAt: p, returnAt: new Date(+p + 91 * DAY) }), "VALIDATION_ERROR"],
  ])("date range rejected: %s", async (_n, patch, code) => {
    const f = await fleet();
    const r = await settle(searchVehicles({ pickupBranchId: f.dxb.id, ...patch(futureAt(5)) }));
    expect(!r.ok && r.code).toBe(code);
  });

  it("branch rules: inactive branch and outside opening hours -> BRANCH_CLOSED; unknown branch -> NOT_FOUND; garbage -> VALIDATION_ERROR", async () => {
    const closed = await createBranch({ isActive: false });
    const day = await createBranch({ opensAtMinute: 8 * 60, closesAtMinute: 22 * 60 }); // Dubai local
    const p = futureAt(5, 8); // 12:00 Dubai
    const win = { pickupAt: p, returnAt: new Date(+p + DAY) };
    expect(await settle(searchVehicles({ pickupBranchId: closed.id, ...win }))).toMatchObject({ code: "BRANCH_CLOSED" });
    expect((await settle(searchVehicles({ pickupBranchId: day.id, ...win }))).ok).toBe(true);
    const late = futureAt(5, 19); // 23:00 Dubai
    expect(
      await settle(searchVehicles({ pickupBranchId: day.id, pickupAt: late, returnAt: new Date(+p + DAY) })),
    ).toMatchObject({ code: "BRANCH_CLOSED" });
    expect(
      await settle(searchVehicles({ pickupBranchId: "00000000-0000-4000-8000-000000000000", ...win })),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(await settle(searchVehicles({ pickupBranchId: "not-a-uuid", ...win }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("availability calendar", () => {
  beforeEach(() => truncateAll());

  it("marks booked / partial / maintenance / available days in branch-local time, without customer data", async () => {
    const f = await fleet();
    // Dubai is UTC+4: local day D starts at D-1 20:00Z.
    const from = new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10);
    const d = (n: number) => new Date(Date.parse(`${from}T00:00:00+04:00`) + n * DAY);
    // Full local days 1-2 booked; day 4 afternoon partially; days 6-7 maintenance.
    await createReservation({ vehicleId: f.corolla.id, pickupAt: d(1), returnAt: d(3) });
    await createReservation({ vehicleId: f.corolla.id, pickupAt: new Date(+d(4) + 14 * HOUR), returnAt: new Date(+d(4) + 18 * HOUR) });
    await createMaintenanceBlock({ vehicleId: f.corolla.id, startsAt: d(6), endsAt: d(8) });
    const to = new Date(Date.parse(from) + 8 * DAY).toISOString().slice(0, 10);
    const cal = await getVehicleCalendar(f.corolla.id, { from, to });
    expect(cal.timeZone).toBe("Asia/Dubai");
    expect(cal.days.map((x) => x.status)).toEqual([
      "available",
      "booked",
      "booked",
      "available",
      "partial",
      "available",
      "maintenance",
      "maintenance",
      "available",
    ]);
    expect(JSON.stringify(cal)).not.toMatch(/driver|email|userId|phone/i);
  });

  it("isVehicleAvailable agrees with the half-open period rule", async () => {
    const f = await fleet();
    const p = futureAt(30);
    await createReservation({ vehicleId: f.corolla.id, pickupAt: p, returnAt: new Date(+p + DAY) });
    expect(await isVehicleAvailable(f.corolla.id, new Date(+p + DAY), new Date(+p + 2 * DAY))).toBe(true);
    expect(await isVehicleAvailable(f.corolla.id, new Date(+p - DAY), p)).toBe(true);
    expect(await isVehicleAvailable(f.corolla.id, new Date(+p + DAY - 1), new Date(+p + 2 * DAY))).toBe(false);
    expect(await isVehicleAvailable(f.retired.id, futureAt(60), futureAt(61))).toBe(false);
  });

  it("rejects bad ranges", async () => {
    const f = await fleet();
    expect(await settle(getVehicleCalendar(f.corolla.id, { from: "2027-02-01", to: "2027-01-01" }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await settle(getVehicleCalendar(f.corolla.id, { from: "2027-01-01", to: "2029-01-01" }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("quoteRental (DB-backed pricing)", () => {
  beforeEach(() => truncateAll());

  it("extras + one-way + VAT + deposit, all computed independently", async () => {
    const f = await fleet();
    const gps = await createExtra({ pricing: "PER_DAY", priceFils: 2_500 });
    const seat = await createExtra({ pricing: "PER_DAY", priceFils: 3_000, maxChargeFils: 8_000, maxQuantity: 3 });
    const ins = await createExtra({ pricing: "PER_RENTAL", priceFils: 5_000 });
    const p = futureAt(5);
    const q = await quoteRental({
      vehicleId: f.patrol.id,
      pickupBranchId: f.dxb.id,
      returnBranchId: f.auh.id,
      pickupAt: p,
      returnAt: new Date(+p + 3 * DAY + HOUR), // 4 days
      extras: [
        { extraId: gps.id, quantity: 1 },
        { extraId: seat.id, quantity: 2 },
        { extraId: ins.id, quantity: 1 },
      ],
    });
    const base = 4 * 30_000; // 1200.00
    const ex = 4 * 2_500 + 2 * Math.min(4 * 3_000, 8_000) + 5_000; // 310.00
    const oneWay = 30_000; // return branch's fee
    const sub = base + ex + oneWay;
    const vat = Math.round((sub * 5) / 100);
    expect(q).toMatchObject({
      rentalDays: 4,
      dailyRateFils: 30_000,
      baseFils: base,
      extrasFils: ex,
      oneWayFeeFils: oneWay,
      subtotalFils: sub,
      vatFils: vat,
      totalFils: sub + vat,
      depositFils: 200_000,
    });
  });

  it("uses the pick-up branch's VAT rate", async () => {
    const br = await createBranch({ vatRateBp: 0 });
    const v = await createVehicle({ branchId: br.id, dailyRateFils: 10_000 });
    const p = futureAt(5);
    const q = await quoteRental({ vehicleId: v.id, pickupBranchId: br.id, pickupAt: p, returnAt: new Date(+p + DAY) });
    expect([q.vatFils, q.totalFils]).toEqual([0, 10_000]);
  });

  it("long-rental and seasonal rules, NO_PRICE, bad extras", async () => {
    const f = await fleet();
    await createPricingRule({ vehicleId: f.corolla.id, dailyRateFils: 9_000, minDays: 7 });
    const p = futureAt(5);
    const q = (days: number) =>
      quoteRental({ vehicleId: f.corolla.id, pickupBranchId: f.dxb.id, pickupAt: p, returnAt: new Date(+p + days * DAY) });
    expect((await q(6)).dailyRateFils).toBe(10_000);
    expect((await q(7)).dailyRateFils).toBe(9_000);
    expect((await q(7)).baseFils).toBe(63_000);
    expect(
      await settle(quoteRental({ vehicleId: f.unpriced.id, pickupBranchId: f.dxb.id, pickupAt: p, returnAt: new Date(+p + DAY) })),
    ).toMatchObject({ code: "NO_PRICE" });
    const inactive = await createExtra({ isActive: false });
    const limited = await createExtra({ maxQuantity: 1 });
    const base = { vehicleId: f.corolla.id, pickupBranchId: f.dxb.id, pickupAt: p, returnAt: new Date(+p + DAY) };
    expect(await settle(quoteRental({ ...base, extras: [{ extraId: inactive.id, quantity: 1 }] }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await settle(quoteRental({ ...base, extras: [{ extraId: limited.id, quantity: 2 }] }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(
      await settle(
        quoteRental({
          ...base,
          extras: [
            { extraId: limited.id, quantity: 1 },
            { extraId: limited.id, quantity: 1 },
          ],
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

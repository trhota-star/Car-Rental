// QA-8 (service level): every admin service refuses customers (FORBIDDEN) and unknown actors.
// Plus the operational flow: paid booking -> check-out -> late check-in with fuel charge -> deposit capture,
// damage reports (photo validation) and private file access (licences / damage photos).
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deposits, reservations, vehicles } from "@/lib/db/schema";
import { FakePaymentProvider } from "@/lib/payments/fake-provider";
import { LocalFileStorage } from "@/lib/storage/local-storage";
import * as catalog from "@/server/admin/catalog";
import * as ops from "@/server/admin/operations";
import { cancelReservation } from "@/server/changes";
import { getFileForViewer, uploadLicence } from "@/server/files";
import { applyPaymentEvent, payReservation } from "@/server/payments";
import { createReservation } from "@/server/reservations";
import { truncateAll } from "../helpers/db";
import { DAY, HOUR, createAdmin, createBranch, createUser, createWorld, futureAt, type World } from "../helpers/factories";
import { bookingInput, driver, settle } from "../helpers/booking";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), "qa-uploads-")));

async function paidBooking(w: World, pickupAt: Date, days = 2) {
  const provider = new FakePaymentProvider({ webhookSecret: "s" });
  const r = await createReservation(bookingInput(w, pickupAt, new Date(+pickupAt + days * DAY)));
  await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
  for (const ev of provider.listEvents()) await applyPaymentEvent(ev, { provider });
  return { r, provider };
}

describe("admin permissions (services)", () => {
  beforeEach(() => truncateAll());

  it("customer and unknown actors get FORBIDDEN on every admin service; admin succeeds", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const ghost = randomUUID();
    const p = futureAt(5);
    const res = await createReservation(bookingInput(w, p, new Date(+p + DAY)));
    const calls: [string, (actor: string) => Promise<unknown>][] = [
      ["listAllBranches", (a) => catalog.listAllBranches(a)],
      ["createBranch", (a) => catalog.createBranch(a, { code: `X${Math.floor(Math.random() * 1e6)}`, name: "New", city: "Dubai", emirate: "Dubai", address: "Somewhere 1" })],
      ["updateBranch", (a) => catalog.updateBranch(a, { id: w.branch.id, oneWayFeeFils: 1 })],
      ["listFleet", (a) => catalog.listFleet(a, {})],
      ["updateVehicle", (a) => catalog.updateVehicle(a, { id: w.vehicle.id, color: "Red" })],
      ["listPricingRules", (a) => catalog.listPricingRules(a)],
      ["createPricingRule", (a) => catalog.createPricingRule(a, { name: "Cheap", vehicleId: w.vehicle.id, dailyRateFils: 1 })],
      ["listReservations", (a) => ops.listReservations(a, {})],
      ["getReservationByIdForAdmin", (a) => ops.getReservationByIdForAdmin(a, res.reservationId)],
      ["checkOut", (a) => ops.checkOut(a, { reservationId: res.reservationId, mileageKm: 10, fuelPercent: 100 })],
      ["checkIn", (a) => ops.checkIn(a, { reservationId: res.reservationId, mileageKm: 10, fuelPercent: 100 })],
      ["createDamageReport", (a) => ops.createDamageReport(a, { vehicleId: w.vehicle.id, stage: "OTHER", severity: "MINOR", description: "Scratch" }, { storage })],
      ["listDamageReports", (a) => ops.listDamageReports(a, {})],
      ["createMaintenanceBlock", (a) => ops.createMaintenanceBlock(a, { vehicleId: w.vehicle.id, startsAt: futureAt(40), endsAt: futureAt(41), reason: "Service" })],
      ["listAuditLogs", (a) => ops.listAuditLogs(a, {})],
    ];
    for (const [name, call] of calls) {
      expect(await settle(call(w.customer.id)), `${name} as customer`).toMatchObject({ code: "FORBIDDEN" });
      expect(await settle(call(ghost)), `${name} as unknown user`).toMatchObject({ code: "FORBIDDEN" });
    }
    // Nothing changed by the refused calls.
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id));
    expect(v.color).toBeNull();
    // Admin can do the read/create ones.
    for (const name of ["listAllBranches", "createBranch", "updateVehicle", "listFleet", "createPricingRule", "listReservations", "createMaintenanceBlock", "listAuditLogs"]) {
      const r = await settle(calls.find(([n]) => n === name)![1](admin.id));
      expect(r.ok, `${name} as admin: ${!r.ok && r.code}`).toBe(true);
    }
  });

  it("a customer cannot cancel someone else's reservation; an admin can", async () => {
    const w = await createWorld();
    const p = futureAt(10);
    const r = await createReservation(bookingInput(w, p, new Date(+p + DAY)));
    const other = await createUser();
    expect(await settle(cancelReservation({ reservationId: r.reservationId, userId: other.id }))).toMatchObject({ code: "NOT_FOUND" });
    const admin = await createAdmin();
    expect((await settle(cancelReservation({ reservationId: r.reservationId, userId: admin.id }))).ok).toBe(true);
  });
});

describe("check-out / check-in", () => {
  beforeEach(() => truncateAll());

  it("full rental: check-out records mileage/fuel; late return with less fuel is charged from the deposit, rest released", async () => {
    const w = await createWorld({ dailyRateFils: 15_000, depositFils: 100_000 });
    const admin = await createAdmin();
    const dest = await createBranch({ name: "Return here" });
    const p = futureAt(3);
    const { r, provider } = await paidBooking(w, p, 2);
    expect((await db.select().from(reservations).where(eq(reservations.id, r.reservationId)))[0].status).toBe("CONFIRMED");

    // Mileage below the recorded odometer is refused.
    await db.update(vehicles).set({ mileageKm: 5_000 }).where(eq(vehicles.id, w.vehicle.id));
    expect(await settle(ops.checkOut(admin.id, { reservationId: r.reservationId, mileageKm: 4_999, fuelPercent: 100 }, { now: p }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await ops.checkOut(admin.id, { reservationId: r.reservationId, mileageKm: 5_000, fuelPercent: 100 }, { now: p });
    let [v] = await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id));
    expect(v.status).toBe("ON_RENT");
    expect(await settle(ops.checkOut(admin.id, { reservationId: r.reservationId, mileageKm: 5_000, fuelPercent: 100 }))).toMatchObject({
      code: "INVALID_STATE",
    });

    const scheduled = new Date(+p + 2 * DAY);
    const result = await ops.checkIn(
      admin.id,
      { reservationId: r.reservationId, mileageKm: 5_600, fuelPercent: 90, returnedAt: new Date(+scheduled + 25 * HOUR), returnBranchId: dest.id },
      { provider },
    );
    // Late 25h: 150.00 + ceil(150/6)=25.00 -> 175.00 + 8.75 VAT = 183.75
    // Fuel 10% × AED 5 = 50.00 + 2.50 VAT = 52.50. Total 236.25 captured from the 1000.00 deposit.
    expect(result).toMatchObject({ lateFeeFils: 18_375, fuelChargeFils: 5_250, damageChargeFils: 0, totalChargesFils: 23_625 });
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, r.reservationId));
    expect(dep).toMatchObject({ status: "CAPTURED", capturedFils: 23_625 });
    const [after] = await db.select().from(reservations).where(eq(reservations.id, r.reservationId));
    expect(after).toMatchObject({ status: "RETURNED", lateFeeFils: 23_625 });
    [v] = await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id));
    expect(v).toMatchObject({ status: "AVAILABLE", mileageKm: 5_600, branchId: dest.id });
    expect(await settle(ops.checkIn(admin.id, { reservationId: r.reservationId, mileageKm: 5_600, fuelPercent: 90 }))).toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("on-time return with full tank: nothing captured, deposit released", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const p = futureAt(3);
    const { r, provider } = await paidBooking(w, p, 1);
    await ops.checkOut(admin.id, { reservationId: r.reservationId, mileageKm: 10, fuelPercent: 80 }, { now: p });
    const res = await ops.checkIn(
      admin.id,
      { reservationId: r.reservationId, mileageKm: 100, fuelPercent: 85, returnedAt: new Date(+p + DAY + 59 * 60_000) }, // inside grace
      { provider },
    );
    expect(res.totalChargesFils).toBe(0);
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, r.reservationId));
    expect(dep.status).toBe("RELEASED");
  });

  it("cannot check out an unpaid (PENDING) booking", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const p = futureAt(3);
    const r = await createReservation(bookingInput(w, p, new Date(+p + DAY)));
    expect(await settle(ops.checkOut(admin.id, { reservationId: r.reservationId, mileageKm: 0, fuelPercent: 100 }))).toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("maintenance block over an active booking is refused; free period accepted", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const p = futureAt(8);
    await paidBooking(w, p, 2);
    expect(
      await settle(ops.createMaintenanceBlock(admin.id, { vehicleId: w.vehicle.id, startsAt: new Date(+p + DAY), endsAt: new Date(+p + 3 * DAY), reason: "Tyres" })),
    ).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    expect(
      (await settle(ops.createMaintenanceBlock(admin.id, { vehicleId: w.vehicle.id, startsAt: new Date(+p + 2 * DAY), endsAt: new Date(+p + 3 * DAY), reason: "Tyres" }))).ok,
    ).toBe(true);
  });
});

describe("damage reports and private files", () => {
  beforeEach(() => truncateAll());

  it("damage photos: type/magic-byte checks; visible to admin and the booking's customer only", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const stranger = await createUser();
    const p = futureAt(3);
    const { r } = await paidBooking(w, p, 1);
    const bad = await settle(
      ops.createDamageReport(admin.id, {
        vehicleId: w.vehicle.id,
        reservationId: r.reservationId,
        stage: "RETURN",
        severity: "MINOR",
        description: "Scratch on bumper",
        photos: [{ data: new TextEncoder().encode("<script>alert(1)</script>"), contentType: "image/png" }],
      }, { storage }),
    );
    expect(bad).toMatchObject({ code: "VALIDATION_ERROR" });
    const svg = await settle(
      ops.createDamageReport(admin.id, {
        vehicleId: w.vehicle.id, stage: "RETURN", severity: "MINOR", description: "Scratch",
        photos: [{ data: new TextEncoder().encode("<svg/>"), contentType: "image/svg+xml" }],
      }, { storage }),
    );
    expect(svg).toMatchObject({ code: "VALIDATION_ERROR" });
    const report = (await ops.createDamageReport(admin.id, {
      vehicleId: w.vehicle.id,
      reservationId: r.reservationId,
      stage: "RETURN",
      severity: "MODERATE",
      description: "Dent on door",
      photos: [{ data: PNG, contentType: "image/png" }],
    }, { storage })) as { imageKeys: string[] };
    const key = report.imageKeys[0];
    expect(key).toMatch(/^damage\//);
    expect(await getFileForViewer({ key, viewerId: admin.id }, { storage })).not.toBeNull();
    expect(await getFileForViewer({ key, viewerId: w.customer.id }, { storage })).not.toBeNull();
    expect(await getFileForViewer({ key, viewerId: stranger.id }, { storage })).toBeNull();
  });

  it("licence uploads: only the owner (when on their profile) and admins can read; type checked", async () => {
    const w = await createWorld();
    const admin = await createAdmin();
    const stranger = await createUser();
    expect(await settle(uploadLicence({ userId: w.customer.id, data: new TextEncoder().encode("MZ..."), contentType: "application/pdf" }, { storage }))).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const { key } = await uploadLicence({ userId: w.customer.id, data: PNG, contentType: "image/png" }, { storage });
    expect(key).toMatch(new RegExp(`^licences/${w.customer.id}/`));
    // Not yet on the profile: even the owner can't fetch an orphan upload.
    expect(await getFileForViewer({ key, viewerId: w.customer.id }, { storage })).toBeNull();
    const p = futureAt(4);
    await createReservation({ ...bookingInput(w, p, new Date(+p + DAY)), driver: driver({ licenceFileKey: key }) });
    expect(await getFileForViewer({ key, viewerId: w.customer.id }, { storage })).not.toBeNull();
    expect(await getFileForViewer({ key, viewerId: admin.id }, { storage })).not.toBeNull();
    expect(await getFileForViewer({ key, viewerId: stranger.id }, { storage })).toBeNull();
    // Stranger cannot attach the victim's licence to their own booking.
    const sw = { ...w, customer: stranger };
    expect(
      await settle(createReservation({ ...bookingInput(sw, futureAt(20), futureAt(21)), driver: driver({ licenceFileKey: key }) })),
    ).toMatchObject({ code: "FORBIDDEN" });
    // Traversal-ish keys are simply not found.
    expect(await getFileForViewer({ key: `licences/${w.customer.id}/../x.png`, viewerId: admin.id }, { storage })).toBeNull();
  });
});

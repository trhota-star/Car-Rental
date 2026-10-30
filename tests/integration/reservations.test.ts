// QA-4 (service level) + reservation transaction rules: races, idempotency, back-to-back, maintenance,
// expired holds, server-side pricing snapshot, validation.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { driverProfiles, reservations } from "@/lib/db/schema";
import { createReservation } from "@/server/reservations";
import { truncateAll } from "../helpers/db";
import { DAY, HOUR, createMaintenanceBlock, createUser, createVehicle, createWorld, futureAt } from "../helpers/factories";
import { bookingInput, driver, settle } from "../helpers/booking";

const countRes = async (vehicleId: string) =>
  (await db.select().from(reservations).where(eq(reservations.vehicleId, vehicleId))).length;

describe("createReservation", () => {
  beforeEach(() => truncateAll());

  it("creates a PENDING hold with a server-computed price snapshot", async () => {
    const w = await createWorld({ dailyRateFils: 20_000, depositFils: 150_000 });
    const p = futureAt(5);
    const r = await createReservation(bookingInput(w, p, new Date(+p + 2 * DAY + HOUR)));
    expect(r.status).toBe("PENDING");
    expect(r.replayed).toBe(false);
    expect(r.reference).toMatch(/^DE-[2-9A-HJ-NP-Z]{8}$/);
    // 3 days × 200.00 = 600.00; VAT 30.00; total 630.00; deposit 1500.00
    expect(r.totalFils).toBe(63_000);
    expect(r.depositFils).toBe(150_000);
    const holdMin = (r.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(holdMin).toBeGreaterThan(13);
    expect(holdMin).toBeLessThanOrEqual(15.1);
  });

  it("race: two concurrent requests for overlapping dates -> exactly one wins, other VEHICLE_UNAVAILABLE (25 iterations)", async () => {
    const w = await createWorld();
    const other = await createUser();
    for (let i = 0; i < 25; i++) {
      const s = futureAt(3 + i * 3);
      const results = await Promise.all([
        settle(createReservation(bookingInput(w, s, new Date(+s + 2 * DAY)))),
        settle(createReservation(bookingInput(w, new Date(+s + DAY), new Date(+s + 2 * DAY), { userId: other.id }))),
      ]);
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      expect(ok, `iteration ${i}`).toHaveLength(1);
      expect(failed.map((f) => !f.ok && f.code)).toEqual(["VEHICLE_UNAVAILABLE"]);
    }
    expect(await countRes(w.vehicle.id)).toBe(25);
  });

  it("race: five concurrent customers, same dates -> exactly one reservation", async () => {
    const w = await createWorld();
    const s = futureAt(7);
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => createUser()));
    const results = await Promise.all(
      users.map((u) => settle(createReservation(bookingInput(w, s, new Date(+s + 3 * DAY), { userId: u.id })))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "VEHICLE_UNAVAILABLE")).toHaveLength(4);
    expect(await countRes(w.vehicle.id)).toBe(1);
  });

  it("back-to-back rentals (return == next pick-up) both succeed, also concurrently", async () => {
    const w = await createWorld();
    const t = futureAt(10);
    const [a, b] = await Promise.all([
      settle(createReservation(bookingInput(w, new Date(+t - 2 * DAY), t))),
      settle(createReservation(bookingInput(w, t, new Date(+t + 2 * DAY)))),
    ]);
    expect(a.ok && b.ok).toBe(true);
  });

  it("maintenance block overlap -> VEHICLE_UNAVAILABLE; adjacent -> ok", async () => {
    const w = await createWorld();
    const s = futureAt(12);
    await createMaintenanceBlock({ vehicleId: w.vehicle.id, startsAt: s, endsAt: new Date(+s + DAY) });
    const overlap = await settle(createReservation(bookingInput(w, new Date(+s - HOUR), new Date(+s + HOUR))));
    expect(!overlap.ok && overlap.code).toBe("VEHICLE_UNAVAILABLE");
    const after = await settle(createReservation(bookingInput(w, new Date(+s + DAY), new Date(+s + 2 * DAY))));
    expect(after.ok).toBe(true);
  });

  it("same idempotency key: sequential and concurrent retries return the same reservation, no duplicates", async () => {
    const w = await createWorld();
    const s = futureAt(9);
    const input = bookingInput(w, s, new Date(+s + DAY));
    const results = await Promise.all([1, 2, 3, 4].map(() => createReservation(input)));
    expect(new Set(results.map((r) => r.reservationId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const again = await createReservation(input);
    expect(again).toMatchObject({ reservationId: results[0].reservationId, replayed: true });
    expect(await countRes(w.vehicle.id)).toBe(1);
  });

  it("another user cannot reuse someone else's idempotency key to read their reservation", async () => {
    const w = await createWorld();
    const s = futureAt(9);
    const input = bookingInput(w, s, new Date(+s + DAY));
    await createReservation(input);
    const thief = await createUser();
    const r = await settle(createReservation({ ...input, userId: thief.id }));
    expect(!r.ok && r.code).toBe("CONFLICT");
  });

  it("an expired hold no longer blocks the dates (even before the cleanup job runs)", async () => {
    const w = await createWorld();
    const s = futureAt(20);
    const first = await createReservation(bookingInput(w, s, new Date(+s + DAY)));
    const later = new Date(Date.now() + 16 * 60_000); // after the 15-minute hold
    const second = await settle(
      createReservation(bookingInput(w, s, new Date(+s + DAY), { userId: (await createUser()).id }), { now: later }),
    );
    expect(second.ok).toBe(true);
    const [old] = await db.select().from(reservations).where(eq(reservations.id, first.reservationId));
    expect(old.status).toBe("EXPIRED");
  });

  it("a live hold blocks other customers", async () => {
    const w = await createWorld();
    const s = futureAt(20);
    await createReservation(bookingInput(w, s, new Date(+s + DAY)));
    const r = await settle(
      createReservation(bookingInput(w, s, new Date(+s + DAY), { userId: (await createUser()).id }), {
        now: new Date(Date.now() + 10 * 60_000),
      }),
    );
    expect(!r.ok && r.code).toBe("VEHICLE_UNAVAILABLE");
  });

  it.each([
    ["return before pick-up", (s: Date) => ({ pickupAt: s, returnAt: new Date(+s - HOUR) }), "VALIDATION_ERROR"],
    ["pick-up in the past", () => ({ pickupAt: new Date(Date.now() - DAY), returnAt: futureAt(2) }), "VALIDATION_ERROR"],
    ["longer than 90 days", (s: Date) => ({ pickupAt: s, returnAt: new Date(+s + 91 * DAY) }), "VALIDATION_ERROR"],
    ["driver under 21", () => ({ driver: driver({ dateOfBirth: "2010-01-01" }) }), "VALIDATION_ERROR"],
    ["licence expires before return", () => ({ driver: driver({ licenceExpiry: "2026-01-01" }) }), "VALIDATION_ERROR"],
    ["malformed licence key", () => ({ driver: driver({ licenceFileKey: "licences/someone-else/x.jpg" }) }), "VALIDATION_ERROR"],
    [
      "licence file in another user's folder",
      () => ({ driver: driver({ licenceFileKey: `licences/${randomUUID()}/${randomUUID()}.jpg` }) }),
      "FORBIDDEN",
    ],
  ])("rejects: %s", async (_name, patch, code) => {
    const w = await createWorld();
    const s = futureAt(6);
    const r = await settle(createReservation({ ...bookingInput(w, s, new Date(+s + DAY)), ...patch(s) }));
    expect(!r.ok && r.code).toBe(code);
    expect(await countRes(w.vehicle.id)).toBe(0);
  });

  it("rejects a licence key that escapes the user's folder with ../", async () => {
    const w = await createWorld();
    const s = futureAt(6);
    const key = `licences/${w.customer.id}/../${(await createUser()).id}/licence.jpg`;
    const r = await settle(createReservation({ ...bookingInput(w, s, new Date(+s + DAY)), driver: driver({ licenceFileKey: key }) }));
    expect(r.ok, "a ../ licence key must not be accepted").toBe(false);
    expect(!r.ok && ["VALIDATION_ERROR", "FORBIDDEN"]).toContain(!r.ok && r.code);
    expect(await countRes(w.vehicle.id)).toBe(0);
    const profiles = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, w.customer.id));
    expect(profiles).toHaveLength(0);
  });

  it("rejects a vehicle from a different branch, retired vehicles, and closed hours", async () => {
    const w = await createWorld();
    const s = futureAt(6);
    const elsewhere = await createVehicle({ dailyRateFils: 10_000 });
    const r1 = await settle(createReservation(bookingInput(w, s, new Date(+s + DAY), { vehicleId: elsewhere.id })));
    expect(!r1.ok && r1.code).toBe("VEHICLE_UNAVAILABLE");
    const retired = await createVehicle({ branchId: w.branch.id, status: "RETIRED", dailyRateFils: 10_000 });
    const r2 = await settle(createReservation(bookingInput(w, s, new Date(+s + DAY), { vehicleId: retired.id })));
    expect(!r2.ok && r2.code).toBe("VEHICLE_UNAVAILABLE");
    // Branch open 08:00-20:00 Dubai; 02:00 Dubai = 22:00Z previous day.
    const { branch } = await createWorld();
    const { createBranch } = await import("../helpers/factories");
    const day = await createBranch({ opensAtMinute: 8 * 60, closesAtMinute: 20 * 60 });
    const v = await createVehicle({ branchId: day.id, dailyRateFils: 10_000 });
    const night = futureAt(6, 22);
    const r3 = await settle(
      createReservation(bookingInput({ ...w, branch: day, vehicle: v }, night, new Date(+night + DAY + 12 * HOUR))),
    );
    expect(!r3.ok && r3.code).toBe("BRANCH_CLOSED");
    expect(branch).toBeTruthy();
  });
});

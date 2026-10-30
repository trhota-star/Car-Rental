// DB-level guarantees (independent of services): exclusion constraints + maintenance trigger,
// raced from two separate connections with real transactions.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectTestClient, truncateAll } from "../helpers/db";
import {
  DAY,
  HOUR,
  createMaintenanceBlock,
  createReservation,
  createWorld,
  futureAt,
  type World,
} from "../helpers/factories";

async function insertRes(c: Client, w: World, pickupAt: Date, returnAt: Date, status = "PENDING") {
  await c.query(
    `INSERT INTO reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at,
       status, hold_expires_at, idempotency_key, driver_name, driver_email, driver_phone,
       rental_days, daily_rate_fils, base_fils, subtotal_fils, vat_rate_bp, vat_fils, total_fils)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7, now() + interval '15 minutes', $8,'D','d@x.test','+971',1,100,100,100,500,5,105)`,
    [`R-${randomUUID().slice(0, 8)}`, w.customer.id, w.vehicle.id, w.branch.id, pickupAt, returnAt, status, randomUUID()],
  );
}

async function inTx(c: Client, fn: () => Promise<unknown>): Promise<string> {
  await c.query("BEGIN");
  try {
    await fn();
    await c.query("COMMIT");
    return "ok";
  } catch (e) {
    await c.query("ROLLBACK");
    return (e as { code?: string }).code ?? "error";
  }
}

describe("database constraints", () => {
  let c1: Client;
  let c2: Client;
  beforeAll(async () => {
    c1 = await connectTestClient();
    c2 = await connectTestClient();
  });
  afterAll(async () => {
    await c1.end();
    await c2.end();
  });
  beforeEach(() => truncateAll());

  it("two sessions racing for overlapping dates: exactly one wins (25 iterations)", async () => {
    const w = await createWorld();
    for (let i = 0; i < 25; i++) {
      const s = futureAt(10 + i * 10);
      const results = await Promise.all([
        inTx(c1, () => insertRes(c1, w, s, new Date(+s + 3 * DAY))),
        inTx(c2, () => insertRes(c2, w, new Date(+s + DAY), new Date(+s + 4 * DAY))),
      ]);
      expect(results.filter((r) => r === "ok"), `iteration ${i}: ${results}`).toHaveLength(1);
      expect(results.filter((r) => r !== "ok")).toEqual(["23P01"]);
    }
    const { rows } = await c1.query("SELECT count(*)::int AS n FROM reservations");
    expect(rows[0].n).toBe(25);
  });

  it("back-to-back (end == next start) both succeed, also when raced", async () => {
    const w = await createWorld();
    const t = futureAt(20);
    const results = await Promise.all([
      inTx(c1, () => insertRes(c1, w, new Date(+t - 2 * DAY), t)),
      inTx(c2, () => insertRes(c2, w, t, new Date(+t + 2 * DAY))),
    ]);
    expect(results).toEqual(["ok", "ok"]);
  });

  it("cancelled / expired reservations do not block the dates", async () => {
    const w = await createWorld();
    const p = futureAt(15);
    const r = new Date(+p + 2 * DAY);
    await createReservation({ vehicleId: w.vehicle.id, pickupAt: p, returnAt: r, status: "CANCELLED" });
    await createReservation({ vehicleId: w.vehicle.id, pickupAt: p, returnAt: r, status: "EXPIRED" });
    await expect(createReservation({ vehicleId: w.vehicle.id, pickupAt: p, returnAt: r })).resolves.toBeTruthy();
  });

  it("reservation overlapping a maintenance block is rejected (23P01); adjacent is fine", async () => {
    const w = await createWorld();
    const s = futureAt(30);
    await createMaintenanceBlock({ vehicleId: w.vehicle.id, startsAt: s, endsAt: new Date(+s + DAY) });
    await expect(insertRes(c1, w, new Date(+s + 12 * HOUR), new Date(+s + 3 * DAY))).rejects.toMatchObject({
      code: "23P01",
    });
    await expect(insertRes(c1, w, new Date(+s + DAY), new Date(+s + 3 * DAY))).resolves.toBeUndefined();
    await expect(insertRes(c1, w, new Date(+s - 2 * DAY), s)).resolves.toBeUndefined();
  });

  it("reservation vs maintenance block raced from two sessions: exactly one wins (25 iterations)", async () => {
    const w = await createWorld();
    for (let i = 0; i < 25; i++) {
      const s = futureAt(10 + i * 10);
      const e = new Date(+s + 2 * DAY);
      const results = await Promise.all([
        inTx(c1, () => insertRes(c1, w, s, e)),
        inTx(c2, () =>
          c2.query(
            "INSERT INTO maintenance_blocks (vehicle_id, starts_at, ends_at, reason, created_by_id) VALUES ($1,$2,$3,'svc',$4)",
            [w.vehicle.id, new Date(+s + DAY), new Date(+e + DAY), w.customer.id],
          ),
        ),
      ]);
      expect(results.filter((r) => r === "ok"), `iteration ${i}: ${results}`).toHaveLength(1);
      expect(results.filter((r) => r !== "ok")).toEqual(["23P01"]);
    }
  });

  it("rejects inconsistent money snapshots (total != subtotal + VAT)", async () => {
    const w = await createWorld();
    await expect(createReservation({ vehicleId: w.vehicle.id, totalFils: 1 })).rejects.toThrow();
  });
});

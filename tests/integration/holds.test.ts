// QA-7: expired holds are released automatically; repeated and concurrent runs are idempotent.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, reservations } from "@/lib/db/schema";
import { releaseExpiredHolds } from "@/server/holds";
import { truncateAll } from "../helpers/db";
import { DAY, createReservation, createWorld, futureAt } from "../helpers/factories";

const MIN = 60_000;

async function seedHolds() {
  const w = await createWorld();
  const now = Date.now();
  const mk = (i: number, status: "PENDING" | "CONFIRMED", holdExpiresAt: Date | null) => {
    const p = futureAt(10 + i * 3);
    return createReservation({ vehicleId: w.vehicle.id, pickupAt: p, returnAt: new Date(+p + DAY), status, holdExpiresAt });
  };
  const expired = await Promise.all([0, 1, 2, 3, 4].map((i) => mk(i, "PENDING", new Date(now - (i + 1) * MIN))));
  const exactlyNow = await mk(5, "PENDING", new Date(now)); // hold_expires_at <= now counts as expired
  const live = await mk(6, "PENDING", new Date(now + 10 * MIN));
  const confirmed = await mk(7, "CONFIRMED", null);
  return { w, now: new Date(now), expired: [...expired, exactlyNow], live, confirmed };
}

const statuses = async (ids: string[]) =>
  Object.fromEntries(
    (await db.select().from(reservations).where(inArray(reservations.id, ids))).map((r) => [r.id, r.status]),
  );

describe("releaseExpiredHolds", () => {
  beforeEach(() => truncateAll());

  it("expires only PENDING holds past their expiry; live holds and confirmed bookings untouched", async () => {
    const s = await seedHolds();
    const res = await releaseExpiredHolds(s.now);
    expect(res.released).toBe(6);
    const st = await statuses([...s.expired.map((r) => r.id), s.live.id, s.confirmed.id]);
    for (const r of s.expired) expect(st[r.id]).toBe("EXPIRED");
    expect(st[s.live.id]).toBe("PENDING");
    expect(st[s.confirmed.id]).toBe("CONFIRMED");
  });

  it("repeated runs are idempotent (second and third run release nothing, one audit entry each)", async () => {
    const s = await seedHolds();
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await releaseExpiredHolds(s.now));
    expect(runs.map((r) => r.released)).toEqual([6, 0, 0]);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "reservation.expired"), inArray(auditLogs.entityId, s.expired.map((r) => r.id))));
    expect(audits).toHaveLength(6);
  });

  it("concurrent runs release each hold exactly once", async () => {
    const s = await seedHolds();
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => releaseExpiredHolds(s.now)));
    expect(runs.reduce((n, r) => n + r.released, 0)).toBe(6);
  });

  it("a live hold expires once its time passes", async () => {
    const s = await seedHolds();
    await releaseExpiredHolds(s.now);
    const later = new Date(+s.now + 11 * MIN);
    expect((await releaseExpiredHolds(later)).released).toBe(1);
    expect((await statuses([s.live.id]))[s.live.id]).toBe("EXPIRED");
  });

  it("released dates can be booked again", async () => {
    const s = await seedHolds();
    await releaseExpiredHolds(s.now);
    const r = s.expired[0];
    await expect(
      createReservation({ vehicleId: s.w.vehicle.id, pickupAt: r.pickupAt, returnAt: r.returnAt, status: "CONFIRMED" }),
    ).resolves.toBeTruthy();
  });

  it("`pnpm jobs:release-holds` (real CLI) runs against the test DB and is idempotent", async () => {
    await seedHolds();
    const run = promisify(execFile);
    const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL! };
    const opts = { env, shell: true, timeout: 120_000 };
    const first = await run("pnpm", ["-s", "jobs:release-holds"], opts);
    const second = await run("pnpm", ["-s", "jobs:release-holds"], opts);
    const parse = (out: string) => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith("[release-holds]"))!;
      return JSON.parse(line.slice(line.indexOf("{")));
    };
    expect(parse(first.stdout).released).toBe(6);
    expect(parse(second.stdout).released).toBe(0);
  }, 240_000);
});

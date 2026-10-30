import { describe, expect, it } from "vitest";
import { releaseExpiredHolds, type HoldStore } from "@/lib/jobs/release-expired-holds";

describe("releaseExpiredHolds", () => {
  it("releases only holds that expired by now", async () => {
    const holds = [
      { id: 1, status: "active", expiresAt: new Date("2026-01-01T10:00:00Z") },
      { id: 2, status: "active", expiresAt: new Date("2026-01-01T12:00:00Z") },
      { id: 3, status: "released", expiresAt: new Date("2026-01-01T09:00:00Z") },
    ];
    const store: HoldStore = {
      async releaseExpiredHolds(now) {
        const expired = holds.filter((h) => h.status === "active" && h.expiresAt <= now);
        expired.forEach((h) => (h.status = "released"));
        return expired.length;
      },
    };
    const now = new Date("2026-01-01T11:00:00Z");
    expect(await releaseExpiredHolds(store, now)).toEqual({ released: 1, ranAt: now.toISOString() });
    expect(holds.map((h) => h.status)).toEqual(["released", "active", "released"]);
  });
});

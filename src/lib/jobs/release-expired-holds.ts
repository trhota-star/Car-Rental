import type { Pool } from "pg";

// Minimal, storage-agnostic version of the hold release (kept for unit tests and as a
// fallback). The production job is `releaseExpiredHolds` in src/server/holds.ts, which also
// writes audit logs and settles refunds / deposit holds.

export interface HoldStore {
  /** Mark every active hold that expired before `now` as released. Returns how many. */
  releaseExpiredHolds(now: Date): Promise<number>;
}

export interface ReleaseHoldsResult {
  released: number;
  ranAt: string;
}

export async function releaseExpiredHolds(store: HoldStore, now: Date = new Date()): Promise<ReleaseHoldsResult> {
  const released = await store.releaseExpiredHolds(now);
  return { released, ranAt: now.toISOString() };
}

/** A hold is a PENDING reservation; releasing it sets status EXPIRED. */
export class PgHoldStore implements HoldStore {
  constructor(private readonly pool: Pool) {}

  async releaseExpiredHolds(now: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE reservations
          SET status = 'EXPIRED', updated_at = $1
        WHERE status = 'PENDING' AND hold_expires_at <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }
}

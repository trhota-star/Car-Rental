import type { Pool } from "pg";

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

/**
 * PostgreSQL-backed store. Expects a `booking_holds` table with
 * `status`, `expires_at` and `released_at` columns; until that table
 * exists the job is a no-op.
 */
export class PgHoldStore implements HoldStore {
  constructor(private readonly pool: Pool) {}

  async releaseExpiredHolds(now: Date): Promise<number> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      "SELECT to_regclass('public.booking_holds') IS NOT NULL AS exists",
    );
    if (!rows[0]?.exists) return 0;
    const result = await this.pool.query(
      `UPDATE booking_holds
          SET status = 'released', released_at = $1
        WHERE status = 'active' AND expires_at <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }
}

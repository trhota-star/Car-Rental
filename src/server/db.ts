import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ServiceError } from "./errors";

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool-backed db or an open transaction. */
export type Executor = Db | Tx;

export { db };

/** PostgreSQL error fields, found on the error or its `cause` (Drizzle wraps driver errors). */
export function pgError(err: unknown): { code?: string; constraint?: string } | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const o = e as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) return { code: o.code, constraint: o.constraint };
    e = o.cause;
  }
  return undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";

/** Re-throw overlap violations (exclusion constraints + overlap triggers) as VEHICLE_UNAVAILABLE. */
export function mapOverlapError(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === PG_EXCLUSION_VIOLATION) {
    throw new ServiceError("VEHICLE_UNAVAILABLE", "The vehicle is not available for these dates", {
      constraint: pg.constraint,
    });
  }
  throw err;
}

export async function assertAdmin(ex: Executor, userId: string): Promise<void> {
  const [u] = await ex.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!u || u.role !== "ADMIN") throw new ServiceError("FORBIDDEN", "Admin access required");
}

export async function isAdmin(ex: Executor, userId: string): Promise<boolean> {
  const [u] = await ex.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return u?.role === "ADMIN";
}

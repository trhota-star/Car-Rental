// Test-database helpers: reset to an empty schema, run every migration from scratch, truncate between tests.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./env";

/** Advisory-lock key serialising whole test runs that reset the same database (other agents, parallel runs). */
const RUN_LOCK_KEY = 0x0de_7e57;

/**
 * Hold a session-level advisory lock until the returned release() is called. A second run against the same
 * database waits here instead of dropping the schema under the first run.
 */
export async function acquireRunLock(): Promise<() => Promise<void>> {
  const client = await connectTestClient();
  await client.query("SET application_name = 'qa-run-lock'");
  const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [RUN_LOCK_KEY]);
  if (!rows[0].ok) {
    console.log("[qa] another test run is using this database; waiting for it to finish...");
    await client.query("SELECT pg_advisory_lock($1)", [RUN_LOCK_KEY]);
  }
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1)", [RUN_LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  };
}

/** Create the database named in `url` if it does not exist (connects through TEST_DATABASE_URL). */
export async function ensureDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad database name ${name}`);
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rows.length) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");

export function hasMigrations(): boolean {
  return existsSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json")) &&
    readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith(".sql"));
}

/** A fresh, independent connection to the test DB (use for concurrency tests: one per "session"). */
export async function connectTestClient(): Promise<Client> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

export function createTestPool(max = 10): Pool {
  return new Pool({ connectionString: testDatabaseUrl(), max });
}

/**
 * Drop everything (public + drizzle migration bookkeeping), recreate an empty public schema with
 * btree_gist, then apply every migration in ./drizzle. This is the "migrations on a clean database" check.
 */
export async function resetTestDatabase(): Promise<{ migrations: number }> {
  const client = await connectTestClient();
  try {
    await client.query("SET client_min_messages TO WARNING");
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
    await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
    if (!hasMigrations()) return { migrations: 0 };
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations");
    return { migrations: Number(rows[0].n) };
  } finally {
    await client.end();
  }
}

/** Empty every table in public (keeps schema). Fast per-test isolation. */
export async function truncateAll(client?: Client): Promise<void> {
  const c = client ?? (await connectTestClient());
  try {
    const { rows } = await c.query<{ t: string }>(
      "SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    if (!client) await c.end();
  }
}

export async function listTables(): Promise<string[]> {
  const c = await connectTestClient();
  try {
    const { rows } = await c.query<{ t: string }>(
      "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    );
    return rows.map((r) => r.t);
  } finally {
    await c.end();
  }
}

// Test-database helpers: reset to an empty schema, run every migration from scratch, truncate between tests.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./env";

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

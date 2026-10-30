// Apply pending migrations on deploy (UNVERIFIED against a cloud database until cloud links exist).
//   pnpm db:migrate:deploy
// Uses DATABASE_URL_UNPOOLED (direct connection; poolers such as PgBouncer/Neon pooled endpoints
// break advisory locks and multi-statement migrations), falling back to DATABASE_URL locally.
// Wire as the build step on the host, e.g. Vercel "Build Command": `pnpm db:migrate:deploy && pnpm build`.
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");

const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  // One deploy at a time, even if several builds start together.
  await client.query("SELECT pg_advisory_lock(727274)");
  await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
  const started = Date.now();
  await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../drizzle") });
  const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations");
  console.log(JSON.stringify({ level: "info", msg: "db.migrated", applied: Number(rows[0].n), ms: Date.now() - started }));
} finally {
  await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
  await client.end();
}

// DEV ONLY: drop everything in DATABASE_URL, recreate the public schema and run every migration.
//   pnpm db:reset   (runs this, then pnpm db:seed)
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const dbName = new URL(url).pathname.slice(1);
if (process.env.NODE_ENV === "production" || !/(_dev|_test)$/.test(dbName)) {
  throw new Error(`Refusing to reset "${dbName}": only *_dev / *_test databases can be reset`);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("SET client_min_messages TO WARNING");
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
  await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../drizzle") });
  console.log(JSON.stringify({ level: "info", msg: "db.reset", database: dbName }));
} finally {
  await client.end();
}

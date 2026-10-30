// Confirms both local databases are reachable and have btree_gist.
//   pnpm db:check
import { Client } from "pg";

const targets = { driveeasy_dev: process.env.DATABASE_URL, driveeasy_test: process.env.TEST_DATABASE_URL };
let ok = true;

for (const [label, url] of Object.entries(targets)) {
  if (!url) {
    console.log(`✗ ${label}: URL not set in .env.local`);
    ok = false;
    continue;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<{ db: string; usr: string; version: string; gist: string | null }>(
      `SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS version,
              (SELECT extversion FROM pg_extension WHERE extname = 'btree_gist') AS gist`,
    );
    const r = rows[0];
    const gist = r.gist ? `btree_gist ${r.gist}` : "btree_gist MISSING";
    if (!r.gist) ok = false;
    console.log(`${r.gist ? "✓" : "✗"} ${r.db} as ${r.usr} (PostgreSQL ${r.version}, ${gist})`);
  } catch (err) {
    ok = false;
    console.log(`✗ ${label}: ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

process.exit(ok ? 0 : 1);

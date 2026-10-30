import { describe, expect, it } from "vitest";
import { hasMigrations, listTables, resetTestDatabase, connectTestClient } from "../helpers/db";

describe("migrations on a clean database", () => {
  it("applies every migration from an empty schema, twice in a row", async () => {
    const first = await resetTestDatabase();
    const tablesA = await listTables();
    const second = await resetTestDatabase();
    const tablesB = await listTables();
    expect(second.migrations).toBe(first.migrations);
    expect(tablesB).toEqual(tablesA);
    if (hasMigrations()) expect(first.migrations).toBeGreaterThan(0);
  });

  it("keeps btree_gist available after reset", async () => {
    const c = await connectTestClient();
    try {
      const { rows } = await c.query("SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'");
      expect(rows).toHaveLength(1);
    } finally {
      await c.end();
    }
  });

  it("is connected to the test database, never dev", async () => {
    const c = await connectTestClient();
    try {
      const { rows } = await c.query<{ db: string }>("SELECT current_database() AS db");
      expect(rows[0].db).toMatch(/_test$/);
      expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    } finally {
      await c.end();
    }
  });
});

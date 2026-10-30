import path from "node:path";
import { defineConfig } from "vitest/config";

// Two projects:
//  - unit:        pure logic, parallel, no database.
//  - integration: real PostgreSQL (TEST_DATABASE_URL only), clean schema + migrations once per run, serial files.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // src/server/* imports "server-only", which throws outside Next.js; use its no-op build in tests.
    alias: { "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js") },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-unit.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-integration.ts"],
          globalSetup: ["tests/helpers/global-setup-integration.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

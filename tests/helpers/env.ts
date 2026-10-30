// Loads .env.local and points every DB consumer at a TEST database (never dev).
//   Vitest integration -> TEST_DATABASE_URL (driveeasy_test)
//   Playwright e2e/api -> E2E database (driveeasy_e2e_test, created on demand), so a browser run and a
//                         Vitest run (or two agents) never reset each other's database.
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function guard(url: string): string {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  // Hard guard: never let tests touch the dev/prod database.
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to run tests against non-test database "${dbName}"`);
  return url;
}

/** The database this process's tests use (QA_DATABASE_URL overrides, e.g. for the e2e database). */
export function testDatabaseUrl(): string {
  const url = process.env.QA_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (.env.local)");
  return guard(url);
}

/** Same server and credentials as TEST_DATABASE_URL, database `driveeasy_e2e_test`. */
export function e2eDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set (.env.local)");
  const u = new URL(base);
  u.pathname = "/" + (process.env.E2E_DATABASE_NAME ?? "driveeasy_e2e_test");
  return guard(u.toString());
}

export function selectTestDatabase(): string {
  const url = testDatabaseUrl();
  process.env.DATABASE_URL = url;
  return url;
}

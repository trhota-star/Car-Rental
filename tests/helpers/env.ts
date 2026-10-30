// Loads .env.local and points every DB consumer at the TEST database.
// Imported first by the Vitest setup files and by the Playwright config.
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (.env.local)");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  // Hard guard: never let tests touch the dev/prod database.
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to run tests against non-test database "${dbName}"`);
  return url;
}

export function selectTestDatabase(): string {
  const url = testDatabaseUrl();
  process.env.DATABASE_URL = url;
  return url;
}

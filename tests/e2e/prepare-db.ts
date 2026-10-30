// Run by the Playwright webServer command BEFORE `next build`: fresh E2E database (driveeasy_e2e_test,
// separate from the Vitest database), all migrations, seed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { e2eDatabaseUrl } from "../helpers/env";

async function main() {
  const url = e2eDatabaseUrl();
  process.env.QA_DATABASE_URL = url;
  const { ensureDatabase, resetTestDatabase } = await import("../helpers/db");
  await ensureDatabase(url);
  const { migrations } = await resetTestDatabase();
  console.log(`[qa] e2e DB ${new URL(url).pathname.slice(1)} reset; ${migrations} migration(s)`);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (migrations > 0 && pkg.scripts?.["db:seed"]) {
    execSync("pnpm db:seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

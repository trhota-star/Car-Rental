// Run by the Playwright webServer command BEFORE `next build`: fresh test DB, all migrations, seed.
// (Playwright starts the web server before globalSetup, so the DB must be ready here.)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { selectTestDatabase } from "../helpers/env";
import { resetTestDatabase } from "../helpers/db";

async function main() {
  const url = selectTestDatabase();
  const { migrations } = await resetTestDatabase();
  console.log(`[qa] e2e test DB reset; ${migrations} migration(s)`);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (migrations > 0 && pkg.scripts?.["db:seed"]) {
    execSync("pnpm db:seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

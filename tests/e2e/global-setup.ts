// Fresh test DB + migrations + seed before the browser suite. Runs before the web server starts.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { selectTestDatabase } from "../helpers/env";
import { resetTestDatabase } from "../helpers/db";

export default async function globalSetup() {
  const url = selectTestDatabase();
  const { migrations } = await resetTestDatabase();
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (migrations > 0 && pkg.scripts?.["db:seed"] && existsSync("scripts")) {
    // Seed scripts may use --env-file=.env.local; real env vars still win for DATABASE_URL in tsx/node.
    execSync("pnpm db:seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  }
}

// Runs once per Vitest invocation that includes integration tests: take the run lock (so concurrent runs
// against driveeasy_test queue instead of wiping each other), then clean schema + all migrations.
import { selectTestDatabase } from "./env";
import { acquireRunLock, resetTestDatabase } from "./db";

export default async function setup() {
  selectTestDatabase();
  const release = await acquireRunLock();
  const { migrations } = await resetTestDatabase();
  console.log(`[qa] test DB reset; applied ${migrations} migration(s)`);
  return release; // teardown
}

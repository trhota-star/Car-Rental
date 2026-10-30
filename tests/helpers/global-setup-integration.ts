// Runs once per `vitest --project integration` invocation: clean test DB + all migrations.
import { selectTestDatabase } from "./env";
import { resetTestDatabase } from "./db";

export default async function setup() {
  selectTestDatabase();
  const { migrations } = await resetTestDatabase();
  console.log(`[qa] test DB reset; applied ${migrations} migration(s)`);
}

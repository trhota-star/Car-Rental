// Scheduled jobs. The same job functions run from:
//   SCHEDULER_DRIVER=local -> `pnpm jobs:release-holds` / `pnpm jobs:watch` on this machine
//   SCHEDULER_DRIVER=cron  -> a cloud scheduler calling GET /api/cron/<job>
import { pool } from "@/lib/db";
import { PgHoldStore, releaseExpiredHolds } from "./release-expired-holds";

export const jobs = {
  "release-holds": () => releaseExpiredHolds(new PgHoldStore(pool)),
} as const;

export type JobName = keyof typeof jobs;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(jobs, name);
}

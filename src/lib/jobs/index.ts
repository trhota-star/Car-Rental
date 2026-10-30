// Scheduled jobs. The same job functions run from:
//   SCHEDULER_DRIVER=local -> `pnpm jobs:release-holds` / `pnpm jobs:watch` on this machine
//   SCHEDULER_DRIVER=cron  -> a cloud scheduler calling GET /api/cron/<job> (Bearer CRON_SECRET)
import { releaseExpiredHolds } from "@/server/holds";

export const jobs = {
  /** Expire unpaid holds + settle refunds / deposit releases. Returns { released, settled, ranAt }. */
  "release-holds": () => releaseExpiredHolds(),
} as const;

export type JobName = keyof typeof jobs;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(jobs, name);
}

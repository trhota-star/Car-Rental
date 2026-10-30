// Run a scheduled job locally.
//   pnpm jobs:release-holds          run once
//   pnpm jobs:watch                  run every 5 minutes until Ctrl+C
import { pool } from "@/lib/db";
import { isJobName, jobs } from "@/lib/jobs";

const [name, flag, minutesArg] = process.argv.slice(2);
if (!name || !isJobName(name)) {
  console.error(`Usage: run-job <${Object.keys(jobs).join("|")}> [--watch <minutes>]`);
  process.exit(1);
}

async function runOnce() {
  try {
    console.log(`[${name}]`, JSON.stringify(await jobs[name as keyof typeof jobs]()));
  } catch (err) {
    console.error(`[${name}] failed:`, (err as Error).message);
    process.exitCode = 1;
  }
}

if (flag === "--watch") {
  const minutes = Number(minutesArg ?? 5);
  await runOnce();
  setInterval(runOnce, minutes * 60_000);
  console.log(`Running every ${minutes} min. Press Ctrl+C to stop.`);
} else {
  await runOnce();
  await pool.end();
}

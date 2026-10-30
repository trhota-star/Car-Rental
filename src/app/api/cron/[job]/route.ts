import { timingSafeEqual } from "node:crypto";
import { isJobName, jobs } from "@/lib/jobs";

// Entry point for a cloud scheduler. Locally, use `pnpm jobs:release-holds` instead.
export async function GET(request: Request, ctx: RouteContext<"/api/cron/[job]">) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  if (!isJobName(job)) return Response.json({ error: "unknown job" }, { status: 404 });
  return Response.json(await jobs[job]());
}

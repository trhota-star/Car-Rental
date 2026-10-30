import "server-only";
import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth-session";
import { log } from "@/lib/auth-log";
import { isServiceError } from "@/server/errors";
import { toActionError } from "../../_lib/service-errors";
import type { AdminState } from "./state";

/**
 * Run an admin mutation: re-checks the session and ADMIN role (the db service
 * checks again), maps service errors to form state and revalidates paths.
 */
export async function runAdmin(
  name: string,
  fn: (admin: CurrentUser) => Promise<string>,
  revalidate: string[] = [],
): Promise<AdminState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    log("warn", "admin.forbidden", { action: name, userId: user?.id });
    return { error: "You need to be signed in as an administrator." };
  }
  try {
    const ok = await fn(user);
    log("info", `admin.${name}`, { adminId: user.id });
    for (const p of revalidate) revalidatePath(p);
    return { ok };
  } catch (err) {
    const e = toActionError(err, `admin.${name}`, { adminId: user.id });
    const issues = isServiceError(err)
      ? ((err.details?.issues ?? []) as Array<{ path: string; message: string }>).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      : [];
    return { error: e.message, issues };
  }
}

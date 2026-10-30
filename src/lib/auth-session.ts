import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type Role = "CUSTOMER" | "ADMIN";

/** Narrow view of the signed-in user, safe to pass to client components. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
}

/**
 * Data access layer for authentication. Reads and validates the session
 * against the database once per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string; phone?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "ADMIN" ? "ADMIN" : "CUSTOMER",
    phone: u.phone ?? null,
  };
});

/** Redirects to /login (keeping where the user wanted to go) when signed out. */
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return user;
}

/** Admin-only pages: signed-out users go to /login, everyone else gets a 404. */
export async function requireAdmin(nextPath = "/admin"): Promise<CurrentUser> {
  const user = await requireUser(nextPath);
  if (user.role !== "ADMIN") notFound();
  return user;
}

/** Only allow same-site relative redirect targets. */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

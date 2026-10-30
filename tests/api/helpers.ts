// Helpers for HTTP-level tests run by the Playwright "api" project (server on the TEST database).
import { randomUUID } from "node:crypto";
import { request as pwRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { connectTestClient } from "../helpers/db";
import { selectTestDatabase } from "../helpers/env";

selectTestDatabase();

export const PASSWORD = "Correct-Horse-9";

export function uniqueEmail(tag = "user") {
  return `qa-${tag}-${randomUUID().slice(0, 8)}@example.test`;
}

let ipSeq = 0;
/** A distinct client IP per context, so Better Auth's per-IP rate limiter treats test users independently. */
export function fakeIp() {
  ipSeq++;
  return `10.${process.pid % 250}.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

export async function newClient(baseURL: string, ip = fakeIp()): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-forwarded-for": ip } });
}

export async function signUp(ctx: APIRequestContext, email = uniqueEmail(), name = "QA User") {
  const res = await ctx.post("/api/auth/sign-up/email", { data: { email, password: PASSWORD, name } });
  if (!res.ok()) throw new Error(`sign-up failed ${res.status()}: ${await res.text()}`);
  const body = await res.json();
  return { email, userId: body.user.id as string };
}

export async function signIn(ctx: APIRequestContext, email: string, password = PASSWORD) {
  return ctx.post("/api/auth/sign-in/email", { data: { email, password } });
}

export async function getSession(ctx: APIRequestContext) {
  const res = await ctx.get("/api/auth/get-session");
  if (!res.ok()) return null;
  const text = await res.text();
  return text && text !== "null" ? JSON.parse(text) : null;
}

/** A signed-in customer client. */
export async function customer(baseURL: string) {
  const ctx = await newClient(baseURL);
  const u = await signUp(ctx, uniqueEmail("cust"));
  return { ctx, ...u };
}

/** A signed-in ADMIN client (sign up, promote in the test DB, sign in again for a fresh session). */
export async function admin(baseURL: string) {
  const ctx = await newClient(baseURL);
  const u = await signUp(ctx, uniqueEmail("admin"));
  await sql("UPDATE users SET role = 'ADMIN' WHERE id = $1", [u.userId]);
  await ctx.post("/api/auth/sign-out", { data: {} });
  const res = await signIn(ctx, u.email);
  if (!res.ok()) throw new Error(`admin sign-in failed ${res.status()}`);
  return { ctx, ...u };
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = await connectTestClient();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Denied = 401/403/404, or a redirect to /login. */
export function isDenied(res: APIResponse): boolean {
  const s = res.status();
  if ([401, 403, 404].includes(s)) return true;
  if (s >= 300 && s < 400) return /\/login/.test(res.headers()["location"] ?? "");
  return false;
}

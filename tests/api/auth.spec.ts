// QA-2 (HTTP level): registration, login, logout, sessions, origin checks, protected-route redirects.
import { expect, test } from "@playwright/test";
import { PASSWORD, fakeIp, getSession, newClient, signIn, signUp, sql, uniqueEmail } from "./helpers";

test.describe("auth over HTTP", () => {
  test("register creates a CUSTOMER and signs in", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const email = uniqueEmail("reg");
    const { userId } = await signUp(ctx, email, "Reg User");
    const session = await getSession(ctx);
    expect(session?.user?.id).toBe(userId);
    expect(session?.user?.email).toBe(email);
    const [row] = await sql<{ role: string }>("SELECT role FROM users WHERE id = $1", [userId]);
    expect(row.role).toBe("CUSTOMER");
    const [acct] = await sql<{ password: string }>("SELECT password FROM accounts WHERE user_id = $1", [userId]);
    expect(acct.password).not.toContain(PASSWORD); // hashed, never plain text
  });

  test("role cannot be escalated through sign-up input", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const email = uniqueEmail("esc");
    const res = await ctx.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Sneaky", role: "ADMIN" },
    });
    // Either rejected outright, or accepted with role forced to CUSTOMER.
    if (res.ok()) {
      const [row] = await sql<{ role: string }>("SELECT role FROM users WHERE email = $1", [email]);
      expect(row.role).toBe("CUSTOMER");
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(await sql("SELECT 1 FROM users WHERE email = $1 AND role = 'ADMIN'", [email])).toHaveLength(0);
    }
  });

  test("duplicate email and short password are rejected", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const email = uniqueEmail("dup");
    await signUp(ctx, email);
    const other = await newClient(baseURL!);
    const dup = await other.post("/api/auth/sign-up/email", { data: { email, password: PASSWORD, name: "Dup" } });
    expect(dup.status()).toBeGreaterThanOrEqual(400);
    expect(dup.status()).toBeLessThan(500);
    const short = await other.post("/api/auth/sign-up/email", {
      data: { email: uniqueEmail("short"), password: "short", name: "S" },
    });
    expect(short.status()).toBe(400);
  });

  test("login: wrong password 401, right password gives a session", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const { email, userId } = await signUp(ctx);
    const fresh = await newClient(baseURL!);
    const bad = await signIn(fresh, email, "Wrong-Password-1");
    expect(bad.status()).toBe(401);
    expect(await getSession(fresh)).toBeNull();
    const unknown = await signIn(fresh, uniqueEmail("nobody"));
    expect(unknown.status()).toBe(401); // same answer as wrong password: no account enumeration
    const ok = await signIn(fresh, email);
    expect(ok.ok()).toBe(true);
    expect((await getSession(fresh))?.user?.id).toBe(userId);
  });

  test("logout ends the session server-side (old cookie is useless)", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const { userId } = await signUp(ctx);
    const state = await ctx.storageState();
    const token = state.cookies.find((c) => c.name.endsWith("better-auth.session_token"));
    expect(token).toBeTruthy();
    const out = await ctx.post("/api/auth/sign-out", { data: {} });
    expect(out.ok()).toBe(true);
    expect(await getSession(ctx)).toBeNull();
    expect(await sql("SELECT 1 FROM sessions WHERE user_id = $1", [userId])).toHaveLength(0);
    // Replay the stolen cookie in a new client.
    const replay = await newClient(baseURL!);
    const res = await replay.get("/api/auth/get-session", {
      headers: { cookie: `${token!.name}=${token!.value}` },
    });
    const body = await res.text();
    expect(body === "null" || body === "" || res.status() >= 400).toBe(true);
  });

  test("state-changing auth calls from a foreign Origin are refused", async ({ baseURL, playwright }) => {
    const evil = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: "https://evil.example", "x-forwarded-for": fakeIp() } });
    const res = await evil.post("/api/auth/sign-up/email", {
      data: { email: uniqueEmail("evil"), password: PASSWORD, name: "Evil" },
    });
    expect(res.status()).toBe(403);
  });

  for (const path of ["/reservations", "/profile", "/checkout/00000000-0000-0000-0000-000000000000", "/admin", "/admin/fleet"]) {
    test(`signed-out GET ${path} redirects to /login?next=`, async ({ baseURL }) => {
      const ctx = await newClient(baseURL!);
      const res = await ctx.get(path, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(res.status());
      const loc = new URL(res.headers()["location"], baseURL);
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next")).toBe(path);
    });
  }

  test("repeated failed logins from one IP are rate limited (429)", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const { email } = await signUp(ctx);
    const attacker = await newClient(baseURL!);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await signIn(attacker, email, `Wrong-${i}-password`)).status());
    expect(statuses[0]).toBe(401);
    expect(statuses).toContain(429);
  });

  test("a forged session cookie is not accepted as a session", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const res = await ctx.get("/api/auth/get-session", {
      headers: { cookie: "better-auth.session_token=forged.token" },
    });
    const body = await res.text();
    expect(body === "null" || body === "" || res.status() >= 400).toBe(true);
  });
});

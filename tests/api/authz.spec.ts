// QA-2 / QA-6 / QA-7 at HTTP level: users cannot open other users' reservations, vouchers, checkout pages
// or licence files; webhook route verifies signatures and dedupes; cron route needs the secret.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signFakeWebhook } from "../../src/lib/payments/fake-provider";
import { admin, customer, isDenied, newClient, signIn, sql } from "./helpers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const SEED_CUSTOMER = { email: "customer@driveeasy.local", password: "DriveEasyCustomer!1" };

async function seededReservation() {
  const [r] = await sql<{ id: string; reference: string }>(
    `SELECT r.id, r.reference FROM reservations r JOIN users u ON u.id = r.user_id
      WHERE u.email = $1 AND r.status = 'CONFIRMED' ORDER BY r.pickup_at LIMIT 1`,
    [SEED_CUSTOMER.email],
  );
  expect(r, "seed should contain a confirmed reservation for the demo customer").toBeTruthy();
  return r;
}

test.describe("cross-user access", () => {
  test("owner sees their voucher; another customer and anonymous users do not", async ({ baseURL }) => {
    const r = await seededReservation();
    const owner = await newClient(baseURL!);
    expect((await signIn(owner, SEED_CUSTOMER.email, SEED_CUSTOMER.password)).ok()).toBe(true);
    const own = await owner.get(`/reservations/${r.id}/voucher`, { maxRedirects: 0 });
    expect(own.status()).toBe(200);
    expect(await own.text()).toContain(r.reference);

    const { ctx: other } = await customer(baseURL!);
    for (const path of [`/reservations/${r.id}/voucher`, `/reservations/${r.id}`, `/checkout/${r.id}`]) {
      const res = await other.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} as another customer`).toBe(404); // BUG-5: real 404
      expect(await res.text()).not.toContain(r.reference);
    }
    const anon = await newClient(baseURL!);
    for (const path of [`/reservations/${r.id}/voucher`, `/checkout/${r.id}`]) {
      const res = await anon.get(path, { maxRedirects: 0 });
      expect(isDenied(res), `${path} anonymous -> ${res.status()}`).toBe(true);
    }
  });

  test("licence file route /api/files?key=: owner + admin 200 (private), others 404, anonymous 401", async ({ baseURL }) => {
    // Put a licence for a fresh customer into the server's upload folder and onto their driver profile.
    const owner = await customer(baseURL!);
    const key = `licences/${owner.userId}/${randomUUID()}.png`;
    const filePath = path.resolve("./storage/test-uploads", key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, PNG);
    await writeFile(filePath + ".meta.json", JSON.stringify({ contentType: "image/png" }));
    await sql(
      `INSERT INTO driver_profiles (user_id, full_name, date_of_birth, phone, licence_number, licence_country, licence_expiry, licence_file_key)
       VALUES ($1, 'Owner', '1990-01-01', '+971500000000', 'L-1', 'AE', '2035-01-01', $2)`,
      [owner.userId, key],
    );
    const url = `/api/files?key=${encodeURIComponent(key)}`;
    const own = await owner.ctx.get(url);
    expect(own.status()).toBe(200);
    expect(own.headers()["cache-control"]).toMatch(/private|no-store/);
    expect(Buffer.from(await own.body()).subarray(0, 4)).toEqual(Buffer.from(PNG.subarray(0, 4)));

    const adm = await admin(baseURL!);
    expect((await adm.ctx.get(url)).status()).toBe(200);
    const { ctx: other } = await customer(baseURL!);
    expect((await other.get(url)).status()).toBe(404);
    const anon = await newClient(baseURL!);
    expect((await anon.get(url, { maxRedirects: 0 })).status()).toBe(401);
    for (const bad of ["../../.env.local", "licences/../../.env.local", `licences/${owner.userId}/../x.png`, ""]) {
      expect((await other.get(`/api/files?key=${encodeURIComponent(bad)}`)).status(), bad).toBe(404);
      expect((await adm.ctx.get(`/api/files?key=${encodeURIComponent(bad)}`)).status(), `admin ${bad}`).toBeGreaterThanOrEqual(400);
    }
  });

  test("customer gets 404 on every admin page; admin gets 200", async ({ baseURL }) => {
    const { ctx: cust } = await customer(baseURL!);
    const adm = await admin(baseURL!);
    const r = await seededReservation();
    for (const path of ["/admin", "/admin/reservations", `/admin/reservations/${r.id}`, "/admin/fleet", "/admin/pricing", "/admin/branches", "/admin/damage"]) {
      const c = await cust.get(path, { maxRedirects: 0 });
      expect(c.status(), `customer ${path}`).toBe(404);
      expect(await c.text()).not.toContain(r.reference);
      expect((await adm.ctx.get(path, { maxRedirects: 0 })).status(), `admin ${path}`).toBe(200);
    }
  });
});

test.describe("payment webhook route", () => {
  const secret = () => process.env.FAKE_PAYMENT_WEBHOOK_SECRET!;
  const event = () => ({
    id: `evt_qa_${randomUUID()}`,
    type: "payment.succeeded",
    createdAt: new Date().toISOString(),
    data: { id: `pay_qa_${randomUUID()}`, amount: 100, currency: "aed", status: "succeeded", refundedAmount: 0, metadata: {}, createdAt: new Date().toISOString() },
  });

  test("rejects missing / bad / stale signatures with 400 and stores nothing", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const ev = event();
    const raw = JSON.stringify(ev);
    const now = Math.floor(Date.now() / 1000);
    for (const sig of [undefined, "t=1,v1=00", signFakeWebhook(raw, "wrong", now), signFakeWebhook(raw, secret(), now - 3600)]) {
      const res = await ctx.post("/api/webhooks/payments", {
        data: raw,
        headers: { "content-type": "application/json", ...(sig ? { "x-fake-signature": sig } : {}) },
      });
      expect(res.status(), `signature ${sig}`).toBe(400);
    }
    expect(await sql("SELECT 1 FROM payment_webhook_events WHERE event_id = $1", [ev.id])).toHaveLength(0);
  });

  test("same event delivered 3x (also concurrently) is stored and processed once", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    const ev = event();
    const raw = JSON.stringify(ev);
    const sig = signFakeWebhook(raw, secret(), Math.floor(Date.now() / 1000));
    const post = () => ctx.post("/api/webhooks/payments", { data: raw, headers: { "content-type": "application/json", "x-fake-signature": sig } });
    const results = await Promise.all([post(), post(), post()]);
    for (const r of results) expect(r.status()).toBeLessThan(300);
    const rows = await sql<{ processed_at: Date | null }>("SELECT processed_at FROM payment_webhook_events WHERE event_id = $1", [ev.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].processed_at).not.toBeNull();
  });
});

test.describe("cron route", () => {
  test("requires Bearer CRON_SECRET", async ({ baseURL }) => {
    const ctx = await newClient(baseURL!);
    expect((await ctx.get("/api/cron/release-holds")).status()).toBe(401);
    expect((await ctx.get("/api/cron/release-holds", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await ctx.get("/api/cron/release-holds", { headers: { authorization: process.env.CRON_SECRET! } })).status()).toBe(401);
    const ok = await ctx.get("/api/cron/release-holds", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ released: expect.any(Number), ranAt: expect.any(String) });
    // Idempotent: a second run right away releases nothing new.
    const again = await (await ctx.get("/api/cron/release-holds", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
    expect(again.released).toBe(0);
    expect((await ctx.get("/api/cron/nope", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).status()).toBe(404);
  });
});

// QA-6: payments + deposits through db's services with a private FakePaymentProvider.
// Webhooks are delivered by hand (pump) so tests control ordering, duplicates and delays.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, deposits, payments, reservations } from "@/lib/db/schema";
import { FakePaymentProvider, signFakeWebhook } from "@/lib/payments/fake-provider";
import type { PaymentEvent } from "@/lib/payments";
import { cancelReservation } from "@/server/changes";
import { releaseExpiredHolds } from "@/server/holds";
import { applyPaymentEvent, handlePaymentWebhook, payReservation } from "@/server/payments";
import { createReservation } from "@/server/reservations";
import { truncateAll } from "../helpers/db";
import { DAY, createUser, createWorld, futureAt, type World } from "../helpers/factories";
import { bookingInput, settle } from "../helpers/booking";

const SECRET = "qa-webhook-secret";

/** Provider + a webhook pump that applies every not-yet-delivered event (optionally twice). */
function newProvider() {
  const provider = new FakePaymentProvider({ webhookSecret: SECRET });
  let delivered = 0;
  const pump = async (times = 1) => {
    const evs = provider.listEvents().slice(delivered);
    delivered += evs.length;
    const out = [];
    for (const ev of evs) for (let i = 0; i < times; i++) out.push(await applyPaymentEvent(ev, { provider }));
    return out;
  };
  return { provider, pump };
}

const reservation = async (id: string) => (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
const paymentRows = (id: string) => db.select().from(payments).where(eq(payments.reservationId, id));
const depositRows = (id: string) => db.select().from(deposits).where(eq(deposits.reservationId, id));
const providerCharges = (p: FakePaymentProvider) =>
  new Set(p.listEvents().filter((e) => e.type === "payment.succeeded").map((e) => e.data.id)).size;

async function book(w: World, days = 2, startInDays = 10) {
  const s = futureAt(startInDays);
  return createReservation(bookingInput(w, s, new Date(+s + days * DAY)));
}

describe("payments", () => {
  beforeEach(() => truncateAll());

  it("success: charge + deposit hold; CONFIRMED only after both webhooks", async () => {
    const w = await createWorld({ dailyRateFils: 15_000, depositFils: 100_000 });
    const r = await book(w);
    const { provider, pump } = newProvider();
    const res = await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    expect(res.outcome).toBe("PROCESSING"); // nothing confirmed from the sync response
    expect((await reservation(r.reservationId)).status).toBe("PENDING");
    const results = await pump();
    expect(results.map((x) => x.status)).toEqual(["processed", "processed"]);
    const after = await reservation(r.reservationId);
    expect(after.status).toBe("CONFIRMED");
    expect(after.holdExpiresAt).toBeNull();
    const [pay] = await paymentRows(r.reservationId);
    expect(pay).toMatchObject({ status: "SUCCEEDED", amountFils: 31_500, idempotencyKey: `${r.reservationId}:charge:1` });
    const [dep] = await depositRows(r.reservationId);
    expect(dep).toMatchObject({ status: "AUTHORIZED", amountFils: 100_000 });
    // Paying again is a no-op.
    const again = await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    expect(again.outcome).toBe("CONFIRMED");
    expect(providerCharges(provider)).toBe(1);
  });

  it("duplicate webhook delivery is processed once", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    const results = await pump(3);
    expect(results.map((x) => x.status)).toEqual(["processed", "duplicate", "duplicate", "processed", "duplicate", "duplicate"]);
    const confirmations = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, r.reservationId), eq(auditLogs.action, "reservation.confirmed")));
    expect(confirmations).toHaveLength(1);
    // Same through the signed HTTP-body path, concurrently.
    const ev = provider.listEvents()[0];
    const raw = JSON.stringify(ev);
    const sig = signFakeWebhook(raw, SECRET, Math.floor(Date.now() / 1000));
    const many = await Promise.all([1, 2, 3, 4].map(() => handlePaymentWebhook(raw, sig, { provider })));
    expect(many.every((m) => m.status === "duplicate")).toBe(true);
  });

  it("concurrent first delivery of the same event: exactly one processed", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    const [charge] = provider.listEvents();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => settle(applyPaymentEvent(charge, { provider }))));
    const statuses = results.map((x) => (x.ok ? x.value.status : `error:${x.code}`));
    expect(statuses.filter((s) => s === "processed")).toHaveLength(1);
    expect(statuses.filter((s) => s === "duplicate")).toHaveLength(4);
  });

  it("webhook signature: bad, missing, tampered and stale signatures are rejected", async () => {
    const { provider } = newProvider();
    const ev: PaymentEvent = {
      id: "evt_x",
      type: "payment.succeeded",
      createdAt: new Date().toISOString(),
      data: { id: "p", amount: 1, currency: "aed", status: "succeeded", refundedAmount: 0, metadata: {}, createdAt: "" },
    };
    const raw = JSON.stringify(ev);
    const now = Math.floor(Date.now() / 1000);
    for (const sig of [null, "garbage", signFakeWebhook(raw, "wrong-secret", now), signFakeWebhook(raw, SECRET, now - 3600)]) {
      expect(await settle(handlePaymentWebhook(raw, sig, { provider }))).toMatchObject({ code: "INVALID_SIGNATURE" });
    }
    const tampered = raw.replace('"amount":1', '"amount":2');
    expect(await settle(handlePaymentWebhook(tampered, signFakeWebhook(raw, SECRET, now), { provider }))).toMatchObject({
      code: "INVALID_SIGNATURE",
    });
  });

  it("failure then retry with another card: one charge, new idempotency key, confirmed", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    const pay = (pm: string) => payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: pm }, { provider });
    const failed = await pay("pm_fake_fail");
    expect(failed.outcome).toBe("PAYMENT_FAILED");
    await pump();
    expect((await reservation(r.reservationId)).status).toBe("PENDING");
    const ok = await pay("pm_fake_success");
    await pump();
    expect((await reservation(r.reservationId)).status).toBe("CONFIRMED");
    expect(ok.outcome).toBe("PROCESSING");
    const rows = (await paymentRows(r.reservationId)).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
    expect(rows.map((p) => [p.idempotencyKey.split(":").slice(1).join(":"), p.status])).toEqual([
      ["charge:1", "FAILED"],
      ["charge:2", "SUCCEEDED"],
    ]);
    expect(providerCharges(provider)).toBe(1);
  });

  it("cancelled payment (customer abandons): PAYMENT_FAILED, reservation stays PENDING", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    const res = await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_cancel" }, { provider });
    expect(res.outcome).toBe("PAYMENT_FAILED");
    await pump();
    const [p] = await paymentRows(r.reservationId);
    expect(p.status).toBe("CANCELLED");
    expect((await reservation(r.reservationId)).status).toBe("PENDING");
  });

  it("double-click / network retry: concurrent payReservation calls charge once", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    const input = { reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" };
    const results = await Promise.all([1, 2, 3, 4].map(() => settle(payReservation(input, { provider }))));
    expect(results.every((x) => x.ok)).toBe(true);
    await pump();
    expect(providerCharges(provider)).toBe(1);
    expect(await paymentRows(r.reservationId)).toHaveLength(1);
    expect(await depositRows(r.reservationId)).toHaveLength(1);
    expect((await reservation(r.reservationId)).status).toBe("CONFIRMED");
  });

  it("someone else cannot pay / read through payReservation", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider } = newProvider();
    const other = await createUser();
    expect(
      await settle(payReservation({ reservationId: r.reservationId, userId: other.id, paymentMethod: "pm_fake_success" }, { provider })),
    ).toMatchObject({ code: "NOT_FOUND" });
  });

  it("paying an expired hold -> HOLD_EXPIRED, nothing charged", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider } = newProvider();
    const res = await settle(
      payReservation(
        { reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" },
        { provider, now: new Date(Date.now() + 16 * 60_000) },
      ),
    );
    expect(res).toMatchObject({ code: "HOLD_EXPIRED" });
    expect(provider.listEvents()).toHaveLength(0);
  });

  it("payment that lands after the hold expired is refunded and the deposit released", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    // Webhooks are delayed; meanwhile the hold expires and the job runs.
    await releaseExpiredHolds(new Date(Date.now() + 16 * 60_000), { provider });
    expect((await reservation(r.reservationId)).status).toBe("EXPIRED");
    await pump();
    await pump(); // refund / release events
    expect((await reservation(r.reservationId)).status).toBe("EXPIRED");
    const [p] = await paymentRows(r.reservationId);
    expect(p).toMatchObject({ status: "REFUNDED", refundedFils: p.amountFils });
    const [d] = await depositRows(r.reservationId);
    expect(d.status).toBe("RELEASED");
  });

  it("refund: free cancellation > 48h before pick-up refunds everything and releases the deposit", async () => {
    const w = await createWorld({ dailyRateFils: 15_000 });
    const r = await book(w, 2, 10);
    const { provider, pump } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    await pump();
    const c = await cancelReservation({ reservationId: r.reservationId, userId: w.customer.id }, { provider });
    expect(c).toMatchObject({ feeFils: 0, refundFils: 31_500 });
    await pump();
    const after = await reservation(r.reservationId);
    expect(after.status).toBe("REFUNDED");
    expect(after.refundedFils).toBe(31_500);
    const [p] = await paymentRows(r.reservationId);
    expect(p).toMatchObject({ status: "REFUNDED", refundedFils: 31_500 });
    expect((await depositRows(r.reservationId))[0].status).toBe("RELEASED");
    // Cancelling again is refused; refund is not repeated.
    expect(await settle(cancelReservation({ reservationId: r.reservationId, userId: w.customer.id }, { provider }))).toMatchObject({
      code: "INVALID_STATE",
    });
    expect(provider.listEvents().filter((e) => e.type === "payment.refunded")).toHaveLength(1);
  });

  it("refund: late cancellation (< 48h) keeps one day (rate + VAT), refunds the rest, releases deposit", async () => {
    const w = await createWorld({ dailyRateFils: 15_000 });
    const r = await book(w, 3, 1); // pick-up in ~1 day, 3 days: 450.00 + 22.50 = 472.50
    const { provider, pump } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    await pump();
    const c = await cancelReservation({ reservationId: r.reservationId, userId: w.customer.id }, { provider });
    expect(c).toMatchObject({ feeFils: 15_750, refundFils: 47_250 - 15_750 });
    await pump();
    const [p] = await paymentRows(r.reservationId);
    expect(p).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedFils: 31_500 });
    expect((await depositRows(r.reservationId))[0].status).toBe("RELEASED");
  });

  it("cancelling a PENDING reservation whose charge succeeds afterwards (webhook in flight) refunds the charge", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_success" }, { provider });
    // Customer cancels before the success webhooks are processed.
    await cancelReservation({ reservationId: r.reservationId, userId: w.customer.id }, { provider });
    await pump();
    await releaseExpiredHolds(new Date(), { provider }); // the safety-net job
    await pump();
    const [p] = await paymentRows(r.reservationId);
    expect(p.status, "customer was charged for a cancelled booking and never refunded").toBe("REFUNDED");
    expect((await depositRows(r.reservationId))[0].status).toBe("RELEASED");
  });

  it("pending payment + expired hold: job cancels the pending payment", async () => {
    const w = await createWorld();
    const r = await book(w);
    const { provider, pump } = newProvider();
    const res = await payReservation({ reservationId: r.reservationId, userId: w.customer.id, paymentMethod: "pm_fake_pending" }, { provider });
    expect(res.outcome).toBe("PROCESSING");
    await pump();
    await releaseExpiredHolds(new Date(Date.now() + 16 * 60_000), { provider });
    await pump();
    expect((await reservation(r.reservationId)).status).toBe("EXPIRED");
    expect((await paymentRows(r.reservationId))[0].status).toBe("CANCELLED");
  });
});

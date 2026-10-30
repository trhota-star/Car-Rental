import { describe, expect, it } from "vitest";
import { createPaymentProvider } from "@/lib/payments";
import {
  FAKE_PAYMENT_METHODS as PM,
  FakePaymentProvider,
  signFakeWebhook,
} from "@/lib/payments/fake-provider";
import type { PaymentEvent } from "@/lib/payments/types";

const SECRET = "test-secret";

function setup(duplicateWebhooks = false) {
  const delivered: { rawBody: string; signature: string; event: PaymentEvent }[] = [];
  const provider = new FakePaymentProvider({
    webhookSecret: SECRET,
    duplicateWebhooks,
    deliver: async (rawBody, signature, event) => {
      delivered.push({ rawBody, signature, event });
    },
  });
  return { provider, delivered };
}

const charge = { amount: 12_500, currency: "USD" };

describe("FakePaymentProvider payments", () => {
  it("succeeds", async () => {
    const { provider, delivered } = setup();
    const p = await provider.createPayment({ ...charge, paymentMethod: PM.success });
    expect(p.status).toBe("succeeded");
    expect(p.currency).toBe("usd");
    expect(delivered.map((d) => d.event.type)).toEqual(["payment.succeeded"]);
  });

  it("fails with a decline reason", async () => {
    const { provider, delivered } = setup();
    const p = await provider.createPayment({ ...charge, paymentMethod: PM.fail });
    expect(p).toMatchObject({ status: "failed", failureReason: "card_declined" });
    expect(delivered[0].event.type).toBe("payment.failed");
  });

  it("cancels at checkout and via cancelPayment", async () => {
    const { provider } = setup();
    expect((await provider.createPayment({ ...charge, paymentMethod: PM.cancel })).status).toBe("canceled");
    const pending = await provider.createPayment({ ...charge, paymentMethod: PM.pending });
    expect(pending.status).toBe("pending");
    expect((await provider.cancelPayment(pending.id)).status).toBe("canceled");
  });

  it("refuses to cancel a succeeded payment", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ ...charge, paymentMethod: PM.success });
    await expect(provider.cancelPayment(p.id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("refunds partially then fully, never more than paid", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ ...charge, paymentMethod: PM.success });
    expect(await provider.refundPayment(p.id, 2_500)).toMatchObject({ status: "partially_refunded", refundedAmount: 2_500 });
    await expect(provider.refundPayment(p.id, 20_000)).rejects.toMatchObject({ code: "amount_too_large" });
    expect(await provider.refundPayment(p.id)).toMatchObject({ status: "refunded", refundedAmount: 12_500 });
  });

  it("returns the same payment for a repeated idempotency key", async () => {
    const { provider, delivered } = setup();
    const a = await provider.createPayment({ ...charge, paymentMethod: PM.success, idempotencyKey: "booking-1" });
    const b = await provider.createPayment({ ...charge, paymentMethod: PM.success, idempotencyKey: "booking-1" });
    expect(b.id).toBe(a.id);
    expect(delivered).toHaveLength(1);
  });

  it("rejects non-integer amounts", async () => {
    const { provider } = setup();
    await expect(provider.createPayment({ ...charge, amount: 10.5, paymentMethod: PM.success })).rejects.toMatchObject({
      code: "invalid_amount",
    });
  });
});

describe("FakePaymentProvider deposits", () => {
  it("holds and releases", async () => {
    const { provider, delivered } = setup();
    const h = await provider.holdDeposit({ ...charge, paymentMethod: PM.success });
    expect(h.status).toBe("held");
    expect((await provider.releaseDeposit(h.id)).status).toBe("released");
    expect(delivered.map((d) => d.event.type)).toEqual(["deposit.held", "deposit.released"]);
  });

  it("captures part of a deposit and cannot release afterwards", async () => {
    const { provider } = setup();
    const h = await provider.holdDeposit({ ...charge, paymentMethod: PM.success });
    expect(await provider.captureDeposit(h.id, 3_000)).toMatchObject({ status: "captured", capturedAmount: 3_000 });
    await expect(provider.releaseDeposit(h.id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("fails a hold on a declined card", async () => {
    const { provider } = setup();
    expect((await provider.holdDeposit({ ...charge, paymentMethod: PM.fail })).status).toBe("failed");
  });
});

describe("FakePaymentProvider webhooks", () => {
  it("signs webhooks that verify", async () => {
    const { provider, delivered } = setup();
    await provider.createPayment({ ...charge, paymentMethod: PM.success });
    const event = provider.verifyWebhook(delivered[0].rawBody, delivered[0].signature);
    expect(event.type).toBe("payment.succeeded");
  });

  it("rejects tampered, unsigned and stale webhooks", async () => {
    const { provider, delivered } = setup();
    await provider.createPayment({ ...charge, paymentMethod: PM.success });
    const { rawBody, signature } = delivered[0];
    expect(() => provider.verifyWebhook(rawBody.replace("12500", "1"), signature)).toThrow(/Invalid/);
    expect(() => provider.verifyWebhook(rawBody, null)).toThrow(/Missing/);
    const stale = signFakeWebhook(rawBody, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(() => provider.verifyWebhook(rawBody, stale)).toThrow(/expired/);
  });

  it("sends every webhook twice when duplicates are on", async () => {
    const { provider, delivered } = setup(true);
    await provider.createPayment({ ...charge, paymentMethod: PM.success });
    expect(delivered).toHaveLength(2);
    expect(delivered[0].event.id).toBe(delivered[1].event.id);
  });

  it("can resend a past event on demand", async () => {
    const { provider, delivered } = setup();
    await provider.createPayment({ ...charge, paymentMethod: PM.success });
    await provider.resendEvent(provider.listEvents()[0].id);
    expect(delivered.map((d) => d.event.id)).toEqual([delivered[0].event.id, delivered[0].event.id]);
  });
});

describe("createPaymentProvider", () => {
  it("picks the provider from settings", () => {
    expect(createPaymentProvider({ PAYMENT_PROVIDER: "fake", FAKE_PAYMENT_WEBHOOK_SECRET: "x" }).name).toBe("fake");
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "stripe" })).toThrow(/not implemented/);
  });
});

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { MemoryFakeProviderStore, type FakeObject, type FakeProviderStore } from "./fake-store";
import {
  PaymentError,
  type ChargeInput,
  type DepositHold,
  type Payment,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
} from "./types";

/**
 * Test payment methods understood by the fake provider.
 *   pm_fake_success  -> payment succeeds / deposit is held
 *   pm_fake_fail     -> card declined
 *   pm_fake_cancel   -> customer abandons checkout (payment canceled)
 *   pm_fake_pending  -> payment stays pending until cancelPayment() is called
 */
export const FAKE_PAYMENT_METHODS = {
  success: "pm_fake_success",
  fail: "pm_fake_fail",
  cancel: "pm_fake_cancel",
  pending: "pm_fake_pending",
} as const;

export const FAKE_SIGNATURE_HEADER = "x-fake-signature";
const SIGNATURE_TOLERANCE_SECONDS = 300;

export type WebhookDeliver = (
  rawBody: string,
  signatureHeader: string,
  event: PaymentEvent,
) => Promise<void>;

export interface FakePaymentProviderOptions {
  webhookSecret: string;
  /** Where webhooks go. Omit to only record events (useful in unit tests). */
  deliver?: WebhookDeliver;
  /** Send every webhook twice, like real providers sometimes do. */
  duplicateWebhooks?: boolean;
  now?: () => Date;
  /**
   * Where payments, holds, idempotency keys and events live. Default: in memory (unit tests, scripts).
   * The app uses PgFakeProviderStore so state survives server restarts.
   */
  store?: FakeProviderStore;
}

export function signFakeWebhook(rawBody: string, secret: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export function httpWebhookDeliver(url: string): WebhookDeliver {
  return async (rawBody, signatureHeader) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signatureHeader },
        body: rawBody,
      });
      if (!res.ok) console.warn(`[fake-payments] webhook to ${url} returned ${res.status}`);
    } catch (err) {
      console.warn(`[fake-payments] webhook to ${url} failed:`, (err as Error).message);
    }
  };
}

const REJECTED_METHOD = "invalid_payment_method";

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly signatureHeader = FAKE_SIGNATURE_HEADER;
  private readonly store: FakeProviderStore;
  /** Events emitted by THIS instance (sync view for tests); the store keeps all of them. */
  private events: PaymentEvent[] = [];
  private now: () => Date;

  constructor(private readonly options: FakePaymentProviderOptions) {
    if (!options.webhookSecret) throw new Error("FakePaymentProvider needs a webhookSecret");
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? new MemoryFakeProviderStore();
  }

  async createPayment(input: ChargeInput): Promise<Payment> {
    validateAmount(input.amount);
    const id = `pay_fake_${randomUUID()}`;
    const owner = input.idempotencyKey ? await this.store.claimIdempotency(`pay:${input.idempotencyKey}`, id) : id;
    if (owner !== id) return strip<Payment>(await this.waitFor(owner));

    const payment: Payment = {
      id,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      status: "succeeded",
      refundedAmount: 0,
      metadata: input.metadata ?? {},
      createdAt: this.now().toISOString(),
    };
    switch (input.paymentMethod) {
      case FAKE_PAYMENT_METHODS.success:
        break;
      case FAKE_PAYMENT_METHODS.fail:
        payment.status = "failed";
        payment.failureReason = "card_declined";
        break;
      case FAKE_PAYMENT_METHODS.cancel:
        payment.status = "canceled";
        break;
      case FAKE_PAYMENT_METHODS.pending:
        payment.status = "pending";
        break;
      default:
        // Keep the key bound to a rejected attempt so a retry with the same key fails the same way.
        await this.store.insert({ ...payment, status: "failed", failureReason: REJECTED_METHOD, kind: "payment" });
        throw new PaymentError(`Unknown fake payment method "${input.paymentMethod}"`, REJECTED_METHOD);
    }
    await this.store.insert({ ...payment, kind: "payment" });
    await this.emit(`payment.${payment.status}` as PaymentEventType, payment);
    return { ...payment };
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    const r = await this.mutatePayment(paymentId, (p) => {
      if (p.status === "canceled") return p;
      if (p.status !== "pending") {
        throw new PaymentError(`Cannot cancel a ${p.status} payment; refund it instead`, "invalid_state");
      }
      return { ...p, status: "canceled" };
    });
    if (r.before.status !== r.after.status) await this.emit("payment.canceled", r.after);
    return r.after;
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    const r = await this.mutatePayment(paymentId, (p) => {
      if (p.status !== "succeeded" && p.status !== "partially_refunded") {
        throw new PaymentError(`Cannot refund a ${p.status} payment`, "invalid_state");
      }
      const remaining = p.amount - p.refundedAmount;
      const refund = amount ?? remaining;
      validateAmount(refund);
      if (refund > remaining) throw new PaymentError("Refund exceeds remaining amount", "amount_too_large");
      const refundedAmount = p.refundedAmount + refund;
      return { ...p, refundedAmount, status: refundedAmount === p.amount ? "refunded" : "partially_refunded" };
    });
    await this.emit("payment.refunded", r.after);
    return r.after;
  }

  async holdDeposit(input: ChargeInput): Promise<DepositHold> {
    validateAmount(input.amount);
    const id = `hold_fake_${randomUUID()}`;
    const owner = input.idempotencyKey ? await this.store.claimIdempotency(`hold:${input.idempotencyKey}`, id) : id;
    if (owner !== id) return strip<DepositHold>(await this.waitFor(owner));

    const hold: DepositHold = {
      id,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      status: "held",
      capturedAmount: 0,
      metadata: input.metadata ?? {},
      createdAt: this.now().toISOString(),
    };
    if (input.paymentMethod === FAKE_PAYMENT_METHODS.fail) {
      hold.status = "failed";
      hold.failureReason = "card_declined";
    } else if (input.paymentMethod !== FAKE_PAYMENT_METHODS.success) {
      await this.store.insert({ ...hold, status: "failed", failureReason: REJECTED_METHOD, kind: "hold" });
      throw new PaymentError(`Unsupported payment method for deposits "${input.paymentMethod}"`, REJECTED_METHOD);
    }
    await this.store.insert({ ...hold, kind: "hold" });
    await this.emit(hold.status === "held" ? "deposit.held" : "deposit.failed", hold);
    return { ...hold };
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    const r = await this.mutateHold(holdId, (h) => {
      if (h.status === "released") return h;
      if (h.status !== "held") throw new PaymentError(`Cannot release a ${h.status} deposit`, "invalid_state");
      return { ...h, status: "released" };
    });
    if (r.before.status !== r.after.status) await this.emit("deposit.released", r.after);
    return r.after;
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    const r = await this.mutateHold(holdId, (h) => {
      if (h.status !== "held") throw new PaymentError(`Cannot capture a ${h.status} deposit`, "invalid_state");
      const capture = amount ?? h.amount;
      validateAmount(capture);
      if (capture > h.amount) throw new PaymentError("Capture exceeds held amount", "amount_too_large");
      return { ...h, capturedAmount: capture, status: "captured" };
    });
    await this.emit("deposit.captured", r.after);
    return r.after;
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    if (!signatureHeader) throw new PaymentError("Missing webhook signature", "invalid_signature");
    const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=") as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || !parts.v1) {
      throw new PaymentError("Malformed webhook signature", "invalid_signature");
    }
    const ageSeconds = Math.abs(this.now().getTime() / 1000 - timestamp);
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      throw new PaymentError("Webhook signature expired", "invalid_signature");
    }
    const expected = Buffer.from(signFakeWebhook(rawBody, this.options.webhookSecret, timestamp).split("v1=")[1], "hex");
    const given = Buffer.from(parts.v1, "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new PaymentError("Invalid webhook signature", "invalid_signature");
    }
    return JSON.parse(rawBody) as PaymentEvent;
  }

  // --- Test helpers (not part of PaymentProvider) ---

  /** Events emitted by this provider instance, oldest first. */
  listEvents(): PaymentEvent[] {
    return [...this.events];
  }

  /** Every event in the store (shared by all instances / processes using it), oldest first. */
  listStoredEvents(): Promise<PaymentEvent[]> {
    return this.store.listEvents();
  }

  /** Deliver an already-sent event again, simulating a provider retry. */
  async resendEvent(eventId: string): Promise<void> {
    const event = this.events.find((e) => e.id === eventId) ?? (await this.store.getEvent(eventId));
    if (!event) throw new PaymentError(`No such event ${eventId}`, "not_found");
    await this.deliver(event);
  }

  private async emit(type: PaymentEventType, data: Payment | DepositHold) {
    const event: PaymentEvent = {
      id: `evt_fake_${randomUUID()}`,
      type,
      createdAt: this.now().toISOString(),
      data: { ...data },
    };
    this.events.push(event);
    await this.store.appendEvent(event);
    await this.deliver(event);
    if (this.options.duplicateWebhooks) await this.deliver(event);
  }

  private async deliver(event: PaymentEvent) {
    if (!this.options.deliver) return;
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(this.now().getTime() / 1000);
    await this.options.deliver(rawBody, signFakeWebhook(rawBody, this.options.webhookSecret, timestamp), event);
  }

  /** The object owning an idempotency key may still be being written by a concurrent call. */
  private async waitFor(id: string): Promise<FakeObject> {
    for (let i = 0; i < 100; i++) {
      const o = await this.store.get(id);
      if (o) {
        if (o.failureReason === REJECTED_METHOD) {
          throw new PaymentError("Payment method was rejected for this idempotency key", REJECTED_METHOD);
        }
        return o;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new PaymentError(`Idempotent request ${id} is still in progress`, "conflict");
  }

  private async mutatePayment(id: string, fn: (p: Payment) => Payment) {
    const r = await this.store.mutate(id, (o) => {
      if (o.kind !== "payment") throw new PaymentError(`No such payment ${id}`, "not_found");
      return { ...fn(strip<Payment>(o)), kind: "payment" };
    });
    if (!r) throw new PaymentError(`No such payment ${id}`, "not_found");
    return { before: strip<Payment>(r.before), after: strip<Payment>(r.after) };
  }

  private async mutateHold(id: string, fn: (h: DepositHold) => DepositHold) {
    const r = await this.store.mutate(id, (o) => {
      if (o.kind !== "hold") throw new PaymentError(`No such deposit hold ${id}`, "not_found");
      return { ...fn(strip<DepositHold>(o)), kind: "hold" };
    });
    if (!r) throw new PaymentError(`No such deposit hold ${id}`, "not_found");
    return { before: strip<DepositHold>(r.before), after: strip<DepositHold>(r.after) };
  }
}

/** Drop the store's `kind` tag. */
function strip<T extends Payment | DepositHold>(o: FakeObject): T {
  const copy: Record<string, unknown> = { ...o };
  delete copy.kind;
  return copy as unknown as T;
}

function validateAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new PaymentError("Amount must be a positive integer in minor units", "invalid_amount");
  }
}

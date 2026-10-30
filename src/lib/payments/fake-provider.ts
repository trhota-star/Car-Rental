import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private payments = new Map<string, Payment>();
  private holds = new Map<string, DepositHold>();
  private idempotency = new Map<string, Payment | DepositHold>();
  private events: PaymentEvent[] = [];
  private now: () => Date;

  constructor(private readonly options: FakePaymentProviderOptions) {
    if (!options.webhookSecret) throw new Error("FakePaymentProvider needs a webhookSecret");
    this.now = options.now ?? (() => new Date());
  }

  async createPayment(input: ChargeInput): Promise<Payment> {
    validateAmount(input.amount);
    const cached = this.fromIdempotency<Payment>("pay", input.idempotencyKey);
    if (cached) return cached;

    const payment: Payment = {
      id: `pay_fake_${randomUUID()}`,
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
        throw new PaymentError(`Unknown fake payment method "${input.paymentMethod}"`, "invalid_payment_method");
    }
    this.payments.set(payment.id, payment);
    this.remember("pay", input.idempotencyKey, payment);
    await this.emit(`payment.${payment.status}` as PaymentEventType, payment);
    return { ...payment };
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    const payment = this.getPayment(paymentId);
    if (payment.status === "canceled") return { ...payment };
    if (payment.status !== "pending") {
      throw new PaymentError(`Cannot cancel a ${payment.status} payment; refund it instead`, "invalid_state");
    }
    payment.status = "canceled";
    await this.emit("payment.canceled", payment);
    return { ...payment };
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    const payment = this.getPayment(paymentId);
    if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
      throw new PaymentError(`Cannot refund a ${payment.status} payment`, "invalid_state");
    }
    const remaining = payment.amount - payment.refundedAmount;
    const refund = amount ?? remaining;
    validateAmount(refund);
    if (refund > remaining) throw new PaymentError("Refund exceeds remaining amount", "amount_too_large");
    payment.refundedAmount += refund;
    payment.status = payment.refundedAmount === payment.amount ? "refunded" : "partially_refunded";
    await this.emit("payment.refunded", payment);
    return { ...payment };
  }

  async holdDeposit(input: ChargeInput): Promise<DepositHold> {
    validateAmount(input.amount);
    const cached = this.fromIdempotency<DepositHold>("hold", input.idempotencyKey);
    if (cached) return cached;

    const hold: DepositHold = {
      id: `hold_fake_${randomUUID()}`,
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
      throw new PaymentError(`Unsupported payment method for deposits "${input.paymentMethod}"`, "invalid_payment_method");
    }
    this.holds.set(hold.id, hold);
    this.remember("hold", input.idempotencyKey, hold);
    await this.emit(hold.status === "held" ? "deposit.held" : "deposit.failed", hold);
    return { ...hold };
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    const hold = this.getHold(holdId);
    if (hold.status === "released") return { ...hold };
    if (hold.status !== "held") throw new PaymentError(`Cannot release a ${hold.status} deposit`, "invalid_state");
    hold.status = "released";
    await this.emit("deposit.released", hold);
    return { ...hold };
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    const hold = this.getHold(holdId);
    if (hold.status !== "held") throw new PaymentError(`Cannot capture a ${hold.status} deposit`, "invalid_state");
    const capture = amount ?? hold.amount;
    validateAmount(capture);
    if (capture > hold.amount) throw new PaymentError("Capture exceeds held amount", "amount_too_large");
    hold.capturedAmount = capture;
    hold.status = "captured";
    await this.emit("deposit.captured", hold);
    return { ...hold };
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

  /** Every event emitted so far, oldest first. */
  listEvents(): PaymentEvent[] {
    return [...this.events];
  }

  /** Deliver an already-sent event again, simulating a provider retry. */
  async resendEvent(eventId: string): Promise<void> {
    const event = this.events.find((e) => e.id === eventId);
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
    await this.deliver(event);
    if (this.options.duplicateWebhooks) await this.deliver(event);
  }

  private async deliver(event: PaymentEvent) {
    if (!this.options.deliver) return;
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(this.now().getTime() / 1000);
    await this.options.deliver(rawBody, signFakeWebhook(rawBody, this.options.webhookSecret, timestamp), event);
  }

  private getPayment(id: string): Payment {
    const payment = this.payments.get(id);
    if (!payment) throw new PaymentError(`No such payment ${id}`, "not_found");
    return payment;
  }

  private getHold(id: string): DepositHold {
    const hold = this.holds.get(id);
    if (!hold) throw new PaymentError(`No such deposit hold ${id}`, "not_found");
    return hold;
  }

  private fromIdempotency<T extends Payment | DepositHold>(kind: string, key?: string): T | undefined {
    if (!key) return undefined;
    const hit = this.idempotency.get(`${kind}:${key}`);
    return hit ? ({ ...hit } as T) : undefined;
  }

  private remember(kind: string, key: string | undefined, value: Payment | DepositHold) {
    if (key) this.idempotency.set(`${kind}:${key}`, value);
  }
}

function validateAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new PaymentError("Amount must be a positive integer in minor units", "invalid_amount");
  }
}

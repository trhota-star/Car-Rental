// Stripe test-mode PaymentProvider (PAYMENT_PROVIDER=stripe).
// UNVERIFIED: written against the stripe@23 SDK types only; never run against Stripe (no account /
// test keys yet). Before relying on it: run the checkout with test cards, check the webhook event
// mapping below with `stripe listen`, and confirm refund events carry the PaymentIntent metadata.
//
// Mapping
//   payment  = PaymentIntent, automatic capture, confirmed server-side with a PaymentMethod id (pm_...).
//   deposit  = PaymentIntent with capture_method "manual" (authorisation hold); release = cancel,
//              capture = capture(amount_to_capture).
//   webhooks = Stripe events -> PaymentEvent (metadata.kind tells charge vs deposit).
import Stripe from "stripe";
import {
  PaymentError,
  type ChargeInput,
  type DepositHold,
  type Payment,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentProvider,
} from "./types";

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly signatureHeader = STRIPE_SIGNATURE_HEADER;
  private stripe: Stripe;

  constructor(private readonly opts: { secretKey: string; webhookSecret: string }) {
    if (!opts.secretKey.startsWith("sk_test_") && process.env.STRIPE_ALLOW_LIVE !== "1") {
      throw new Error("StripePaymentProvider only accepts test keys (sk_test_...) unless STRIPE_ALLOW_LIVE=1");
    }
    this.stripe = new Stripe(opts.secretKey, { maxNetworkRetries: 2 });
  }

  async createPayment(input: ChargeInput): Promise<Payment> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod,
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: input.metadata ?? {},
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      ),
    );
    return toPayment(pi);
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    return toPayment(await this.call(() => this.stripe.paymentIntents.cancel(paymentId)));
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    await this.call(() =>
      this.stripe.refunds.create({ payment_intent: paymentId, ...(amount !== undefined ? { amount } : {}) }),
    );
    const pi = await this.call(() => this.stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] }));
    return toPayment(pi);
  }

  async holdDeposit(input: ChargeInput): Promise<DepositHold> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod,
          capture_method: "manual",
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { ...(input.metadata ?? {}), kind: "deposit" },
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      ),
    );
    return toHold(pi);
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    return toHold(await this.call(() => this.stripe.paymentIntents.cancel(holdId)));
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    return toHold(
      await this.call(() =>
        this.stripe.paymentIntents.capture(holdId, amount !== undefined ? { amount_to_capture: amount } : {}),
      ),
    );
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    if (!signatureHeader) throw new PaymentError("Missing webhook signature", "invalid_signature");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.opts.webhookSecret);
    } catch (err) {
      throw new PaymentError(`Invalid webhook signature: ${(err as Error).message}`, "invalid_signature");
    }
    const mapped = mapEvent(event);
    if (!mapped) {
      // Unhandled event types are acknowledged but carry no reservation, so they are ignored.
      return { id: event.id, type: "payment.pending", createdAt: new Date(event.created * 1000).toISOString(), data: emptyPayment() };
    }
    return { id: event.id, createdAt: new Date(event.created * 1000).toISOString(), ...mapped };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        throw new PaymentError(err.message, "card_declined");
      }
      if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new PaymentError(err.message, err.code === "resource_missing" ? "not_found" : "invalid_request");
      }
      if (err instanceof Stripe.errors.StripeError) throw new PaymentError(err.message, "provider_error");
      throw err;
    }
  }
}

function emptyPayment(): Payment {
  return { id: "", amount: 0, currency: "aed", status: "pending", refundedAmount: 0, metadata: {}, createdAt: new Date().toISOString() };
}

function refundedOf(pi: Stripe.PaymentIntent): number {
  const ch = pi.latest_charge;
  return ch && typeof ch === "object" ? ch.amount_refunded : 0;
}

function toPayment(pi: Stripe.PaymentIntent): Payment {
  const refunded = refundedOf(pi);
  let status: Payment["status"];
  switch (pi.status) {
    case "succeeded":
      status = refunded === 0 ? "succeeded" : refunded >= pi.amount ? "refunded" : "partially_refunded";
      break;
    case "canceled":
      status = "canceled";
      break;
    case "requires_payment_method":
      status = pi.last_payment_error ? "failed" : "pending";
      break;
    default:
      status = "pending";
  }
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    refundedAmount: refunded,
    failureReason: pi.last_payment_error?.code ?? undefined,
    metadata: { ...pi.metadata },
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

function toHold(pi: Stripe.PaymentIntent): DepositHold {
  let status: DepositHold["status"];
  switch (pi.status) {
    case "requires_capture":
      status = "held";
      break;
    case "succeeded":
      status = "captured";
      break;
    case "canceled":
      status = "released";
      break;
    default:
      status = "failed";
  }
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    capturedAmount: pi.amount_received ?? 0,
    failureReason: pi.last_payment_error?.code ?? undefined,
    metadata: { ...pi.metadata },
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

function mapEvent(event: Stripe.Event): { type: PaymentEventType; data: Payment | DepositHold } | null {
  if (event.type.startsWith("payment_intent.")) {
    const pi = event.data.object as Stripe.PaymentIntent;
    const deposit = pi.metadata?.kind === "deposit" || pi.capture_method === "manual";
    switch (event.type) {
      case "payment_intent.succeeded":
        return deposit ? { type: "deposit.captured", data: toHold(pi) } : { type: "payment.succeeded", data: toPayment(pi) };
      case "payment_intent.amount_capturable_updated":
        return deposit ? { type: "deposit.held", data: toHold(pi) } : null;
      case "payment_intent.payment_failed":
        return deposit
          ? { type: "deposit.failed", data: { ...toHold(pi), status: "failed" } }
          : { type: "payment.failed", data: { ...toPayment(pi), status: "failed" } };
      case "payment_intent.canceled":
        return deposit ? { type: "deposit.released", data: toHold(pi) } : { type: "payment.canceled", data: toPayment(pi) };
      case "payment_intent.processing":
        return deposit ? null : { type: "payment.pending", data: toPayment(pi) };
      default:
        return null;
    }
  }
  if (event.type === "charge.refunded") {
    const ch = event.data.object as Stripe.Charge;
    const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
    if (!piId) return null;
    return {
      type: "payment.refunded",
      data: {
        id: piId,
        amount: ch.amount,
        currency: ch.currency,
        status: ch.amount_refunded >= ch.amount ? "refunded" : "partially_refunded",
        refundedAmount: ch.amount_refunded,
        // Charges copy no PaymentIntent metadata; the webhook handler falls back to the provider id.
        metadata: { ...ch.metadata },
        createdAt: new Date(ch.created * 1000).toISOString(),
      },
    };
  }
  return null;
}

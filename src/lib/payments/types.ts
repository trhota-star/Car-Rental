// Provider-neutral payment contract. App code depends only on this file,
// so the fake provider can be swapped for a real one via PAYMENT_PROVIDER.

/** Amounts are integers in the currency's minor unit (e.g. cents). */
export type Currency = string;

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "canceled"
  | "partially_refunded"
  | "refunded";

export interface Payment {
  id: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  refundedAmount: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export type DepositHoldStatus = "held" | "failed" | "released" | "captured";

export interface DepositHold {
  id: string;
  amount: number;
  currency: Currency;
  status: DepositHoldStatus;
  capturedAmount: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export type PaymentEventType =
  | "payment.pending"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.failed"
  | "deposit.released"
  | "deposit.captured";

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  createdAt: string;
  data: Payment | DepositHold;
}

export interface ChargeInput {
  amount: number;
  currency: Currency;
  /** Provider-specific payment method token. */
  paymentMethod: string;
  /** Same key + same provider returns the original result instead of charging twice. */
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  /** HTTP header carrying the webhook signature (e.g. "x-fake-signature", "stripe-signature"). */
  readonly signatureHeader?: string;
  createPayment(input: ChargeInput): Promise<Payment>;
  /** Cancel a payment that has not completed yet. */
  cancelPayment(paymentId: string): Promise<Payment>;
  /** Refund all (default) or part of a succeeded payment. */
  refundPayment(paymentId: string, amount?: number): Promise<Payment>;
  /** Authorise a security deposit without taking the money. */
  holdDeposit(input: ChargeInput): Promise<DepositHold>;
  /** Drop a deposit hold so the customer is never charged. */
  releaseDeposit(holdId: string): Promise<DepositHold>;
  /** Take all (default) or part of a held deposit, e.g. for damage. */
  captureDeposit(holdId: string, amount?: number): Promise<DepositHold>;
  /** Check a webhook's signature and parse it. Throws if invalid. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * Bundle-safe check. Next/Turbopack can load this module more than once (route vs server chunks), so
 * `instanceof PaymentError` may be false for a real PaymentError. Match on the shape instead.
 */
export function isPaymentError(err: unknown, code?: string): err is PaymentError {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "PaymentError" && typeof e.code === "string" && (code === undefined || e.code === code);
}

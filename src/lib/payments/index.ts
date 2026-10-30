import { z } from "zod";
import { pool } from "@/lib/db";
import { FakePaymentProvider, httpWebhookDeliver } from "./fake-provider";
import { MemoryFakeProviderStore, PgFakeProviderStore } from "./fake-store";
import { StripePaymentProvider } from "./stripe-provider";
import type { PaymentProvider } from "./types";

export * from "./types";

const settings = z.object({
  PAYMENT_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  FAKE_PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  FAKE_PAYMENT_WEBHOOK_URL: z.url().optional(),
  FAKE_PAYMENT_DUPLICATE_WEBHOOKS: z.stringbool().default(false),
  /** db (default) = durable state in the fake_payment_provider_* tables of DATABASE_URL; memory = lost on restart. */
  FAKE_PAYMENT_STORE: z.enum(["db", "memory"]).default("db"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export function createPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  const s = settings.parse(env);
  switch (s.PAYMENT_PROVIDER) {
    case "fake":
      if (!s.FAKE_PAYMENT_WEBHOOK_SECRET) throw new Error("FAKE_PAYMENT_WEBHOOK_SECRET is not set");
      return new FakePaymentProvider({
        webhookSecret: s.FAKE_PAYMENT_WEBHOOK_SECRET,
        deliver: s.FAKE_PAYMENT_WEBHOOK_URL ? httpWebhookDeliver(s.FAKE_PAYMENT_WEBHOOK_URL) : undefined,
        duplicateWebhooks: s.FAKE_PAYMENT_DUPLICATE_WEBHOOKS,
        // The pool connects lazily, so creating the store never opens a connection by itself.
        store: s.FAKE_PAYMENT_STORE === "db" ? new PgFakeProviderStore(pool) : new MemoryFakeProviderStore(),
      });
    case "stripe":
      // UNVERIFIED (no Stripe account yet): test-mode keys only.
      if (!s.STRIPE_SECRET_KEY || !s.STRIPE_WEBHOOK_SECRET) {
        throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set for PAYMENT_PROVIDER=stripe");
      }
      return new StripePaymentProvider({ secretKey: s.STRIPE_SECRET_KEY, webhookSecret: s.STRIPE_WEBHOOK_SECRET });
  }
}

// One provider per server process (survives dev hot reloads).
const globalForPayments = globalThis as unknown as { paymentProvider?: PaymentProvider };

export function getPaymentProvider(): PaymentProvider {
  globalForPayments.paymentProvider ??= createPaymentProvider();
  return globalForPayments.paymentProvider;
}

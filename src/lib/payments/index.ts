import { z } from "zod";
import { FakePaymentProvider, httpWebhookDeliver } from "./fake-provider";
import type { PaymentProvider } from "./types";

export * from "./types";

const settings = z.object({
  PAYMENT_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  FAKE_PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  FAKE_PAYMENT_WEBHOOK_URL: z.url().optional(),
  FAKE_PAYMENT_DUPLICATE_WEBHOOKS: z.stringbool().default(false),
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
      });
    case "stripe":
      throw new Error("PAYMENT_PROVIDER=stripe is not implemented yet");
  }
}

// One provider per server process (survives dev hot reloads).
const globalForPayments = globalThis as unknown as { paymentProvider?: PaymentProvider };

export function getPaymentProvider(): PaymentProvider {
  globalForPayments.paymentProvider ??= createPaymentProvider();
  return globalForPayments.paymentProvider;
}

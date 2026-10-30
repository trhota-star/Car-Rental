// Fire fake payment events at the running dev server (`pnpm dev` first).
//   pnpm payments:fake pay success|fail|cancel|pending [--duplicate]
//   pnpm payments:fake refund            pay, then refund
//   pnpm payments:fake hold success|fail [--duplicate]
//   pnpm payments:fake release           hold, then release
import { FAKE_PAYMENT_METHODS, FakePaymentProvider, httpWebhookDeliver } from "@/lib/payments/fake-provider";

const [action, scenario = "success", ...rest] = process.argv.slice(2);
const secret = process.env.FAKE_PAYMENT_WEBHOOK_SECRET;
const url = process.env.FAKE_PAYMENT_WEBHOOK_URL;
if (!secret || !url) throw new Error("FAKE_PAYMENT_WEBHOOK_SECRET and FAKE_PAYMENT_WEBHOOK_URL must be set");

const provider = new FakePaymentProvider({
  webhookSecret: secret,
  deliver: httpWebhookDeliver(url),
  duplicateWebhooks: rest.includes("--duplicate") || scenario === "--duplicate",
});
const method = FAKE_PAYMENT_METHODS[scenario as keyof typeof FAKE_PAYMENT_METHODS] ?? FAKE_PAYMENT_METHODS.success;
const charge = { amount: 5000, currency: "usd", paymentMethod: method };

switch (action) {
  case "pay":
    console.log(await provider.createPayment(charge));
    break;
  case "refund": {
    const p = await provider.createPayment({ ...charge, paymentMethod: FAKE_PAYMENT_METHODS.success });
    console.log(await provider.refundPayment(p.id));
    break;
  }
  case "hold":
    console.log(await provider.holdDeposit(charge));
    break;
  case "release": {
    const h = await provider.holdDeposit({ ...charge, paymentMethod: FAKE_PAYMENT_METHODS.success });
    console.log(await provider.releaseDeposit(h.id));
    break;
  }
  default:
    console.error("Usage: payments:fake <pay|refund|hold|release> [success|fail|cancel|pending] [--duplicate]");
    process.exit(1);
}
console.log(`Sent ${provider.listEvents().length} event(s) to ${url}`);

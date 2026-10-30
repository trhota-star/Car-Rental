import { log } from "@/lib/auth-log";
import { isServiceError } from "@/server/errors";
import { handlePaymentWebhookRequest } from "@/server/payments";

// Receives payment provider webhooks (fake provider locally, Stripe later).
// The service reads the raw body + the provider's signature header, verifies
// it and processes each event id only once.
export async function POST(request: Request) {
  try {
    return Response.json(await handlePaymentWebhookRequest(request));
  } catch (err) {
    if (isServiceError(err, "INVALID_SIGNATURE")) {
      log("warn", "webhook.invalid_signature", {});
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    log("error", "webhook.failed", { error: err });
    return Response.json({ error: "webhook processing failed" }, { status: 500 });
  }
}

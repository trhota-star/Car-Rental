import { log } from "@/lib/auth-log";
import { isServiceError } from "@/server/errors";
import { handlePaymentWebhook } from "@/server/payments";

// Receives payment provider webhooks (fake provider locally, real provider later).
// handlePaymentWebhook verifies the signature and processes each event id once.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-fake-signature") ?? request.headers.get("stripe-signature");
  try {
    const result = await handlePaymentWebhook(rawBody, signature);
    return Response.json(result);
  } catch (err) {
    if (isServiceError(err, "INVALID_SIGNATURE")) {
      log("warn", "webhook.invalid_signature", {});
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    log("error", "webhook.failed", { error: err });
    return Response.json({ error: "webhook processing failed" }, { status: 500 });
  }
}

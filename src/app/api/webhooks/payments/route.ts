import { getPaymentProvider, PaymentError } from "@/lib/payments";

// Receives payment webhooks (fake provider locally, real provider later).
// Providers may deliver the same event more than once: booking logic must
// process each event.id only once.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-fake-signature");
  try {
    const event = getPaymentProvider().verifyWebhook(rawBody, signature);
    return Response.json({ received: true, id: event.id, type: event.type });
  } catch (err) {
    if (err instanceof PaymentError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

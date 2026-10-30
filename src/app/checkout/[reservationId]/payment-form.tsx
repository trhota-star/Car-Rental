"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { formatMoney } from "@/components/format";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { payAction, type PayState } from "./actions";

const outcomes = [
  { value: "pm_fake_success", label: "Payment succeeds", hint: "The charge and the deposit hold both succeed." },
  { value: "pm_fake_fail", label: "Card declined", hint: "The charge is declined; you can try again." },
  { value: "pm_fake_cancel", label: "Customer cancels", hint: "You abandon the payment; you can try again." },
  { value: "pm_fake_pending", label: "Processing (async)", hint: "Payment stays pending until the provider's webhook arrives." },
];

export function PaymentForm({ reservationId, totalFils, depositFils, currency }: { reservationId: string; totalFils: number; depositFils: number; currency: string }) {
  const [state, action] = useActionState<PayState, FormData>(payAction, {});
  const router = useRouter();

  // While the provider is processing, poll the server for the webhook result.
  useEffect(() => {
    if (state.outcome !== "PROCESSING") return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [state.outcome, router]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs uppercase tracking-wide">Test mode</span>
          No real card is charged
        </p>
        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Test card outcome</legend>
          {outcomes.map((o, i) => (
            <label key={o.value} className="flex cursor-pointer gap-3 rounded-lg bg-white p-3 ring-1 ring-amber-200 has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
              <input type="radio" name="paymentMethod" value={o.value} defaultChecked={i === 0} className="mt-0.5 accent-brand-600" />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {state.outcome === "PROCESSING" && (
        <Alert tone="info" title="Payment processing">
          {state.message ?? "We're waiting for confirmation from the payment provider. This page updates automatically."}
        </Alert>
      )}
      {state.outcome && state.outcome !== "PROCESSING" && (
        <Alert tone="error" title={state.outcome === "DEPOSIT_FAILED" ? "Deposit hold failed" : "Payment not completed"}>
          {state.message} You can choose another option and try again.
        </Alert>
      )}

      <SubmitButton size="lg" className="w-full" pendingLabel="Processing payment…">
        Pay {formatMoney(totalFils, currency)} and hold {formatMoney(depositFils, currency)} deposit
      </SubmitButton>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { formatMoney } from "@/components/format";
import { Alert, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelAction, changeDatesAction, type CancelState, type ChangeState } from "./actions";

export function CancelForm({ reservationId, feeFils, refundFils, free }: { reservationId: string; feeFils: number; refundFils: number; free: boolean }) {
  const [state, action] = useActionState<CancelState, FormData>(cancelAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <Alert tone={free ? "info" : "warning"} title={free ? "Free cancellation" : "Cancellation fee applies"}>
        {free ? (
          <>You&apos;ll get a full refund of {formatMoney(refundFils)}.</>
        ) : (
          <>
            We keep {formatMoney(feeFils)} (one day&apos;s rental incl. VAT) and refund {formatMoney(refundFils)}.
          </>
        )}{" "}
        Your security deposit hold is released.
      </Alert>
      <Field id="reason" label="Reason (optional)">
        <Textarea id="reason" name="reason" rows={2} maxLength={500} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="size-4 accent-red-600" />I understand and want to cancel this booking
      </label>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton variant="danger" pendingLabel="Cancelling…">
        Cancel reservation
      </SubmitButton>
    </form>
  );
}

export function ConfirmChangeForm({
  reservationId,
  window,
  amountDueFils,
  refundFils,
}: {
  reservationId: string;
  window: { pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };
  amountDueFils: number;
  refundFils: number;
}) {
  const [state, action] = useActionState<ChangeState, FormData>(changeDatesAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      {Object.entries(window).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {amountDueFils > 0 && (
        <fieldset className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-900">Test mode payment</legend>
          <p className="mb-2 text-sm">Pay the difference of {formatMoney(amountDueFils)}:</p>
          {[
            ["pm_fake_success", "Payment succeeds"],
            ["pm_fake_fail", "Card declined"],
            ["pm_fake_cancel", "Customer cancels"],
          ].map(([value, label], i) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="paymentMethod" value={value} defaultChecked={i === 0} className="accent-brand-600" />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton pendingLabel="Updating…">
        {amountDueFils > 0
          ? `Pay ${formatMoney(amountDueFils)} and change dates`
          : refundFils > 0
            ? `Change dates and refund ${formatMoney(refundFils)}`
            : "Confirm new dates"}
      </SubmitButton>
    </form>
  );
}

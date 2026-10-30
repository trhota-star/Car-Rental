"use client";

import { useActionState } from "react";
import { Alert, Field, Input, fieldAria } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { createReservationAction, type CheckoutState } from "./actions";

export interface DriverDefaults {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiry: string;
  hasLicenceOnFile: boolean;
}

export function DriverForm({
  hidden,
  extras,
  defaults,
}: {
  hidden: Record<string, string>;
  extras: string[];
  defaults: DriverDefaults;
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(createReservationAction, {});
  const fe = state.fieldErrors ?? {};
  const v = { ...defaults, ...state.values };

  return (
    <form action={action} className="space-y-6">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {extras.map((code) => (
        <input key={code} type="hidden" name="extra" value={code} />
      ))}

      {state.error && <Alert tone="error">{state.error}</Alert>}

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Main driver</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="fullName" label="Full name (as on licence)" error={fe.fullName}>
            <Input {...fieldAria("fullName", fe.fullName)} name="fullName" autoComplete="name" defaultValue={v.fullName} required />
          </Field>
          <Field id="driverEmail" label="Driver email" error={fe.email}>
            <Input {...fieldAria("driverEmail", fe.email)} name="email" type="email" autoComplete="email" defaultValue={v.email} required />
          </Field>
          <Field id="phone" label="Mobile phone" error={fe.phone}>
            <Input {...fieldAria("phone", fe.phone)} name="phone" type="tel" autoComplete="tel" placeholder="+971 50 123 4567" defaultValue={v.phone} required />
          </Field>
          <Field id="dateOfBirth" label="Date of birth" hint="Drivers must be 21 or older at pick-up." error={fe.dateOfBirth}>
            <Input {...fieldAria("dateOfBirth", fe.dateOfBirth, true)} name="dateOfBirth" type="date" autoComplete="bday" defaultValue={v.dateOfBirth} required />
          </Field>
          <Field id="nationality" label="Nationality (optional)" error={fe.nationality}>
            <Input {...fieldAria("nationality", fe.nationality)} name="nationality" defaultValue={v.nationality} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Driving licence</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="licenceNumber" label="Licence number" error={fe.licenceNumber}>
            <Input {...fieldAria("licenceNumber", fe.licenceNumber)} name="licenceNumber" defaultValue={v.licenceNumber} required />
          </Field>
          <Field id="licenceCountry" label="Issuing country" hint="2-letter code, e.g. AE" error={fe.licenceCountry}>
            <Input
              {...fieldAria("licenceCountry", fe.licenceCountry, true)}
              name="licenceCountry"
              maxLength={2}
              className="uppercase"
              defaultValue={v.licenceCountry}
              required
            />
          </Field>
          <Field id="licenceExpiry" label="Expiry date" hint="Must be valid through the return date." error={fe.licenceExpiry}>
            <Input {...fieldAria("licenceExpiry", fe.licenceExpiry, true)} name="licenceExpiry" type="date" defaultValue={v.licenceExpiry} required />
          </Field>
        </div>
        <Field
          id="licenceFile"
          label="Licence photo or scan"
          hint="JPG, PNG, WebP or PDF, max 5 MB. Stored privately; only you and DriveEasy staff can view it."
          error={fe.licenceFile}
        >
          <Input
            {...fieldAria("licenceFile", fe.licenceFile, true)}
            name="licenceFile"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required={!defaults.hasLicenceOnFile}
          />
        </Field>
        {defaults.hasLicenceOnFile && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="useLicenceOnFile" defaultChecked className="size-4 accent-brand-600" />
            Use the licence already on file if I don&apos;t upload a new one
          </label>
        )}
      </fieldset>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" required className="mt-0.5 size-4 accent-brand-600" aria-describedby={fe.terms ? "terms-error" : undefined} />
          <span>
            I accept the rental terms: free cancellation more than 48 hours before pick-up, otherwise one day&apos;s rental is kept.
            The security deposit is held on my card and released after return.
          </span>
        </label>
        {fe.terms && (
          <p id="terms-error" className="text-xs font-medium text-red-600">
            {fe.terms[0]}
          </p>
        )}
      </div>

      <SubmitButton size="lg" className="w-full" pendingLabel="Reserving your car…">
        Reserve and continue to payment
      </SubmitButton>
    </form>
  );
}

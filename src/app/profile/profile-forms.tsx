"use client";

import { useActionState } from "react";
import { Alert, Field, Input, fieldAria } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePasswordAction, updateProfileAction, type ProfileFormState } from "./actions";

export function ProfileForm({ name, email, phone }: { name: string; email: string; phone: string | null }) {
  const [state, action] = useActionState<ProfileFormState, FormData>(updateProfileAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok && <Alert tone="success">Profile saved.</Alert>}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field id="name" label="Full name" error={fe.name}>
        <Input {...fieldAria("name", fe.name)} name="name" autoComplete="name" defaultValue={name} required />
      </Field>
      <Field id="email" label="Email" hint="Contact support to change your email address.">
        <Input {...fieldAria("email", undefined, true)} value={email} readOnly disabled />
      </Field>
      <Field id="phone" label="Phone" hint="Used by the branch if they need to reach you." error={fe.phone}>
        <Input
          {...fieldAria("phone", fe.phone, true)}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+971 50 123 4567"
          defaultValue={phone ?? ""}
        />
      </Field>
      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<ProfileFormState, FormData>(changePasswordAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok && <Alert tone="success">Password changed. Other devices were signed out.</Alert>}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field id="currentPassword" label="Current password" error={fe.currentPassword}>
        <Input
          {...fieldAria("currentPassword", fe.currentPassword)}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field id="newPassword" label="New password" hint="At least 8 characters." error={fe.newPassword}>
        <Input
          {...fieldAria("newPassword", fe.newPassword, true)}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field id="confirmNewPassword" label="Confirm new password" error={fe.confirmPassword}>
        <Input
          {...fieldAria("confirmNewPassword", fe.confirmPassword)}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <SubmitButton variant="outline" pendingLabel="Changing…">
        Change password
      </SubmitButton>
    </form>
  );
}

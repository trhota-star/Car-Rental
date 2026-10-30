"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, Input, fieldAria } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction, signUpAction, type AuthFormState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(signInAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field id="email" label="Email" error={fe.email}>
        <Input
          {...fieldAria("email", fe.email)}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </Field>
      <Field id="password" label="Password" error={fe.password}>
        <Input {...fieldAria("password", fe.password)} name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        New to DriveEasy?{" "}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(signUpAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field id="name" label="Full name" error={fe.name}>
        <Input {...fieldAria("name", fe.name)} name="name" autoComplete="name" required defaultValue={state.values?.name} />
      </Field>
      <Field id="email" label="Email" error={fe.email}>
        <Input
          {...fieldAria("email", fe.email)}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </Field>
      <Field id="password" label="Password" hint="At least 8 characters." error={fe.password}>
        <Input
          {...fieldAria("password", fe.password, true)}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={fe.confirmPassword}>
        <Input
          {...fieldAria("confirmPassword", fe.confirmPassword)}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

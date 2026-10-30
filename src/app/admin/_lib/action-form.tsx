"use client";

import { useActionState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonVariant } from "@/components/ui/button";
import type { AdminState } from "./state";

/** Generic admin form: runs a Server Action and shows its result. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant,
  className,
}: {
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [state, formAction] = useActionState<AdminState, FormData>(action, {});
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      {state.error && (
        <Alert tone="error">
          {state.error}
          {state.issues && state.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {state.ok && <Alert tone="success">{state.ok}</Alert>}
      <div>
        <SubmitButton variant={variant} pendingLabel={pendingLabel ?? "Saving…"}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

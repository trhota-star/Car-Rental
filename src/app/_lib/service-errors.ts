import "server-only";
import { isServiceError, type ErrorCode } from "@/server/errors";
import { log } from "@/lib/auth-log";

// Partial so a new code from db never breaks the build; unknown codes fall back to the service message.
const friendly: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: "Please check the details you entered.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  FORBIDDEN: "You don't have access to this.",
  VEHICLE_UNAVAILABLE: "Sorry, this car is no longer available for those dates. Please choose other dates or another car.",
  BRANCH_CLOSED: "The branch is closed at the selected time. Please pick a time within opening hours.",
  NO_PRICE: "This car can't be booked for the selected dates.",
  INVALID_STATE: "This action isn't possible for this reservation any more.",
  HOLD_EXPIRED: "Your reservation hold expired before payment. Please start a new booking.",
  PAYMENT_FAILED: "Your payment was not completed.",
  PAYMENT_PROVIDER_ERROR: "The payment service is unavailable. Please try again shortly.",
  CONFLICT: "This was changed by someone else. Please reload and try again.",
};

export interface ActionError {
  code: ErrorCode | "UNEXPECTED";
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Turn a thrown error into a message for the UI. ServiceErrors keep their
 * (user-safe) message when it is more specific; anything else is logged and
 * shown as a generic failure.
 */
export function toActionError(err: unknown, context: string, fields: Record<string, unknown> = {}): ActionError {
  if (isServiceError(err)) {
    log("warn", `${context}.service_error`, { code: err.code, message: err.message, ...fields });
    const fieldErrors: Record<string, string[]> = {};
    const issues = (err.details?.issues ?? []) as Array<{ path: string; message: string }>;
    for (const i of issues) (fieldErrors[i.path || "_"] ??= []).push(i.message);
    const specific = ["VALIDATION_ERROR", "BRANCH_CLOSED", "PAYMENT_FAILED", "INVALID_STATE", "NO_PRICE"].includes(err.code);
    return {
      code: err.code,
      message: (specific && err.message) || friendly[err.code] || err.message || "Something went wrong.",
      fieldErrors: issues.length ? fieldErrors : undefined,
    };
  }
  log("error", `${context}.unexpected_error`, { error: err, ...fields });
  return { code: "UNEXPECTED", message: "Something went wrong on our side. Please try again." };
}

export { isServiceError };

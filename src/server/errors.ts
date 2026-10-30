import type { z } from "zod";

/** Every error a service throws on purpose. `code` is stable; app maps it to UI states. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "FORBIDDEN",
  "VEHICLE_UNAVAILABLE",
  "BRANCH_CLOSED",
  "NO_PRICE",
  "INVALID_STATE",
  "HOLD_EXPIRED",
  "PAYMENT_FAILED",
  "PAYMENT_PROVIDER_ERROR",
  "INVALID_SIGNATURE",
  "CONFLICT",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function isServiceError(err: unknown, code?: ErrorCode): err is ServiceError {
  // Shape check, not instanceof: bundlers may load this module twice (see isPaymentError).
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return (
    e.name === "ServiceError" &&
    typeof e.code === "string" &&
    (ERROR_CODES as readonly string[]).includes(e.code) &&
    (code === undefined || e.code === code)
  );
}

/** Parse service input with Zod; invalid input becomes ServiceError("VALIDATION_ERROR"). */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ServiceError("VALIDATION_ERROR", "Invalid input", {
      issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}

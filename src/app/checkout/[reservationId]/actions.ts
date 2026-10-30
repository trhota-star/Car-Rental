"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/auth-log";
import { getCurrentUser } from "@/lib/auth-session";
import { payReservation } from "@/server/payments";
import { toActionError } from "../../_lib/service-errors";

export interface PayState {
  outcome?: "PROCESSING" | "PAYMENT_FAILED" | "DEPOSIT_FAILED" | "ERROR";
  message?: string;
}

const TEST_METHODS = ["pm_fake_success", "pm_fake_fail", "pm_fake_cancel", "pm_fake_pending"] as const;

const input = z.object({
  reservationId: z.uuid(),
  paymentMethod: z.enum(TEST_METHODS, "Choose a test payment outcome"),
});

export async function payAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { outcome: "ERROR", message: parsed.error.issues[0]?.message ?? "Invalid payment details" };
  if ((process.env.PAYMENT_PROVIDER ?? "fake") !== "fake") {
    return { outcome: "ERROR", message: "Test payment methods are only accepted in local test mode." };
  }

  const { reservationId, paymentMethod } = parsed.data;
  let result;
  try {
    result = await payReservation({ reservationId, userId: user.id, paymentMethod });
  } catch (err) {
    const e = toActionError(err, "checkout.pay", { reservationId, userId: user.id });
    return { outcome: "ERROR", message: e.message };
  }

  log("info", "checkout.pay_result", { reservationId, userId: user.id, outcome: result.outcome, status: result.status });
  if (result.outcome === "CONFIRMED") redirect(`/reservations/${reservationId}/voucher?new=1`);
  if (result.outcome === "PROCESSING") return { outcome: "PROCESSING", message: result.message };
  return {
    outcome: result.outcome,
    message:
      result.message ??
      (result.outcome === "DEPOSIT_FAILED"
        ? "We couldn't hold the security deposit on this card. Your rental payment was not kept."
        : "Your payment was declined."),
  };
}

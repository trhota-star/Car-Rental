"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/auth-log";
import { getCurrentUser } from "@/lib/auth-session";
import { cancelReservation, changeReservationDates } from "@/server/changes";
import { getReservationForUser } from "@/server/reservations";
import { zonedToUtc } from "@/components/zoned-time";
import { toActionError } from "../../_lib/service-errors";

export interface CancelState {
  error?: string;
}

export async function cancelAction(_prev: CancelState, formData: FormData): Promise<CancelState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = z
    .object({ reservationId: z.uuid(), reason: z.string().trim().max(500).optional(), confirm: z.literal("on", "Tick the box to confirm") })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid request" };

  try {
    const res = await cancelReservation({ reservationId: p.data.reservationId, userId: user.id, reason: p.data.reason || undefined });
    log("info", "reservation.cancel_ui", {
      reservationId: p.data.reservationId,
      userId: user.id,
      feeFils: res.feeFils,
      refundFils: res.refundFils,
      refundedNowFils: res.settlement.refundedFils,
      depositsReleased: res.settlement.depositsReleased,
    });
  } catch (err) {
    return { error: toActionError(err, "reservation.cancel", { reservationId: p.data.reservationId, userId: user.id }).message };
  }
  revalidatePath("/reservations");
  redirect(`/reservations/${p.data.reservationId}?cancelled=1`);
}

export interface ChangeState {
  error?: string;
}

const changeInput = z.object({
  reservationId: z.uuid(),
  pickupDate: z.string(),
  pickupTime: z.string(),
  returnDate: z.string(),
  returnTime: z.string(),
  paymentMethod: z.enum(["pm_fake_success", "pm_fake_fail", "pm_fake_cancel"]).optional(),
});

export async function changeDatesAction(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = changeInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Please choose valid dates." };
  const d = await getReservationForUser(p.data.reservationId, user.id);
  if (!d) return { error: "Reservation not found." };

  const pickupAt = zonedToUtc(p.data.pickupDate, p.data.pickupTime, d.pickupBranch.timeZone);
  const returnAt = zonedToUtc(p.data.returnDate, p.data.returnTime, d.returnBranch.timeZone);
  if (!pickupAt || !returnAt) return { error: "Please choose valid dates." };

  try {
    await changeReservationDates({
      reservationId: d.reservation.id,
      userId: user.id,
      pickupAt,
      returnAt,
      paymentMethod: p.data.paymentMethod,
    });
  } catch (err) {
    return { error: toActionError(err, "reservation.change_dates", { reservationId: d.reservation.id, userId: user.id }).message };
  }
  log("info", "reservation.dates_changed_ui", { reservationId: d.reservation.id, userId: user.id });
  revalidatePath("/reservations");
  redirect(`/reservations/${d.reservation.id}?changed=1`);
}

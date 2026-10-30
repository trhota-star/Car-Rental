"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/auth-log";
import { getCurrentUser } from "@/lib/auth-session";
import { getVehicle } from "@/server/availability";
import { listBranches, listExtras } from "@/server/catalog";
import { getDriverProfile, uploadLicence } from "@/server/files";
import { createReservation } from "@/server/reservations";
import { readExtras } from "../book/extras-params";
import { toActionError } from "../_lib/service-errors";
import { readSearchForm, resolveSearch } from "../search/criteria";

export interface CheckoutState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echo of the submitted text fields so the form keeps them after an error. */
  values?: Record<string, string>;
}

const driverForm = z.object({
  fullName: z.string().trim().min(2, "Enter the driver's full name").max(120),
  email: z.email("Enter a valid email address").max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number, e.g. +971 50 123 4567"),
  dateOfBirth: z.iso.date("Enter the date of birth"),
  nationality: z.string().trim().max(60).optional(),
  licenceNumber: z.string().trim().min(3, "Enter the licence number").max(40),
  licenceCountry: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use the 2-letter country code, e.g. AE"),
  licenceExpiry: z.iso.date("Enter the licence expiry date"),
  idempotencyKey: z.string().min(8).max(200),
  vehicle: z.uuid(),
  terms: z.literal("on", "Please accept the rental terms"),
});

/** Map service validation paths (driver.fullName) to form field names (fullName). */
function mapIssues(fieldErrors?: Record<string, string[]>): Record<string, string[]> | undefined {
  if (!fieldErrors) return undefined;
  return Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k.replace(/^driver\./, ""), v]));
}

export async function createReservationAction(prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const result = await createReservationInner(formData);
  return { ...result, values: driverValues(formData) };
}

const DRIVER_FIELDS = ["fullName", "email", "phone", "dateOfBirth", "nationality", "licenceNumber", "licenceCountry", "licenceExpiry"];
function driverValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(DRIVER_FIELDS.map((k) => [k, String(formData.get(k) ?? "")]));
}

async function createReservationInner(formData: FormData): Promise<CheckoutState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/checkout");

  const entries = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = driverForm.safeParse(entries);
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const f = parsed.data;

  // Rebuild the rental from the submitted window: never trust client prices.
  const data = await getVehicle(f.vehicle);
  if (!data) return { error: "This car is no longer available." };
  const [active, extras] = await Promise.all([listBranches(), listExtras()]);
  const branches = active.some((b) => b.id === data.branch.id) ? active : [data.branch, ...active];
  const sp: Record<string, string | string[]> = { ...entries, pickup: data.branch.code, extra: formData.getAll("extra").map(String) };
  const window = resolveSearch(readSearchForm(sp, branches), branches, []);
  if (!window.ok) return { error: "Your rental dates are invalid. Please go back and choose them again." };
  const chosen = readExtras(sp, extras);

  // Licence: a new upload, or the one already on the driver's profile.
  let licenceFileKey: string | undefined;
  const file = formData.get("licenceFile");
  if (file instanceof File && file.size > 0) {
    try {
      const up = await uploadLicence({
        userId: user.id,
        data: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
        filename: file.name,
      });
      licenceFileKey = up.key;
    } catch (err) {
      const e = toActionError(err, "checkout.licence_upload", { userId: user.id });
      return { error: e.message, fieldErrors: { licenceFile: [e.message] } };
    }
  } else if (formData.get("useLicenceOnFile") === "on") {
    licenceFileKey = (await getDriverProfile(user.id))?.licenceFileKey ?? undefined;
  }
  if (!licenceFileKey) {
    return { error: "Please upload a photo or scan of the driving licence.", fieldErrors: { licenceFile: ["Upload the driving licence (JPG, PNG, WebP or PDF, max 5 MB)"] } };
  }

  let reservationId: string;
  try {
    const res = await createReservation({
      userId: user.id,
      idempotencyKey: f.idempotencyKey,
      vehicleId: data.vehicle.id,
      pickupBranchId: window.pickupBranch.id,
      returnBranchId: window.returnBranch.id,
      pickupAt: window.pickupAt,
      returnAt: window.returnAt,
      extras: chosen.map((c) => ({ extraId: c.extra.id, quantity: c.quantity })),
      driver: {
        fullName: f.fullName,
        email: f.email,
        phone: f.phone,
        dateOfBirth: f.dateOfBirth,
        nationality: f.nationality || undefined,
        licenceNumber: f.licenceNumber,
        licenceCountry: f.licenceCountry.toUpperCase(),
        licenceExpiry: f.licenceExpiry,
        licenceFileKey,
      },
    });
    reservationId = res.reservationId;
    log("info", "checkout.reservation_created", { userId: user.id, reservationId, replayed: res.replayed });
  } catch (err) {
    const e = toActionError(err, "checkout.create", { userId: user.id, vehicleId: data.vehicle.id });
    return { error: e.message, fieldErrors: mapIssues(e.fieldErrors) };
  }
  redirect(`/checkout/${reservationId}`);
}

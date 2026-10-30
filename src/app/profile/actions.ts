"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { log } from "@/lib/auth-log";
import { getCurrentUser } from "@/lib/auth-session";

export interface ProfileFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100, "Name is too long"),
  phone: z
    .string()
    .trim()
    .max(20, "Phone number is too long")
    .regex(/^$|^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number, e.g. +971 50 123 4567"),
});

export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  await auth.api.updateUser({
    body: { name: parsed.data.name, phone: parsed.data.phone || null },
    headers: await headers(),
  });
  log("info", "profile.updated", { userId: user.id });
  revalidatePath("/profile");
  return { ok: true };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export async function changePasswordAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError) {
      log("warn", "profile.password_change_failed", { userId: user.id, status: err.status });
      return { fieldErrors: { currentPassword: ["Current password is incorrect"] } };
    }
    throw err;
  }
  log("info", "profile.password_changed", { userId: user.id });
  return { ok: true };
}

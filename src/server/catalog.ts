import "server-only";
import { asc, eq } from "drizzle-orm";
import { branches, extras, vehicleCategories, vehicleFeatures } from "@/lib/db/schema";
import { db } from "./db";

/** Active branches, by name. */
export async function listBranches() {
  return db.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name));
}

export async function getBranchByCode(code: string) {
  const [b] = await db.select().from(branches).where(eq(branches.code, code.toUpperCase()));
  return b ?? null;
}

export async function getBranch(id: string) {
  const [b] = await db.select().from(branches).where(eq(branches.id, id));
  return b ?? null;
}

export async function listCategories() {
  return db.select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

/** Active extras customers can add at checkout. */
export async function listExtras() {
  return db.select().from(extras).where(eq(extras.isActive, true)).orderBy(asc(extras.name));
}

export async function listFeatures() {
  return db.select().from(vehicleFeatures).orderBy(asc(vehicleFeatures.name));
}

// Test data factories (direct inserts into the TEST database through the app's Drizzle client).
// Every factory returns the inserted row; pass overrides for anything you care about.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

let seq = 0;
const next = () => `${Date.now().toString(36)}${(++seq).toString(36)}`.toUpperCase();
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const vin = () => Array.from({ length: 17 }, () => VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)]).join("");

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
/** A future UTC instant: `days` from now at hourUtc (default 08:00Z = 12:00 Dubai). */
export function futureAt(days: number, hourUtc = 8): Date {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

export async function createUser(o: Partial<typeof s.users.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(s.users)
    .values({ name: `QA User ${n}`, email: `qa-${n.toLowerCase()}@example.test`, role: "CUSTOMER", ...o })
    .returning();
  return row;
}
export const createAdmin = (o: Partial<typeof s.users.$inferInsert> = {}) => createUser({ role: "ADMIN", ...o });

export async function createBranch(o: Partial<typeof s.branches.$inferInsert> = {}) {
  const n = next().slice(-8);
  const [row] = await db
    .insert(s.branches)
    .values({ code: `B${n}`, name: `Branch ${n}`, city: "Dubai", emirate: "Dubai", address: "1 Test St", ...o })
    .returning();
  return row;
}

export async function createCategory(o: Partial<typeof s.vehicleCategories.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(s.vehicleCategories)
    .values({ code: `CAT-${n}`, name: `Category ${n}`, securityDepositFils: 100_000, ...o })
    .returning();
  return row;
}

export async function createPricingRule(o: Partial<typeof s.pricingRules.$inferInsert> = {}) {
  const [row] = await db
    .insert(s.pricingRules)
    .values({ name: `Rule ${next()}`, dailyRateFils: 15_000, ...o })
    .returning();
  return row;
}

export async function createVehicle(o: Partial<typeof s.vehicles.$inferInsert> & { dailyRateFils?: number } = {}) {
  const { dailyRateFils, ...rest } = o;
  const branchId = rest.branchId ?? (await createBranch()).id;
  const categoryId = rest.categoryId ?? (await createCategory()).id;
  const [row] = await db
    .insert(s.vehicles)
    .values({
      branchId,
      categoryId,
      plateNumber: `DXB-${next()}`,
      vin: vin(),
      make: "Toyota",
      model: "Corolla",
      year: 2025,
      transmission: "AUTOMATIC",
      fuelType: "PETROL",
      seats: 5,
      ...rest,
    })
    .returning();
  if (dailyRateFils) await createPricingRule({ vehicleId: row.id, dailyRateFils });
  return row;
}

export async function createExtra(o: Partial<typeof s.extras.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(s.extras)
    .values({ code: `EX-${n}`, name: `Extra ${n}`, pricing: "PER_DAY", priceFils: 2_500, ...o })
    .returning();
  return row;
}

/** Raw reservation insert (bypasses services). Prices default to a self-consistent snapshot. */
export async function createReservation(
  o: Partial<typeof s.reservations.$inferInsert> & { vehicleId: string; userId?: string },
) {
  const vehicle = (await db.query.vehicles.findFirst({ where: (v, { eq }) => eq(v.id, o.vehicleId) }))!;
  const userId = o.userId ?? (await createUser()).id;
  const pickupAt = o.pickupAt ?? futureAt(10);
  const returnAt = o.returnAt ?? new Date(pickupAt.getTime() + 2 * DAY);
  const days = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / DAY));
  const rate = 15_000;
  const base = rate * days;
  const vat = Math.round(base * 0.05);
  const status = o.status ?? "CONFIRMED";
  const [row] = await db
    .insert(s.reservations)
    .values({
      reference: `DE-${next()}`,
      userId,
      pickupBranchId: vehicle.branchId,
      returnBranchId: vehicle.branchId,
      pickupAt,
      returnAt,
      status,
      holdExpiresAt: status === "PENDING" ? new Date(Date.now() + 15 * 60 * 1000) : null,
      idempotencyKey: randomUUID(),
      driverName: "QA Driver",
      driverEmail: "driver@example.test",
      driverPhone: "+971500000000",
      rentalDays: days,
      dailyRateFils: rate,
      baseFils: base,
      subtotalFils: base,
      vatRateBp: 500,
      vatFils: vat,
      totalFils: base + vat,
      ...o,
    })
    .returning();
  return row;
}

export async function createMaintenanceBlock(
  o: Partial<typeof s.maintenanceBlocks.$inferInsert> & { vehicleId: string; startsAt: Date; endsAt: Date },
) {
  const createdById = o.createdById ?? (await createAdmin()).id;
  const [row] = await db.insert(s.maintenanceBlocks).values({ reason: "Service", createdById, ...o }).returning();
  return row;
}

/** Branch + category + vehicle (with a vehicle pricing rule) + customer: the usual starting point. */
export async function createWorld(o: { dailyRateFils?: number; depositFils?: number; vatRateBp?: number } = {}) {
  const branch = await createBranch({ vatRateBp: o.vatRateBp ?? 500 });
  const category = await createCategory({ securityDepositFils: o.depositFils ?? 100_000 });
  const vehicle = await createVehicle({
    branchId: branch.id,
    categoryId: category.id,
    dailyRateFils: o.dailyRateFils ?? 15_000,
  });
  const customer = await createUser();
  return { branch, category, vehicle, customer };
}
export type World = Awaited<ReturnType<typeof createWorld>>;

import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  branches,
  extras,
  fuelType,
  pricingRules,
  reservations,
  transmission,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
  vehicleStatus,
  extraPricing,
} from "@/lib/db/schema";
import { writeAudit } from "../audit";
import { assertAdmin, db, pgError, PG_UNIQUE_VIOLATION, type Tx } from "../db";
import { parseInput, ServiceError } from "../errors";
import { log } from "../log";

// Admin catalogue: branches, categories, fleet (+features), extras, pricing rules.
// Every function takes the acting user's id first, checks ADMIN, validates with Zod,
// and writes an audit_logs row in the same transaction as the change.

const fils = z.number().int().min(0).max(100_000_000);
const uuid = z.uuid();

function mapUnique(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === PG_UNIQUE_VIOLATION) {
    throw new ServiceError("CONFLICT", "A record with the same unique value already exists", { constraint: pg.constraint });
  }
  if (pg?.code === "23503") throw new ServiceError("INVALID_STATE", "Record is still referenced", { constraint: pg.constraint });
  if (pg?.code === "23514") throw new ServiceError("VALIDATION_ERROR", "Value violates a rule", { constraint: pg.constraint });
  throw err;
}

async function adminTx<T>(actorUserId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  parseInput(uuid, actorUserId);
  try {
    return await db.transaction(async (tx) => {
      await assertAdmin(tx, actorUserId);
      return fn(tx);
    });
  } catch (err) {
    mapUnique(err);
  }
}

/** Like .partial(), but without applying field defaults (a patch must not reset omitted fields). */
function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): ReturnType<z.ZodObject<S>["partial"]> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    const inner = v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType);
    shape[k] = inner.optional();
  }
  return z.object(shape) as unknown as ReturnType<z.ZodObject<S>["partial"]>;
}

function changed<T extends Record<string, unknown>>(patch: T) {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const branchFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  emirate: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(300),
  phone: z.string().trim().max(30).nullish(),
  timeZone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA time zone")
    .default("Asia/Dubai"),
  opensAtMinute: z.number().int().min(0).max(1439).default(0),
  closesAtMinute: z.number().int().min(1).max(1440).default(1440),
  vatRateBp: z.number().int().min(0).max(10000).default(500),
  oneWayFeeFils: fils.default(0),
  isActive: z.boolean().default(true),
});

export async function listAllBranches(actorUserId: string) {
  return adminTx(actorUserId, (tx) => tx.select().from(branches).orderBy(asc(branches.name)));
}

export async function createBranch(actorUserId: string, input: z.input<typeof branchFields>) {
  const i = parseInput(branchFields, input);
  return adminTx(actorUserId, async (tx) => {
    const [b] = await tx.insert(branches).values(i).returning();
    await writeAudit(tx, { actorUserId, action: "branch.created", entityType: "branch", entityId: b.id, data: i });
    return b;
  });
}

const branchPatch = patchOf(branchFields).extend({ id: uuid });
export async function updateBranch(actorUserId: string, input: z.input<typeof branchPatch>) {
  const { id, ...patch } = parseInput(branchPatch, input);
  return adminTx(actorUserId, async (tx) => {
    const [b] = await tx.update(branches).set(changed(patch)).where(eq(branches.id, id)).returning();
    if (!b) throw new ServiceError("NOT_FOUND", "Branch not found");
    await writeAudit(tx, { actorUserId, action: "branch.updated", entityType: "branch", entityId: id, data: patch });
    return b;
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  securityDepositFils: fils,
  sortOrder: z.number().int().default(0),
});

export async function createCategory(actorUserId: string, input: z.input<typeof categoryFields>) {
  const i = parseInput(categoryFields, input);
  return adminTx(actorUserId, async (tx) => {
    const [c] = await tx.insert(vehicleCategories).values(i).returning();
    await writeAudit(tx, { actorUserId, action: "category.created", entityType: "vehicle_category", entityId: c.id, data: i });
    return c;
  });
}

const categoryPatch = patchOf(categoryFields).extend({ id: uuid });
export async function updateCategory(actorUserId: string, input: z.input<typeof categoryPatch>) {
  const { id, ...patch } = parseInput(categoryPatch, input);
  return adminTx(actorUserId, async (tx) => {
    const [c] = await tx.update(vehicleCategories).set(changed(patch)).where(eq(vehicleCategories.id, id)).returning();
    if (!c) throw new ServiceError("NOT_FOUND", "Category not found");
    await writeAudit(tx, { actorUserId, action: "category.updated", entityType: "vehicle_category", entityId: id, data: patch });
    return c;
  });
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

const vehicleFields = z.object({
  categoryId: uuid,
  branchId: uuid,
  plateNumber: z.string().trim().toUpperCase().min(2).max(20),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O, Q)"),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  color: z.string().trim().max(40).nullish(),
  transmission: z.enum(transmission.enumValues),
  fuelType: z.enum(fuelType.enumValues),
  seats: z.number().int().min(1).max(15),
  doors: z.number().int().min(2).max(6).default(4),
  luggage: z.number().int().min(0).max(20).default(2),
  mileageKm: z.number().int().min(0).default(0),
  status: z.enum(vehicleStatus.enumValues).default("AVAILABLE"),
  imageUrl: z.string().max(500).nullish(),
  description: z.string().max(2000).nullish(),
  featureIds: z.array(uuid).max(50).optional(),
});

async function setFeatures(tx: Tx, vehicleId: string, featureIds: string[] | undefined) {
  if (featureIds === undefined) return;
  await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
  const unique = [...new Set(featureIds)];
  if (unique.length) {
    const found = await tx.select({ id: vehicleFeatures.id }).from(vehicleFeatures).where(inArray(vehicleFeatures.id, unique));
    if (found.length !== unique.length) throw new ServiceError("VALIDATION_ERROR", "Unknown feature");
    await tx.insert(vehicleFeatureMap).values(unique.map((featureId) => ({ vehicleId, featureId })));
  }
}

export async function listFleet(
  actorUserId: string,
  filter: { branchId?: string; categoryId?: string; status?: (typeof vehicleStatus.enumValues)[number] } = {},
) {
  const f = parseInput(
    z.object({ branchId: uuid.optional(), categoryId: uuid.optional(), status: z.enum(vehicleStatus.enumValues).optional() }),
    filter,
  );
  return adminTx(actorUserId, (tx) =>
    tx
      .select({ vehicle: vehicles, category: vehicleCategories, branch: branches })
      .from(vehicles)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .innerJoin(branches, eq(branches.id, vehicles.branchId))
      .where(
        and(
          f.branchId ? eq(vehicles.branchId, f.branchId) : undefined,
          f.categoryId ? eq(vehicles.categoryId, f.categoryId) : undefined,
          f.status ? eq(vehicles.status, f.status) : undefined,
        ),
      )
      .orderBy(asc(branches.name), asc(vehicles.make), asc(vehicles.model)),
  );
}

export async function createVehicle(actorUserId: string, input: z.input<typeof vehicleFields>) {
  const { featureIds, ...i } = parseInput(vehicleFields, input);
  return adminTx(actorUserId, async (tx) => {
    const [v] = await tx.insert(vehicles).values(i).returning();
    await setFeatures(tx, v.id, featureIds);
    await writeAudit(tx, { actorUserId, action: "vehicle.created", entityType: "vehicle", entityId: v.id, data: { ...i, featureIds } });
    log.info("admin.vehicle_created", { actorUserId, vehicleId: v.id });
    return v;
  });
}

const vehiclePatch = patchOf(vehicleFields).extend({ id: uuid });
export async function updateVehicle(actorUserId: string, input: z.input<typeof vehiclePatch>) {
  const { id, featureIds, ...patch } = parseInput(vehiclePatch, input);
  return adminTx(actorUserId, async (tx) => {
    const [cur] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
    if (!cur) throw new ServiceError("NOT_FOUND", "Vehicle not found");
    if (patch.mileageKm !== undefined && patch.mileageKm < cur.mileageKm) {
      throw new ServiceError("VALIDATION_ERROR", "Mileage cannot go down");
    }
    if (
      (patch.status === "RETIRED" || (patch.branchId && patch.branchId !== cur.branchId)) &&
      (await hasFutureBookings(tx, id))
    ) {
      throw new ServiceError("INVALID_STATE", "Vehicle has active or upcoming reservations");
    }
    const [v] = await tx.update(vehicles).set(changed(patch)).where(eq(vehicles.id, id)).returning();
    await setFeatures(tx, id, featureIds);
    await writeAudit(tx, { actorUserId, action: "vehicle.updated", entityType: "vehicle", entityId: id, data: { ...patch, featureIds } });
    return v;
  });
}

async function hasFutureBookings(tx: Tx, vehicleId: string) {
  const rows = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.vehicleId, vehicleId),
        inArray(reservations.status, ["PENDING", "CONFIRMED", "PICKED_UP"]),
        gt(reservations.returnAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function createFeature(actorUserId: string, input: { code: string; name: string }) {
  const i = parseInput(
    z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/), name: z.string().trim().min(2).max(60) }),
    input,
  );
  return adminTx(actorUserId, async (tx) => {
    const [f] = await tx.insert(vehicleFeatures).values(i).returning();
    await writeAudit(tx, { actorUserId, action: "feature.created", entityType: "vehicle_feature", entityId: f.id, data: i });
    return f;
  });
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

const extraFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).nullish(),
  pricing: z.enum(extraPricing.enumValues),
  priceFils: fils,
  maxChargeFils: fils.nullish(),
  maxQuantity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
});

export async function listAllExtras(actorUserId: string) {
  return adminTx(actorUserId, (tx) => tx.select().from(extras).orderBy(asc(extras.name)));
}

export async function createExtra(actorUserId: string, input: z.input<typeof extraFields>) {
  const i = parseInput(extraFields, input);
  return adminTx(actorUserId, async (tx) => {
    const [e] = await tx.insert(extras).values(i).returning();
    await writeAudit(tx, { actorUserId, action: "extra.created", entityType: "extra", entityId: e.id, data: i });
    return e;
  });
}

const extraPatch = patchOf(extraFields).extend({ id: uuid });
export async function updateExtra(actorUserId: string, input: z.input<typeof extraPatch>) {
  const { id, ...patch } = parseInput(extraPatch, input);
  return adminTx(actorUserId, async (tx) => {
    const [e] = await tx.update(extras).set(changed(patch)).where(eq(extras.id, id)).returning();
    if (!e) throw new ServiceError("NOT_FOUND", "Extra not found");
    await writeAudit(tx, { actorUserId, action: "extra.updated", entityType: "extra", entityId: id, data: patch });
    return e;
  });
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

const ruleFields = z
  .object({
    name: z.string().trim().min(2).max(120),
    categoryId: uuid.nullish(),
    vehicleId: uuid.nullish(),
    branchId: uuid.nullish(),
    dailyRateFils: z.number().int().min(1).max(100_000_000),
    minDays: z.number().int().min(1).max(365).default(1),
    validFrom: z.iso.date().nullish(),
    validTo: z.iso.date().nullish(),
    priority: z.number().int().min(-1000).max(1000).default(0),
    isActive: z.boolean().default(true),
  });

const ruleCreate = ruleFields
  .refine((r) => !!r.categoryId || !!r.vehicleId, "Choose a category or a vehicle")
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, "Season start must be before its end");

export async function listPricingRules(actorUserId: string) {
  return adminTx(actorUserId, (tx) =>
    tx.select().from(pricingRules).orderBy(asc(pricingRules.categoryId), asc(pricingRules.minDays), asc(pricingRules.name)),
  );
}

export async function createPricingRule(actorUserId: string, input: z.input<typeof ruleCreate>) {
  const i = parseInput(ruleCreate, input);
  return adminTx(actorUserId, async (tx) => {
    const [r] = await tx.insert(pricingRules).values(i).returning();
    await writeAudit(tx, { actorUserId, action: "pricing_rule.created", entityType: "pricing_rule", entityId: r.id, data: i });
    return r;
  });
}

const rulePatch = patchOf(ruleFields).extend({ id: uuid });
export async function updatePricingRule(actorUserId: string, input: z.input<typeof rulePatch>) {
  const { id, ...patch } = parseInput(rulePatch, input);
  return adminTx(actorUserId, async (tx) => {
    const [r] = await tx.update(pricingRules).set(changed(patch)).where(eq(pricingRules.id, id)).returning();
    if (!r) throw new ServiceError("NOT_FOUND", "Pricing rule not found");
    await writeAudit(tx, { actorUserId, action: "pricing_rule.updated", entityType: "pricing_rule", entityId: id, data: patch });
    return r;
  });
}

/** Rules are referenced by nothing, so deleting is safe; prefer isActive=false to keep history. */
export async function deletePricingRule(actorUserId: string, id: string) {
  parseInput(uuid, id);
  return adminTx(actorUserId, async (tx) => {
    const [r] = await tx.delete(pricingRules).where(eq(pricingRules.id, id)).returning();
    if (!r) throw new ServiceError("NOT_FOUND", "Pricing rule not found");
    await writeAudit(tx, { actorUserId, action: "pricing_rule.deleted", entityType: "pricing_rule", entityId: id, data: r });
    return r;
  });
}

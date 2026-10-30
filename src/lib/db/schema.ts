// DriveEasy database schema (Drizzle ORM, PostgreSQL 18).
//
// Conventions
// - UUID primary keys (gen_random_uuid()).
// - Every timestamp is timestamptz (UTC). Branch-local display uses branches.time_zone.
// - Money is integer minor units (fils, AED), columns end in `_fils`, CHECK >= 0.
// - Rental / maintenance periods are half-open tstzrange `[start, end)`, stored as
//   GENERATED columns from start/end timestamps so they can never drift.
// - Things Drizzle cannot express (btree_gist exclusion constraints, the cross-table
//   overlap trigger) live in the custom migration drizzle/0001_*.sql.
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PostgreSQL tstzrange. Read as its text form, e.g. `["2026-11-01 08:00:00+00","2026-11-03 08:00:00+00")`. */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();
const fils = (name: string) => integer(name);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["CUSTOMER", "ADMIN"]);
export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
/** Statuses that occupy the vehicle (used by the exclusion constraint + trigger). */
export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const depositStatus = pgEnum("deposit_status", ["PENDING", "AUTHORIZED", "FAILED", "RELEASED", "CAPTURED"]);
export const extraPricing = pgEnum("extra_pricing", ["PER_DAY", "PER_RENTAL"]);
export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStatus = pgEnum("damage_status", ["OPEN", "RESOLVED"]);

// ---------------------------------------------------------------------------
// Auth (Better Auth drizzle adapter; JS keys are the Better Auth field names,
// DB columns are snake_case). Configure Better Auth with
//   advanced.database.generateId = "uuid"
//   user.additionalFields.role = { type: "string", input: false, defaultValue: "CUSTOMER" }
//   drizzleAdapter(db, { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } })
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("CUSTOMER"),
    phone: text("phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_role_idx").on(t.role)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    unique("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality"),
    phone: text("phone").notNull(),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: char("licence_country", { length: 2 }).notNull(),
    licenceExpiry: date("licence_expiry", { mode: "string" }).notNull(),
    /** FileStorage key of the uploaded licence image (private). */
    licenceFileKey: text("licence_file_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("driver_profiles_licence_after_dob", sql`${t.licenceExpiry} > ${t.dateOfBirth}`),
    check("driver_profiles_country_upper", sql`${t.licenceCountry} ~ '^[A-Z]{2}$'`),
  ],
);

// ---------------------------------------------------------------------------
// Branches & fleet
// ---------------------------------------------------------------------------

export const branches = pgTable(
  "branches",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    emirate: text("emirate").notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    /** IANA time zone used for display, e.g. Asia/Dubai. */
    timeZone: text("time_zone").notNull().default("Asia/Dubai"),
    /** Opening hours in branch-local time, minutes after midnight. */
    opensAtMinute: integer("opens_at_minute").notNull().default(0),
    closesAtMinute: integer("closes_at_minute").notNull().default(1440),
    /** VAT rate in basis points (500 = 5%). */
    vatRateBp: integer("vat_rate_bp").notNull().default(500),
    /** Fee charged when a rental is RETURNED to this branch but picked up elsewhere. */
    oneWayFeeFils: fils("one_way_fee_fils").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9-]{2,12}$'`),
    check("branches_vat_range", sql`${t.vatRateBp} BETWEEN 0 AND 10000`),
    check("branches_one_way_fee_nonneg", sql`${t.oneWayFeeFils} >= 0`),
    check(
      "branches_hours_valid",
      sql`${t.opensAtMinute} >= 0 AND ${t.closesAtMinute} <= 1440 AND ${t.opensAtMinute} < ${t.closesAtMinute}`,
    ),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Security deposit held (not charged) for every rental in this category. */
    securityDepositFils: fils("security_deposit_fils").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("vehicle_categories_deposit_nonneg", sql`${t.securityDepositFils} >= 0`)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    /** Branch where the vehicle is currently based. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    plateNumber: text("plate_number").notNull().unique(),
    vin: char("vin", { length: 17 }).notNull().unique(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    color: text("color"),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: integer("seats").notNull(),
    doors: integer("doors").notNull().default(4),
    luggage: integer("luggage").notNull().default(2),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    imageUrl: text("image_url"),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_branch_idx").on(t.branchId),
    index("vehicles_category_idx").on(t.categoryId),
    index("vehicles_status_idx").on(t.status),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
    check("vehicles_year_range", sql`${t.year} BETWEEN 1990 AND 2100`),
    check("vehicles_seats_range", sql`${t.seats} BETWEEN 1 AND 15`),
    check("vehicles_doors_range", sql`${t.doors} BETWEEN 2 AND 6`),
    check("vehicles_luggage_nonneg", sql`${t.luggage} >= 0`),
    check("vehicles_mileage_nonneg", sql`${t.mileageKm} >= 0`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.featureId] }), index("vehicle_feature_map_feature_idx").on(t.featureId)],
);

/**
 * Daily rates. A rule targets a vehicle OR a category, optionally a branch and a season,
 * and applies when the rental has at least `min_days` days. The pricing service picks the
 * most specific matching rule: vehicle > category, branch > any branch, larger min_days,
 * higher priority.
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    dailyRateFils: fils("daily_rate_fils").notNull(),
    minDays: integer("min_days").notNull().default(1),
    /** Season (inclusive dates, branch-local) the pick-up date must fall in. Null = always. */
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_category_idx").on(t.categoryId),
    index("pricing_rules_vehicle_idx").on(t.vehicleId),
    check("pricing_rules_target", sql`${t.categoryId} IS NOT NULL OR ${t.vehicleId} IS NOT NULL`),
    check("pricing_rules_rate_positive", sql`${t.dailyRateFils} > 0`),
    check("pricing_rules_min_days", sql`${t.minDays} >= 1`),
    check(
      "pricing_rules_season",
      sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    pricing: extraPricing("pricing").notNull(),
    priceFils: fils("price_fils").notNull(),
    /** Optional cap for PER_DAY extras (per unit, whole rental). */
    maxChargeFils: fils("max_charge_fils"),
    maxQuantity: integer("max_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_price_nonneg", sql`${t.priceFils} >= 0`),
    check("extras_cap_nonneg", sql`${t.maxChargeFils} IS NULL OR ${t.maxChargeFils} >= 0`),
    check("extras_max_qty", sql`${t.maxQuantity} BETWEEN 1 AND 10`),
  ],
);

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    /** Human-friendly booking reference shown on the voucher, e.g. DE-7K3M9Q2P. */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    pickupAt: tz("pickup_at").notNull(),
    returnAt: tz("return_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(pickup_at, return_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    /** PENDING holds expire at this time (then status -> EXPIRED). */
    holdExpiresAt: tz("hold_expires_at"),
    /** Client-supplied key; retries with the same key return the same reservation. */
    idempotencyKey: text("idempotency_key").notNull().unique(),

    // Driver details captured at checkout
    driverName: text("driver_name").notNull(),
    driverEmail: text("driver_email").notNull(),
    driverPhone: text("driver_phone").notNull(),
    driverProfileId: uuid("driver_profile_id").references(() => driverProfiles.id, { onDelete: "restrict" }),

    // Server-computed price snapshot (fils)
    currency: char("currency", { length: 3 }).notNull().default("AED"),
    rentalDays: integer("rental_days").notNull(),
    dailyRateFils: fils("daily_rate_fils").notNull(),
    baseFils: fils("base_fils").notNull(),
    extrasFils: fils("extras_fils").notNull().default(0),
    oneWayFeeFils: fils("one_way_fee_fils").notNull().default(0),
    subtotalFils: fils("subtotal_fils").notNull(),
    vatRateBp: integer("vat_rate_bp").notNull(),
    vatFils: fils("vat_fils").notNull(),
    totalFils: fils("total_fils").notNull(),
    depositFils: fils("deposit_fils").notNull().default(0),
    /** Extra charges after return (late return, fuel, damage), VAT inclusive. */
    lateFeeFils: fils("late_fee_fils").notNull().default(0),
    cancellationFeeFils: fils("cancellation_fee_fils").notNull().default(0),
    refundedFils: fils("refunded_fils").notNull().default(0),

    confirmedAt: tz("confirmed_at"),
    cancelledAt: tz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reservations_user_idx").on(t.userId),
    index("reservations_vehicle_idx").on(t.vehicleId),
    index("reservations_status_idx").on(t.status),
    index("reservations_hold_expiry_idx")
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'PENDING'`),
    index("reservations_pickup_branch_idx").on(t.pickupBranchId, t.pickupAt),
    check("reservations_period_valid", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_pending_has_hold", sql`${t.status} <> 'PENDING' OR ${t.holdExpiresAt} IS NOT NULL`),
    check("reservations_days_positive", sql`${t.rentalDays} >= 1`),
    check("reservations_vat_range", sql`${t.vatRateBp} BETWEEN 0 AND 10000`),
    check(
      "reservations_money_nonneg",
      sql`${t.dailyRateFils} >= 0 AND ${t.baseFils} >= 0 AND ${t.extrasFils} >= 0 AND ${t.oneWayFeeFils} >= 0
        AND ${t.subtotalFils} >= 0 AND ${t.vatFils} >= 0 AND ${t.totalFils} >= 0 AND ${t.depositFils} >= 0
        AND ${t.lateFeeFils} >= 0 AND ${t.cancellationFeeFils} >= 0 AND ${t.refundedFils} >= 0`,
    ),
    check(
      "reservations_totals_consistent",
      sql`${t.subtotalFils} = ${t.baseFils} + ${t.extrasFils} + ${t.oneWayFeeFils} AND ${t.totalFils} = ${t.subtotalFils} + ${t.vatFils}`,
    ),
    check("reservations_refund_le_total", sql`${t.refundedFils} <= ${t.totalFils}`),
    check("reservations_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    // EXCLUDE (vehicle_id WITH =, period WITH &&) WHERE active -> custom migration 0001.
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    pricing: extraPricing("pricing").notNull(),
    unitPriceFils: fils("unit_price_fils").notNull(),
    totalFils: fils("total_fils").notNull(),
  },
  (t) => [
    unique("reservation_extras_uq").on(t.reservationId, t.extraId),
    index("reservation_extras_extra_idx").on(t.extraId),
    check("reservation_extras_qty", sql`${t.quantity} BETWEEN 1 AND 10`),
    check("reservation_extras_money", sql`${t.unitPriceFils} >= 0 AND ${t.totalFils} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Money: payments, deposits, webhook events
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").unique(),
    /** Sent to the provider; derived from the reservation id (+ purpose). */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** CHARGE = rental payment; EXTRA_CHARGE = post-rental fees (late return etc). */
    purpose: text("purpose").notNull().default("CHARGE"),
    amountFils: fils("amount_fils").notNull(),
    refundedFils: fils("refunded_fils").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("AED"),
    status: paymentStatus("status").notNull().default("PENDING"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId),
    check("payments_amount_positive", sql`${t.amountFils} > 0`),
    check("payments_refund_range", sql`${t.refundedFils} >= 0 AND ${t.refundedFils} <= ${t.amountFils}`),
    check("payments_purpose", sql`${t.purpose} IN ('CHARGE', 'EXTRA_CHARGE')`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerHoldId: text("provider_hold_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountFils: fils("amount_fils").notNull(),
    capturedFils: fils("captured_fils").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("AED"),
    status: depositStatus("status").notNull().default("PENDING"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    check("deposits_amount_positive", sql`${t.amountFils} > 0`),
    check("deposits_capture_range", sql`${t.capturedFils} >= 0 AND ${t.capturedFils} <= ${t.amountFils}`),
  ],
);

/** Every verified provider webhook, deduplicated by (provider, event_id). */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tz("received_at").notNull().defaultNow(),
    processedAt: tz("processed_at"),
  },
  (t) => [unique("payment_webhook_events_uq").on(t.provider, t.eventId)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickedUpAt: tz("picked_up_at").notNull(),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    /** Fuel / charge level in percent (0-100). */
    pickupFuelPercent: integer("pickup_fuel_percent").notNull(),
    pickupStaffId: uuid("pickup_staff_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pickupNotes: text("pickup_notes"),
    returnedAt: tz("returned_at"),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelPercent: integer("return_fuel_percent"),
    returnStaffId: uuid("return_staff_id").references(() => users.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnNotes: text("return_notes"),
    lateFeeFils: fils("late_fee_fils").notNull().default(0),
    fuelChargeFils: fils("fuel_charge_fils").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rental_agreements_vehicle_idx").on(t.vehicleId),
    check("rental_agreements_pickup_mileage", sql`${t.pickupMileageKm} >= 0`),
    check("rental_agreements_pickup_fuel", sql`${t.pickupFuelPercent} BETWEEN 0 AND 100`),
    check(
      "rental_agreements_return_fuel",
      sql`${t.returnFuelPercent} IS NULL OR ${t.returnFuelPercent} BETWEEN 0 AND 100`,
    ),
    check(
      "rental_agreements_return_mileage",
      sql`${t.returnMileageKm} IS NULL OR ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check("rental_agreements_return_after_pickup", sql`${t.returnedAt} IS NULL OR ${t.returnedAt} >= ${t.pickedUpAt}`),
    check(
      "rental_agreements_return_complete",
      sql`(${t.returnedAt} IS NULL) = (${t.returnMileageKm} IS NULL)
        AND (${t.returnedAt} IS NULL) = (${t.returnFuelPercent} IS NULL)
        AND (${t.returnedAt} IS NULL) = (${t.returnStaffId} IS NULL)`,
    ),
    check("rental_agreements_fees_nonneg", sql`${t.lateFeeFils} >= 0 AND ${t.fuelChargeFils} >= 0`),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "restrict" }),
    reportedById: uuid("reported_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stage: damageStage("stage").notNull(),
    severity: damageSeverity("severity").notNull(),
    description: text("description").notNull(),
    /** FileStorage keys of private photos. */
    imageKeys: text("image_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    repairCostFils: fils("repair_cost_fils").notNull().default(0),
    chargedFils: fils("charged_fils").notNull().default(0),
    status: damageStatus("status").notNull().default("OPEN"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId),
    index("damage_reports_reservation_idx").on(t.reservationId),
    check("damage_reports_money", sql`${t.repairCostFils} >= 0 AND ${t.chargedFils} >= 0`),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set to cancel the block (keeps history; cancelled blocks no longer block). */
    cancelledAt: tz("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_idx").on(t.vehicleId),
    check("maintenance_blocks_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
    // EXCLUDE (vehicle_id WITH =, period WITH &&) WHERE cancelled_at IS NULL -> custom migration 0001.
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorUserId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type VehicleStatus = (typeof vehicleStatus.enumValues)[number];
export type Payment = typeof payments.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type RentalAgreement = typeof rentalAgreements.$inferSelect;
export type DamageReport = typeof damageReports.$inferSelect;
export type MaintenanceBlock = typeof maintenanceBlocks.$inferSelect;

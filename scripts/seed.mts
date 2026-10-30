// Seed the DEV database with realistic UAE data.
//   pnpm db:seed      wipe app data (keeps schema) and insert seed data
//   pnpm db:reset     drop schema, run all migrations, then seed
//
// Local-only logins (documented in docs/TASKS.md):
//   admin@driveeasy.local     / DriveEasyAdmin!1     (ADMIN)
//   customer@driveeasy.local  / DriveEasyCustomer!1  (CUSTOMER)
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../src/lib/db/schema";
import { computeQuote, selectPricingRule } from "../src/server/pricing-core";
import { localDate, rentalDays } from "../src/server/time";

export const SEED_USERS = {
  admin: { email: "admin@driveeasy.local", password: "DriveEasyAdmin!1", name: "Fatima Al Mansoori" },
  customer: { email: "customer@driveeasy.local", password: "DriveEasyCustomer!1", name: "Omar Haddad" },
};

const url = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PRODUCTION_SEED) {
  throw new Error("Refusing to seed in production (set ALLOW_PRODUCTION_SEED=1 to override)");
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema: s });

const AED = (aed: number) => Math.round(aed * 100);
const DAY = 86_400_000;

/** Today at hh:mm Asia/Dubai (UTC+4, no DST) plus `days`. */
function dubaiAt(days: number, hh: number, mm = 0): Date {
  const now = new Date();
  const dubaiToday = new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
  const base = Date.parse(`${dubaiToday}T00:00:00Z`) - 4 * 3_600_000;
  return new Date(base + days * DAY + (hh * 60 + mm) * 60_000);
}

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
function vin(prefix: string, n: number): string {
  let tail = "";
  let x = n * 7919 + 104729;
  while (tail.length < 17 - prefix.length) {
    tail += VIN_CHARS[x % VIN_CHARS.length];
    x = Math.floor(x / 3) + 31 * (tail.length + 1);
  }
  return prefix + tail;
}

async function wipe() {
  const { rows } = await pool.query<{ t: string }>(
    "SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows.length) await pool.query(`TRUNCATE ${rows.map((r) => r.t).join(", ")} CASCADE`);
}

async function main() {
  await wipe();

  // --- Users -------------------------------------------------------------
  const mkUser = async (u: { email: string; password: string; name: string }, role: "ADMIN" | "CUSTOMER", phone: string) => {
    const [row] = await db
      .insert(s.users)
      .values({ email: u.email, name: u.name, role, phone, emailVerified: true })
      .returning();
    await db.insert(s.accounts).values({
      userId: row.id,
      accountId: row.id,
      providerId: "credential",
      password: await hashPassword(u.password),
    });
    return row;
  };
  const admin = await mkUser(SEED_USERS.admin, "ADMIN", "+971 50 100 2000");
  const customer = await mkUser(SEED_USERS.customer, "CUSTOMER", "+971 55 123 4567");
  const [profile] = await db
    .insert(s.driverProfiles)
    .values({
      userId: customer.id,
      fullName: "Omar Haddad",
      dateOfBirth: "1990-04-12",
      nationality: "Jordanian",
      phone: "+971 55 123 4567",
      licenceNumber: "DXB-4481207",
      licenceCountry: "AE",
      licenceExpiry: "2030-04-11",
    })
    .returning();

  // --- Branches ----------------------------------------------------------
  const branchRows = await db
    .insert(s.branches)
    .values([
      {
        code: "DXB-APT",
        name: "Dubai International Airport (T3)",
        city: "Dubai",
        emirate: "Dubai",
        address: "Arrivals Hall, Terminal 3, Dubai International Airport",
        phone: "+971 4 220 0001",
        opensAtMinute: 0,
        closesAtMinute: 1440,
        oneWayFeeFils: AED(150),
      },
      {
        code: "DXB-MAR",
        name: "Dubai Marina",
        city: "Dubai",
        emirate: "Dubai",
        address: "Marina Walk, Al Marsa Street, Dubai Marina",
        phone: "+971 4 220 0002",
        opensAtMinute: 8 * 60,
        closesAtMinute: 22 * 60,
        oneWayFeeFils: AED(150),
      },
      {
        code: "AUH-COR",
        name: "Abu Dhabi Corniche",
        city: "Abu Dhabi",
        emirate: "Abu Dhabi",
        address: "Corniche Road West, Al Khalidiyah, Abu Dhabi",
        phone: "+971 2 220 0003",
        opensAtMinute: 8 * 60,
        closesAtMinute: 22 * 60,
        oneWayFeeFils: AED(250),
      },
      {
        code: "SHJ-MAJ",
        name: "Sharjah Al Majaz",
        city: "Sharjah",
        emirate: "Sharjah",
        address: "Al Majaz Waterfront, Corniche Street, Sharjah",
        phone: "+971 6 220 0004",
        opensAtMinute: 8 * 60,
        closesAtMinute: 21 * 60,
        oneWayFeeFils: AED(150),
      },
    ])
    .returning();
  const B = Object.fromEntries(branchRows.map((b) => [b.code, b])) as Record<string, s.Branch>;

  // --- Categories --------------------------------------------------------
  const catRows = await db
    .insert(s.vehicleCategories)
    .values([
      { code: "ECONOMY", name: "Economy", description: "Small, fuel-efficient city cars.", securityDepositFils: AED(1000), sortOrder: 1 },
      { code: "COMPACT", name: "Compact", description: "Comfortable for 4 with luggage.", securityDepositFils: AED(1000), sortOrder: 2 },
      { code: "SEDAN", name: "Full-size sedan", description: "Spacious sedans for business and family.", securityDepositFils: AED(1500), sortOrder: 3 },
      { code: "SUV", name: "SUV", description: "Room for the family and the desert road.", securityDepositFils: AED(2500), sortOrder: 4 },
      { code: "LUXURY", name: "Luxury", description: "Premium cars for special occasions.", securityDepositFils: AED(5000), sortOrder: 5 },
      { code: "VAN", name: "People carrier", description: "7-8 seats for groups.", securityDepositFils: AED(2000), sortOrder: 6 },
    ])
    .returning();
  const C = Object.fromEntries(catRows.map((c) => [c.code, c])) as Record<string, s.VehicleCategory>;

  // --- Features ----------------------------------------------------------
  const featRows = await db
    .insert(s.vehicleFeatures)
    .values(
      [
        ["AC", "Air conditioning"],
        ["BLUETOOTH", "Bluetooth"],
        ["CARPLAY", "Apple CarPlay"],
        ["ANDROID_AUTO", "Android Auto"],
        ["REVERSE_CAMERA", "Reverse camera"],
        ["CRUISE", "Cruise control"],
        ["SUNROOF", "Sunroof"],
        ["NAV", "Built-in navigation"],
        ["LEATHER", "Leather seats"],
        ["PARKING_SENSORS", "Parking sensors"],
        ["AWD", "All-wheel drive"],
      ].map(([code, name]) => ({ code, name })),
    )
    .returning();
  const F = Object.fromEntries(featRows.map((f) => [f.code, f.id])) as Record<string, string>;

  // --- Vehicles ----------------------------------------------------------
  type V = [string, string, string, string, number, string, "AUTOMATIC" | "MANUAL", "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC", number, number, number, string[]];
  // [plate, branch, category, make model, year, color, transmission, fuel, seats, doors, luggage, features]
  const fleet: V[] = [
    ["DXB A 10231", "DXB-APT", "ECONOMY", "Nissan Sunny", 2024, "White", "AUTOMATIC", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH"]],
    ["DXB B 22817", "DXB-APT", "ECONOMY", "Hyundai Accent", 2025, "Silver", "AUTOMATIC", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH", "CARPLAY"]],
    ["DXB C 30552", "DXB-APT", "COMPACT", "Toyota Corolla", 2025, "Grey", "AUTOMATIC", "HYBRID", 5, 4, 3, ["AC", "BLUETOOTH", "CARPLAY", "ANDROID_AUTO", "REVERSE_CAMERA"]],
    ["DXB D 41290", "DXB-APT", "SEDAN", "Toyota Camry", 2025, "Black", "AUTOMATIC", "HYBRID", 5, 4, 3, ["AC", "BLUETOOTH", "CARPLAY", "CRUISE", "REVERSE_CAMERA"]],
    ["DXB E 50318", "DXB-APT", "SUV", "Toyota Land Cruiser", 2024, "White", "AUTOMATIC", "PETROL", 7, 5, 4, ["AC", "BLUETOOTH", "NAV", "LEATHER", "AWD", "REVERSE_CAMERA", "CRUISE"]],
    ["DXB F 61144", "DXB-APT", "LUXURY", "Mercedes-Benz S 500", 2025, "Obsidian Black", "AUTOMATIC", "PETROL", 5, 4, 3, ["AC", "BLUETOOTH", "NAV", "LEATHER", "SUNROOF", "CARPLAY", "PARKING_SENSORS"]],
    ["DXB G 70923", "DXB-MAR", "ECONOMY", "Kia Picanto", 2025, "Red", "AUTOMATIC", "PETROL", 4, 4, 1, ["AC", "BLUETOOTH"]],
    ["DXB H 81465", "DXB-MAR", "COMPACT", "Mazda 3", 2024, "Blue", "AUTOMATIC", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH", "CARPLAY", "REVERSE_CAMERA"]],
    ["DXB J 92011", "DXB-MAR", "SUV", "Nissan Patrol", 2025, "Pearl White", "AUTOMATIC", "PETROL", 7, 5, 4, ["AC", "BLUETOOTH", "NAV", "LEATHER", "AWD", "CRUISE"]],
    ["DXB K 13579", "DXB-MAR", "LUXURY", "Porsche Cayenne", 2025, "Silver", "AUTOMATIC", "PETROL", 5, 5, 3, ["AC", "BLUETOOTH", "NAV", "LEATHER", "SUNROOF", "AWD", "PARKING_SENSORS"]],
    ["DXB L 24680", "DXB-MAR", "SEDAN", "Tesla Model 3", 2025, "White", "AUTOMATIC", "ELECTRIC", 5, 4, 2, ["AC", "BLUETOOTH", "NAV", "REVERSE_CAMERA", "CRUISE"]],
    ["AUH 5 22411", "AUH-COR", "ECONOMY", "Mitsubishi Attrage", 2024, "White", "MANUAL", "PETROL", 5, 4, 2, ["AC"]],
    ["AUH 6 33520", "AUH-COR", "COMPACT", "Honda Civic", 2025, "Grey", "AUTOMATIC", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH", "CARPLAY", "ANDROID_AUTO"]],
    ["AUH 7 44629", "AUH-COR", "SEDAN", "Nissan Altima", 2024, "Black", "AUTOMATIC", "PETROL", 5, 4, 3, ["AC", "BLUETOOTH", "CRUISE"]],
    ["AUH 8 55738", "AUH-COR", "SUV", "Hyundai Santa Fe", 2025, "Brown", "AUTOMATIC", "HYBRID", 7, 5, 3, ["AC", "BLUETOOTH", "CARPLAY", "AWD", "REVERSE_CAMERA"]],
    ["AUH 9 66847", "AUH-COR", "VAN", "Toyota Previa", 2024, "Silver", "AUTOMATIC", "PETROL", 8, 5, 4, ["AC", "BLUETOOTH", "REVERSE_CAMERA"]],
    ["SHJ 3 41120", "SHJ-MAJ", "ECONOMY", "Toyota Yaris", 2025, "White", "AUTOMATIC", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH"]],
    ["SHJ 2 52231", "SHJ-MAJ", "COMPACT", "Kia Cerato", 2024, "Grey", "MANUAL", "PETROL", 5, 4, 2, ["AC", "BLUETOOTH", "ANDROID_AUTO"]],
    ["SHJ 1 63342", "SHJ-MAJ", "SUV", "Mitsubishi Pajero", 2024, "White", "AUTOMATIC", "DIESEL", 7, 5, 3, ["AC", "BLUETOOTH", "AWD"]],
    ["SHJ 4 74453", "SHJ-MAJ", "VAN", "Kia Carnival", 2025, "Black", "AUTOMATIC", "PETROL", 8, 5, 4, ["AC", "BLUETOOTH", "CARPLAY", "REVERSE_CAMERA"]],
  ];
  const vehicleRows = await db
    .insert(s.vehicles)
    .values(
      fleet.map(([plate, branch, cat, makeModel, year, color, trans, fuel, seats, doors, luggage], n) => {
        const [make, ...model] = makeModel.split(" ");
        return {
          plateNumber: plate,
          branchId: B[branch].id,
          categoryId: C[cat].id,
          make: make === "Mercedes-Benz" ? "Mercedes-Benz" : make,
          model: model.join(" "),
          year,
          color,
          transmission: trans,
          fuelType: fuel,
          seats,
          doors,
          luggage,
          vin: vin(["JT", "KM", "WD", "5Y", "1N"][n % 5], n + 1),
          mileageKm: 4_000 + n * 2_731,
          status: n === 11 ? ("MAINTENANCE" as const) : ("AVAILABLE" as const),
          description: `${year} ${makeModel} in ${color.toLowerCase()}.`,
        };
      }),
    )
    .returning();
  await db.insert(s.vehicleFeatureMap).values(
    fleet.flatMap((v, n) => v[11].map((code) => ({ vehicleId: vehicleRows[n].id, featureId: F[code] }))),
  );
  const byPlate = (plate: string) => vehicleRows.find((v) => v.plateNumber === plate)!;

  // --- Extras ------------------------------------------------------------
  const extraRows = await db
    .insert(s.extras)
    .values([
      { code: "CHILD_SEAT", name: "Child seat", description: "ISOFIX child seat (9-36 kg).", pricing: "PER_DAY", priceFils: AED(25), maxChargeFils: AED(250), maxQuantity: 3 },
      { code: "GPS", name: "GPS navigation", description: "Portable GPS with UAE maps.", pricing: "PER_DAY", priceFils: AED(20), maxChargeFils: AED(200), maxQuantity: 1 },
      { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Add a second licensed driver.", pricing: "PER_DAY", priceFils: AED(30), maxChargeFils: AED(300), maxQuantity: 2 },
      { code: "FULL_INSURANCE", name: "Full insurance (zero excess)", description: "Covers damage with no excess.", pricing: "PER_DAY", priceFils: AED(60), maxChargeFils: null, maxQuantity: 1 },
      { code: "SALIK_TAG", name: "Salik toll tag", description: "Prepaid toll tag, AED 50 credit included.", pricing: "PER_RENTAL", priceFils: AED(50), maxChargeFils: null, maxQuantity: 1 },
    ])
    .returning();
  const X = Object.fromEntries(extraRows.map((e) => [e.code, e])) as Record<string, s.Extra>;

  // --- Pricing rules -----------------------------------------------------
  const rates: Record<string, [number, number]> = {
    ECONOMY: [99, 85],
    COMPACT: [129, 110],
    SEDAN: [179, 155],
    SUV: [299, 260],
    LUXURY: [899, 799],
    VAN: [249, 215],
  };
  const year = new Date().getUTCFullYear();
  const ruleRows = await db
    .insert(s.pricingRules)
    .values([
      ...Object.entries(rates).flatMap(([code, [daily, weekly]]) => [
        { name: `${C[code].name} daily`, categoryId: C[code].id, dailyRateFils: AED(daily) },
        { name: `${C[code].name} weekly (7+ days)`, categoryId: C[code].id, dailyRateFils: AED(weekly), minDays: 7 },
      ]),
      { name: "Airport economy surcharge", categoryId: C.ECONOMY.id, branchId: B["DXB-APT"].id, dailyRateFils: AED(109) },
      {
        name: "Winter peak SUV",
        categoryId: C.SUV.id,
        dailyRateFils: AED(349),
        validFrom: `${year}-12-15`,
        validTo: `${year + 1}-01-05`,
        priority: 10,
      },
      { name: "Porsche Cayenne special", vehicleId: byPlate("DXB K 13579").id, dailyRateFils: AED(749) },
    ])
    .returning();

  // --- Reservations ------------------------------------------------------
  let refN = 0;
  const book = async (opts: {
    plate: string;
    returnBranch?: string;
    pickupAt: Date;
    returnAt: Date;
    status: "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED";
    extras?: [string, number][];
  }) => {
    const v = byPlate(opts.plate);
    const pb = branchRows.find((b) => b.id === v.branchId)!;
    const rb = opts.returnBranch ? B[opts.returnBranch] : pb;
    const cat = catRows.find((c) => c.id === v.categoryId)!;
    const rule = selectPricingRule(ruleRows, {
      vehicleId: v.id,
      categoryId: v.categoryId,
      branchId: pb.id,
      days: rentalDays(opts.pickupAt, opts.returnAt),
      pickupDate: localDate(opts.pickupAt, pb.timeZone),
    })!;
    const q = computeQuote({
      pickupAt: opts.pickupAt,
      returnAt: opts.returnAt,
      dailyRateFils: rule.dailyRateFils,
      extras: (opts.extras ?? []).map(([code, quantity]) => ({
        extraId: X[code].id,
        code,
        name: X[code].name,
        pricing: X[code].pricing,
        priceFils: X[code].priceFils,
        maxChargeFils: X[code].maxChargeFils,
        quantity,
      })),
      oneWayFeeFils: rb.id === pb.id ? 0 : rb.oneWayFeeFils,
      vatRateBp: pb.vatRateBp,
      depositFils: cat.securityDepositFils,
    });
    refN++;
    const [r] = await db
      .insert(s.reservations)
      .values({
        reference: `DE-SEED${String(refN).padStart(4, "0")}`.slice(0, 11),
        userId: customer.id,
        vehicleId: v.id,
        pickupBranchId: pb.id,
        returnBranchId: rb.id,
        pickupAt: opts.pickupAt,
        returnAt: opts.returnAt,
        status: opts.status,
        idempotencyKey: `seed-${refN}`,
        driverName: profile.fullName,
        driverEmail: customer.email,
        driverPhone: profile.phone,
        driverProfileId: profile.id,
        currency: "AED",
        rentalDays: q.rentalDays,
        dailyRateFils: q.dailyRateFils,
        baseFils: q.baseFils,
        extrasFils: q.extrasFils,
        oneWayFeeFils: q.oneWayFeeFils,
        subtotalFils: q.subtotalFils,
        vatRateBp: q.vatRateBp,
        vatFils: q.vatFils,
        totalFils: q.totalFils,
        depositFils: q.depositFils,
        confirmedAt: new Date(opts.pickupAt.getTime() - 10 * DAY),
        ...(opts.status === "CANCELLED"
          ? { cancelledAt: new Date(), cancelReason: "Plans changed", refundedFils: q.totalFils }
          : {}),
        createdAt: new Date(opts.pickupAt.getTime() - 10 * DAY),
      })
      .returning();
    if (q.extras.length) {
      await db.insert(s.reservationExtras).values(
        q.extras.map((e) => ({
          reservationId: r.id,
          extraId: e.extraId,
          quantity: e.quantity,
          pricing: e.pricing,
          unitPriceFils: e.priceFils,
          totalFils: e.totalFils,
        })),
      );
    }
    // Seeded money rows are marked provider "seed": they exist only in the DB, not in the fake provider.
    await db.insert(s.payments).values({
      reservationId: r.id,
      provider: "seed",
      providerPaymentId: `pay_seed_${refN}`,
      idempotencyKey: `${r.id}:charge:1`,
      amountFils: q.totalFils,
      refundedFils: opts.status === "CANCELLED" ? q.totalFils : 0,
      status: opts.status === "CANCELLED" ? "REFUNDED" : "SUCCEEDED",
    });
    await db.insert(s.deposits).values({
      reservationId: r.id,
      provider: "seed",
      providerHoldId: `hold_seed_${refN}`,
      idempotencyKey: `${r.id}:deposit:1`,
      amountFils: q.depositFils,
      status: opts.status === "CONFIRMED" || opts.status === "PICKED_UP" ? "AUTHORIZED" : "RELEASED",
    });
    if (opts.status === "PICKED_UP" || opts.status === "RETURNED") {
      await db.insert(s.rentalAgreements).values({
        reservationId: r.id,
        vehicleId: v.id,
        pickedUpAt: opts.pickupAt,
        pickupMileageKm: v.mileageKm,
        pickupFuelPercent: 100,
        pickupStaffId: admin.id,
        ...(opts.status === "RETURNED"
          ? {
              returnedAt: opts.returnAt,
              returnMileageKm: v.mileageKm + 412,
              returnFuelPercent: 100,
              returnStaffId: admin.id,
              returnBranchId: rb.id,
            }
          : {}),
      });
      if (opts.status === "PICKED_UP") {
        await db.update(s.vehicles).set({ status: "ON_RENT" }).where(eqId(v.id));
      }
    }
    return r;
  };

  await book({ plate: "DXB C 30552", pickupAt: dubaiAt(3, 10), returnAt: dubaiAt(6, 10), status: "CONFIRMED", extras: [["CHILD_SEAT", 1], ["GPS", 1]] });
  await book({ plate: "DXB E 50318", pickupAt: dubaiAt(7, 9), returnAt: dubaiAt(14, 9), status: "CONFIRMED", extras: [["FULL_INSURANCE", 1]] });
  await book({ plate: "DXB H 81465", returnBranch: "AUH-COR", pickupAt: dubaiAt(5, 12), returnAt: dubaiAt(8, 18), status: "CONFIRMED" });
  await book({ plate: "AUH 8 55738", pickupAt: dubaiAt(10, 10), returnAt: dubaiAt(12, 10), status: "CONFIRMED", extras: [["ADDITIONAL_DRIVER", 1], ["SALIK_TAG", 1]] });
  await book({ plate: "SHJ 3 41120", pickupAt: dubaiAt(20, 9), returnAt: dubaiAt(23, 9), status: "CANCELLED" });
  await book({ plate: "DXB D 41290", pickupAt: dubaiAt(-1, 10), returnAt: dubaiAt(2, 10), status: "PICKED_UP" });
  await book({ plate: "DXB A 10231", pickupAt: dubaiAt(-9, 10), returnAt: dubaiAt(-6, 10), status: "RETURNED" });

  // --- Maintenance -------------------------------------------------------
  await db.insert(s.maintenanceBlocks).values([
    { vehicleId: byPlate("DXB J 92011").id, startsAt: dubaiAt(4, 8), endsAt: dubaiAt(6, 8), reason: "60,000 km service", createdById: admin.id },
    { vehicleId: byPlate("AUH 5 22411").id, startsAt: dubaiAt(0, 8), endsAt: dubaiAt(30, 8), reason: "Gearbox repair", createdById: admin.id },
  ]);

  await db.insert(s.auditLogs).values({ actorUserId: admin.id, action: "seed.completed", entityType: "system", data: { vehicles: vehicleRows.length } });

  console.log(
    JSON.stringify({
      level: "info",
      msg: "seed.completed",
      branches: branchRows.length,
      categories: catRows.length,
      vehicles: vehicleRows.length,
      extras: extraRows.length,
      pricingRules: ruleRows.length,
      reservations: refN,
      logins: Object.values(SEED_USERS).map((u) => `${u.email} / ${u.password}`),
    }),
  );
}

const eqId = (id: string) => eq(s.vehicles.id, id);

try {
  await main();
} finally {
  await pool.end();
}

"use server";

import {
  createBranch,
  createCategory,
  createExtra,
  createPricingRule,
  createVehicle,
  deletePricingRule,
  updateBranch,
  updateCategory,
  updateExtra,
  updatePricingRule,
  updateVehicle,
} from "@/server/admin/catalog";
import {
  cancelMaintenanceBlock,
  checkIn,
  checkOut,
  createDamageReport,
  createMaintenanceBlock,
  updateDamageReport,
} from "@/server/admin/operations";
import { cancelReservation } from "@/server/changes";
import { getVehicle } from "@/server/availability";
import { ServiceError } from "@/server/errors";
import { zonedToUtc } from "@/components/zoned-time";
import { bool, fils, int, nullableStr, optStr, str, timeToMinutes } from "./_lib/form-data";
import { runAdmin } from "./_lib/run";
import type { AdminState } from "./_lib/state";

type Action = (prev: AdminState, fd: FormData) => Promise<AdminState>;

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

function branchInput(fd: FormData) {
  const allDay = bool(fd, "allDay");
  const closes = timeToMinutes(str(fd, "closesAt"));
  return {
    code: str(fd, "code"),
    name: str(fd, "name"),
    city: str(fd, "city"),
    emirate: str(fd, "emirate"),
    address: str(fd, "address"),
    phone: nullableStr(fd, "phone"),
    timeZone: str(fd, "timeZone") || "Asia/Dubai",
    opensAtMinute: allDay ? 0 : timeToMinutes(str(fd, "opensAt")),
    closesAtMinute: allDay ? 1440 : closes === 1439 ? 1440 : closes,
    vatRateBp: Math.round(Number(str(fd, "vatPercent") || "5") * 100),
    oneWayFeeFils: fils(fd, "oneWayFee") ?? 0,
    isActive: bool(fd, "isActive"),
  };
}

export const createBranchAction: Action = async (_p, fd) =>
  runAdmin("branch.create", async (a) => {
    const b = await createBranch(a.id, branchInput(fd));
    return `Branch ${b.name} created.`;
  }, ["/admin/branches", "/branches"]);

export const updateBranchAction: Action = async (_p, fd) =>
  runAdmin("branch.update", async (a) => {
    const b = await updateBranch(a.id, { id: str(fd, "id"), ...branchInput(fd) });
    return `Branch ${b.name} saved.`;
  }, ["/admin/branches", "/branches"]);

// ---------------------------------------------------------------------------
// Categories, extras, pricing rules
// ---------------------------------------------------------------------------

export const createCategoryAction: Action = async (_p, fd) =>
  runAdmin("category.create", async (a) => {
    const c = await createCategory(a.id, {
      code: str(fd, "code"),
      name: str(fd, "name"),
      description: optStr(fd, "description"),
      securityDepositFils: fils(fd, "deposit") ?? 0,
      sortOrder: int(fd, "sortOrder") ?? 0,
    });
    return `Category ${c.name} created.`;
  }, ["/admin/pricing"]);

export const updateCategoryAction: Action = async (_p, fd) =>
  runAdmin("category.update", async (a) => {
    const c = await updateCategory(a.id, {
      id: str(fd, "id"),
      name: str(fd, "name"),
      description: optStr(fd, "description"),
      securityDepositFils: fils(fd, "deposit"),
      sortOrder: int(fd, "sortOrder"),
    });
    return `Category ${c.name} saved.`;
  }, ["/admin/pricing"]);

function extraInput(fd: FormData) {
  return {
    code: str(fd, "code"),
    name: str(fd, "name"),
    description: nullableStr(fd, "description"),
    pricing: str(fd, "pricing") as "PER_DAY" | "PER_RENTAL",
    priceFils: fils(fd, "price") ?? NaN,
    maxChargeFils: fils(fd, "maxCharge") ?? null,
    maxQuantity: int(fd, "maxQuantity") ?? 1,
    isActive: bool(fd, "isActive"),
  };
}

export const createExtraAction: Action = async (_p, fd) =>
  runAdmin("extra.create", async (a) => `Extra ${(await createExtra(a.id, extraInput(fd))).name} created.`, ["/admin/pricing"]);

export const updateExtraAction: Action = async (_p, fd) =>
  runAdmin("extra.update", async (a) => {
    const { code: _code, ...rest } = extraInput(fd);
    void _code;
    return `Extra ${(await updateExtra(a.id, { id: str(fd, "id"), ...rest })).name} saved.`;
  }, ["/admin/pricing"]);

function ruleInput(fd: FormData) {
  return {
    name: str(fd, "name"),
    categoryId: nullableStr(fd, "categoryId"),
    vehicleId: nullableStr(fd, "vehicleId"),
    branchId: nullableStr(fd, "branchId"),
    dailyRateFils: fils(fd, "dailyRate") ?? NaN,
    minDays: int(fd, "minDays") ?? 1,
    validFrom: nullableStr(fd, "validFrom"),
    validTo: nullableStr(fd, "validTo"),
    priority: int(fd, "priority") ?? 0,
    isActive: bool(fd, "isActive"),
  };
}

export const createRuleAction: Action = async (_p, fd) =>
  runAdmin("pricing_rule.create", async (a) => `Rule ${(await createPricingRule(a.id, ruleInput(fd))).name} created.`, ["/admin/pricing"]);

export const updateRuleAction: Action = async (_p, fd) =>
  runAdmin("pricing_rule.update", async (a) => `Rule ${(await updatePricingRule(a.id, { id: str(fd, "id"), ...ruleInput(fd) })).name} saved.`, [
    "/admin/pricing",
  ]);

export const deleteRuleAction: Action = async (_p, fd) =>
  runAdmin("pricing_rule.delete", async (a) => {
    await deletePricingRule(a.id, str(fd, "id"));
    return "Rule deleted.";
  }, ["/admin/pricing"]);

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

function vehicleInput(fd: FormData) {
  return {
    categoryId: str(fd, "categoryId"),
    branchId: str(fd, "branchId"),
    plateNumber: str(fd, "plateNumber"),
    vin: str(fd, "vin"),
    make: str(fd, "make"),
    model: str(fd, "model"),
    year: int(fd, "year") ?? NaN,
    color: nullableStr(fd, "color"),
    transmission: str(fd, "transmission") as "AUTOMATIC" | "MANUAL",
    fuelType: str(fd, "fuelType") as "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC",
    seats: int(fd, "seats") ?? NaN,
    doors: int(fd, "doors") ?? 4,
    luggage: int(fd, "luggage") ?? 2,
    mileageKm: int(fd, "mileageKm") ?? 0,
    status: (str(fd, "status") || "AVAILABLE") as "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED",
    imageUrl: nullableStr(fd, "imageUrl"),
    description: nullableStr(fd, "description"),
    featureIds: fd.getAll("featureIds").map(String),
  };
}

export const createVehicleAction: Action = async (_p, fd) =>
  runAdmin("vehicle.create", async (a) => {
    const v = await createVehicle(a.id, vehicleInput(fd));
    return `${v.make} ${v.model} (${v.plateNumber}) added to the fleet.`;
  }, ["/admin/fleet"]);

export const updateVehicleAction: Action = async (_p, fd) =>
  runAdmin("vehicle.update", async (a) => {
    const id = str(fd, "id");
    const v = await updateVehicle(a.id, { id, ...vehicleInput(fd) });
    return `${v.make} ${v.model} saved.`;
  }, ["/admin/fleet", `/admin/fleet/${str(fd, "id")}`]);

export const createBlockAction: Action = async (_p, fd) =>
  runAdmin("maintenance.create", async (a) => {
    const vehicleId = str(fd, "vehicleId");
    const v = await getVehicle(vehicleId);
    const tz = v?.branch.timeZone ?? "Asia/Dubai";
    const startsAt = zonedToUtc(str(fd, "startDate"), str(fd, "startTime") || "00:00", tz);
    const endsAt = zonedToUtc(str(fd, "endDate"), str(fd, "endTime") || "00:00", tz);
    if (!startsAt || !endsAt) throw new ServiceError("VALIDATION_ERROR", "Enter valid start and end dates");
    await createMaintenanceBlock(a.id, { vehicleId, startsAt, endsAt, reason: str(fd, "reason") });
    return "Maintenance block added.";
  }, [`/admin/fleet/${str(fd, "vehicleId")}`]);

export const cancelBlockAction: Action = async (_p, fd) =>
  runAdmin("maintenance.cancel", async (a) => {
    await cancelMaintenanceBlock(a.id, str(fd, "id"));
    return "Maintenance block cancelled.";
  }, [`/admin/fleet/${str(fd, "vehicleId")}`]);

// ---------------------------------------------------------------------------
// Reservations: check-out, check-in, cancel, damage
// ---------------------------------------------------------------------------

export const checkOutAction: Action = async (_p, fd) =>
  runAdmin("reservation.check_out", async (a) => {
    await checkOut(a.id, {
      reservationId: str(fd, "reservationId"),
      mileageKm: int(fd, "mileageKm") ?? NaN,
      fuelPercent: int(fd, "fuelPercent") ?? NaN,
      notes: optStr(fd, "notes"),
    });
    return "Vehicle checked out to the customer.";
  }, [`/admin/reservations/${str(fd, "reservationId")}`, "/admin/reservations", "/admin"]);

export const checkInAction: Action = async (_p, fd) =>
  runAdmin("reservation.check_in", async (a) => {
    const tz = str(fd, "timeZone") || "Asia/Dubai";
    const returnedAt = optStr(fd, "returnedDate") ? zonedToUtc(str(fd, "returnedDate"), str(fd, "returnedTime"), tz) : undefined;
    if (returnedAt === null) throw new ServiceError("VALIDATION_ERROR", "Enter a valid return date and time");
    const res = await checkIn(a.id, {
      reservationId: str(fd, "reservationId"),
      mileageKm: int(fd, "mileageKm") ?? NaN,
      fuelPercent: int(fd, "fuelPercent") ?? NaN,
      returnBranchId: optStr(fd, "returnBranchId"),
      returnedAt,
      notes: optStr(fd, "notes"),
      damageChargeFils: fils(fd, "damageCharge") ?? 0,
      needsMaintenance: bool(fd, "needsMaintenance"),
    });
    const parts = [
      res.lateFeeFils > 0 ? `late return ${(res.lateFeeFils / 100).toFixed(2)} AED (${res.lateMinutes} min late)` : "no late fee",
      res.fuelChargeFils > 0 ? `fuel ${(res.fuelChargeFils / 100).toFixed(2)} AED` : "no fuel charge",
      res.damageChargeFils > 0 ? `damage ${(res.damageChargeFils / 100).toFixed(2)} AED` : null,
    ].filter(Boolean);
    return `Vehicle checked in: ${parts.join(", ")}. Total extra charges ${(res.totalChargesFils / 100).toFixed(2)} AED.`;
  }, [`/admin/reservations/${str(fd, "reservationId")}`, "/admin/reservations", "/admin"]);

export const adminCancelAction: Action = async (_p, fd) =>
  runAdmin("reservation.cancel", async (a) => {
    const r = await cancelReservation({ reservationId: str(fd, "reservationId"), userId: a.id, reason: optStr(fd, "reason") });
    return `Reservation cancelled. Fee kept ${(r.feeFils / 100).toFixed(2)} AED, refund ${(r.refundFils / 100).toFixed(2)} AED.`;
  }, [`/admin/reservations/${str(fd, "reservationId")}`, "/admin/reservations"]);

export const createDamageAction: Action = async (_p, fd) =>
  runAdmin("damage.create", async (a) => {
    const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    const photos = await Promise.all(files.map(async (f) => ({ data: new Uint8Array(await f.arrayBuffer()), contentType: f.type })));
    await createDamageReport(a.id, {
      vehicleId: str(fd, "vehicleId"),
      reservationId: optStr(fd, "reservationId"),
      stage: str(fd, "stage") as "PICKUP" | "RETURN" | "OTHER",
      severity: str(fd, "severity") as "MINOR" | "MODERATE" | "MAJOR",
      description: str(fd, "description"),
      repairCostFils: fils(fd, "repairCost") ?? 0,
      chargedFils: fils(fd, "charged") ?? 0,
      photos,
    });
    return `Damage report saved with ${photos.length} photo${photos.length === 1 ? "" : "s"}.`;
  }, [`/admin/reservations/${str(fd, "reservationId")}`, `/admin/fleet/${str(fd, "vehicleId")}`, "/admin/damage"]);

export const resolveDamageAction: Action = async (_p, fd) =>
  runAdmin("damage.update", async (a) => {
    await updateDamageReport(a.id, { id: str(fd, "id"), status: str(fd, "status") === "OPEN" ? "OPEN" : "RESOLVED" });
    return "Damage report updated.";
  }, ["/admin/damage"]);

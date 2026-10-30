// Inputs for db's reservation services.
import { randomUUID } from "node:crypto";
import type { CreateReservationInput, DriverInput } from "@/server/reservations";
import type { World } from "./factories";

export const driver = (o: Partial<DriverInput> = {}): DriverInput => ({
  fullName: "QA Driver",
  email: "QA.Driver@Example.test",
  phone: "+971 50 123 4567",
  dateOfBirth: "1990-05-05",
  licenceNumber: "DXB-123456",
  licenceCountry: "ae",
  licenceExpiry: "2035-01-01",
  ...o,
});

export function bookingInput(
  w: World,
  pickupAt: Date,
  returnAt: Date,
  o: Partial<CreateReservationInput> = {},
): CreateReservationInput {
  return {
    userId: w.customer.id,
    idempotencyKey: randomUUID(),
    vehicleId: w.vehicle.id,
    pickupBranchId: w.branch.id,
    pickupAt,
    returnAt,
    extras: [],
    driver: driver(),
    ...o,
  };
}

/** Settle a promise into { ok, value } | { ok: false, code }. */
export async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; err: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? String(err), err };
  }
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatDateTime, formatMoney } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Card, CardBody, CardHeader, CardTitle, DescriptionList, Field, Input, PageHeader, PageSkeleton, Select, Textarea } from "@/components/ui";
import { utcToZoned } from "@/components/zoned-time";
import { requireAdmin } from "@/lib/auth-session";
import { listAllBranches } from "@/server/admin/catalog";
import { getReservationByIdForAdmin, listDamageReports } from "@/server/admin/operations";
import { getDriverProfile } from "@/server/files";
import { reservationPrice } from "../../../_lib/reservation-view";
import { adminCancelAction, checkInAction, checkOutAction } from "../../actions";
import { ActionForm } from "../../_lib/action-form";
import { DamageForm, DamageList } from "../../_lib/damage";

export const metadata: Metadata = { title: "Admin · Reservation" };

export default function AdminReservationPage({ params, searchParams }: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/reservations/[id]">) {
  const { id } = await params;
  const done = (await searchParams).done;
  const admin = await requireAdmin(`/admin/reservations/${id}`);
  const d = await getReservationByIdForAdmin(admin.id, id);
  if (!d) notFound();
  const r = d.reservation;
  const [damage, branches, profile] = await Promise.all([
    listDamageReports(admin.id, { reservationId: r.id }),
    listAllBranches(admin.id),
    getDriverProfile(r.userId),
  ]);
  const ptz = d.pickupBranch.timeZone;
  const rtz = d.returnBranch.timeZone;
  const a = d.agreement;
  const nowLocal = utcToZoned(new Date(), rtz);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/reservations" className="hover:text-ink">
          ← Reservations
        </Link>
      </nav>
      <PageHeader
        eyebrow={`${d.vehicle.make} ${d.vehicle.model} · ${d.vehicle.plateNumber}`}
        title={<span className="font-mono" data-testid="reservation-reference">{r.reference}</span>}
        actions={<StatusBadge status={r.status} />}
      />

      {done === "checked-out" && r.status === "PICKED_UP" && (
        <Alert tone="success" title="Vehicle checked out">
          Handed over at {a ? `${a.pickupMileageKm.toLocaleString()} km, fuel ${a.pickupFuelPercent}%` : "pick-up"}.
        </Alert>
      )}
      {done === "checked-in" && a?.returnedAt && (
        <Alert tone="success" title="Vehicle checked in" >
          <span data-testid="checkin-summary">
            Late return fee {formatMoney(a.lateFeeFils)} · fuel charge {formatMoney(a.fuelChargeFils)} · total extra charges{" "}
            {formatMoney(r.lateFeeFils)}.
          </span>
        </Alert>
      )}
      {done === "cancelled" && (
        <Alert tone="success" title="Reservation cancelled">
          Fee kept {formatMoney(r.cancellationFeeFils)} · refunded {formatMoney(r.refundedFils)}
          {d.deposit ? ` · deposit ${d.deposit.status.toLowerCase()}` : ""}.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Booking</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Pick-up", value: <>{formatDateTime(r.pickupAt, ptz)} · {d.pickupBranch.name}</> },
                  { label: "Return", value: <>{formatDateTime(r.returnAt, rtz)} · {d.returnBranch.name}</> },
                  { label: "Driver", value: <>{r.driverName}<br />{r.driverEmail} · {r.driverPhone}</> },
                  {
                    label: "Licence",
                    value: profile ? (
                      <>
                        {profile.licenceNumber} ({profile.licenceCountry}), expires {profile.licenceExpiry}
                        {profile.licenceFileKey && (
                          <>
                            <br />
                            <a href={`/api/files?key=${encodeURIComponent(profile.licenceFileKey)}`} target="_blank" rel="noopener" className="text-brand-700 hover:underline">
                              View licence file
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      "No driver profile"
                    ),
                  },
                  { label: "Deposit", value: d.deposit ? <>{formatMoney(d.deposit.amountFils)} <StatusBadge status={d.deposit.status} /></> : "None" },
                  { label: "Payment", value: d.payment ? <>{formatMoney(d.payment.amountFils)} <StatusBadge status={d.payment.status} /></> : "None" },
                ]}
              />
            </CardBody>
          </Card>

          {a && (
            <Card>
              <CardHeader>
                <CardTitle>Rental agreement</CardTitle>
              </CardHeader>
              <CardBody>
                <DescriptionList
                  items={[
                    { label: "Picked up", value: `${formatDateTime(a.pickedUpAt, ptz)} · ${a.pickupMileageKm.toLocaleString()} km · fuel ${a.pickupFuelPercent}%` },
                    ...(a.returnedAt
                      ? [
                          { label: "Returned", value: `${formatDateTime(a.returnedAt, rtz)} · ${a.returnMileageKm?.toLocaleString()} km · fuel ${a.returnFuelPercent}%` },
                          { label: "Distance", value: `${((a.returnMileageKm ?? 0) - a.pickupMileageKm).toLocaleString()} km` },
                          { label: "Late return fee", value: formatMoney(a.lateFeeFils) },
                          { label: "Fuel charge", value: formatMoney(a.fuelChargeFils) },
                        ]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          )}

          {r.status === "CONFIRMED" && (
            <Card>
              <CardHeader>
                <CardTitle>Check out (hand over the car)</CardTitle>
              </CardHeader>
              <CardBody>
                <ActionForm action={checkOutAction} submitLabel="Check out vehicle" pendingLabel="Checking out…">
                  <input type="hidden" name="reservationId" value={r.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="outMileage" label="Odometer (km)">
                      <Input id="outMileage" name="mileageKm" type="number" min={0} required defaultValue={d.vehicle.mileageKm} />
                    </Field>
                    <Field id="outFuel" label="Fuel / charge level (%)">
                      <Input id="outFuel" name="fuelPercent" type="number" min={0} max={100} required defaultValue={100} />
                    </Field>
                  </div>
                  <Field id="outNotes" label="Notes">
                    <Textarea id="outNotes" name="notes" rows={2} />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}

          {r.status === "PICKED_UP" && a && (
            <Card>
              <CardHeader>
                <CardTitle>Check in (car returned)</CardTitle>
                <p className="mt-1 text-xs text-muted">Late return and fuel charges are calculated by the system. Leave the time empty to use now.</p>
              </CardHeader>
              <CardBody>
                <ActionForm action={checkInAction} submitLabel="Check in vehicle" pendingLabel="Checking in…">
                  <input type="hidden" name="reservationId" value={r.id} />
                  <input type="hidden" name="timeZone" value={rtz} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="inMileage" label="Odometer (km)">
                      <Input id="inMileage" name="mileageKm" type="number" min={a.pickupMileageKm} required />
                    </Field>
                    <Field id="inFuel" label="Fuel / charge level (%)">
                      <Input id="inFuel" name="fuelPercent" type="number" min={0} max={100} required />
                    </Field>
                    <Field id="returnedDate" label={`Returned on (${rtz})`}>
                      <Input id="returnedDate" name="returnedDate" type="date" defaultValue={nowLocal.date} />
                    </Field>
                    <Field id="returnedTime" label="Returned at">
                      <Input id="returnedTime" name="returnedTime" type="time" defaultValue={nowLocal.time} />
                    </Field>
                    <Field id="returnBranchId" label="Returned to branch">
                      <Select id="returnBranchId" name="returnBranchId" defaultValue={r.returnBranchId}>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field id="damageCharge" label="Damage charge from deposit (AED)">
                      <Input id="damageCharge" name="damageCharge" inputMode="decimal" placeholder="0.00" />
                    </Field>
                  </div>
                  <Field id="inNotes" label="Notes">
                    <Textarea id="inNotes" name="notes" rows={2} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="needsMaintenance" className="size-4 accent-brand-600" />
                    Send the car to maintenance after return
                  </label>
                </ActionForm>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Damage reports</CardTitle>
            </CardHeader>
            <CardBody className="space-y-6">
              <DamageList reports={damage} timeZone={ptz} />
              <details className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium">Report new damage</summary>
                <div className="mt-4">
                  <DamageForm vehicleId={d.vehicle.id} reservationId={r.id} defaultStage={r.status === "CONFIRMED" ? "PICKUP" : "RETURN"} />
                </div>
              </details>
            </CardBody>
          </Card>

          {(r.status === "PENDING" || r.status === "CONFIRMED") && (
            <Card>
              <CardHeader>
                <CardTitle>Cancel reservation</CardTitle>
                <p className="mt-1 text-xs text-muted">The cancellation policy applies; refunds and deposit release run automatically.</p>
              </CardHeader>
              <CardBody>
                <ActionForm action={adminCancelAction} submitLabel="Cancel reservation" variant="danger" pendingLabel="Cancelling…">
                  <input type="hidden" name="reservationId" value={r.id} />
                  <Field id="cancelReason" label="Reason">
                    <Input id="cancelReason" name="reason" required />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardBody>
              <PriceBreakdown quote={reservationPrice(r, d.extras)} totalLabel="Rental total" />
              {r.lateFeeFils > 0 && <p className="mt-3 text-sm">Charges after return: {formatMoney(r.lateFeeFils)}</p>}
              {r.refundedFils > 0 && <p className="mt-1 text-sm">Refunded: {formatMoney(r.refundedFils)}</p>}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

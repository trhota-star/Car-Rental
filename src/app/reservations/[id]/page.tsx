import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatDateTime, formatMoney, labelFor } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { StatusBadge } from "@/components/status-badge";
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Container,
  DescriptionList,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  buttonClass,
} from "@/components/ui";
import { VehicleImage } from "@/components/vehicle-image";
import { timeSlots, utcToZoned, zonedToUtc, zonedToday } from "@/components/zoned-time";
import { requireUser } from "@/lib/auth-session";
import { previewCancellation, previewDateChange, type DateChangePreview } from "@/server/changes";
import { getDriverProfile } from "@/server/files";
import { getReservationForUser } from "@/server/reservations";
import { isHoldActive, reservationPrice, VOUCHER_STATUSES } from "../../_lib/reservation-view";
import { toActionError } from "../../_lib/service-errors";
import { CancelForm, ConfirmChangeForm } from "./manage-forms";

export const metadata: Metadata = { title: "Reservation" };

export default function ReservationPage(props: PageProps<"/reservations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <ReservationDetail {...props} />
    </Suspense>
  );
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function ReservationDetail({ params, searchParams }: PageProps<"/reservations/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/reservations/${id}`);
  const d = await getReservationForUser(id, user.id);
  if (!d) notFound();
  const r = d.reservation;
  const ptz = d.pickupBranch.timeZone;
  const rtz = d.returnBranch.timeZone;
  const manageable = (r.status === "PENDING" || r.status === "CONFIRMED") && r.pickupAt.getTime() > nowMs();

  const [cancelPreview, profile] = await Promise.all([
    manageable ? previewCancellation(r.id, user.id) : Promise.resolve(null),
    getDriverProfile(user.id),
  ]);

  // Date change preview when the "new dates" form was submitted.
  const cur = { p: utcToZoned(r.pickupAt, ptz), r: utcToZoned(r.returnAt, rtz) };
  const proposed = {
    pickupDate: str(sp.pickupDate) || cur.p.date,
    pickupTime: str(sp.pickupTime) || cur.p.time,
    returnDate: str(sp.returnDate) || cur.r.date,
    returnTime: str(sp.returnTime) || cur.r.time,
  };
  let change: DateChangePreview | null = null;
  let changeError: string | undefined;
  if (manageable && sp.change === "1") {
    const pickupAt = zonedToUtc(proposed.pickupDate, proposed.pickupTime, ptz);
    const returnAt = zonedToUtc(proposed.returnDate, proposed.returnTime, rtz);
    if (!pickupAt || !returnAt) changeError = "Please choose valid dates.";
    else if (pickupAt.getTime() === r.pickupAt.getTime() && returnAt.getTime() === r.returnAt.getTime()) changeError = "These are your current dates.";
    else {
      try {
        change = await previewDateChange({ reservationId: r.id, userId: user.id, pickupAt, returnAt });
        if (!change.available) changeError = "The car isn't available for those dates.";
      } catch (err) {
        changeError = toActionError(err, "reservation.preview_change", { reservationId: r.id }).message;
      }
    }
  }

  const deposit = d.deposit;
  const licenceKey = profile?.licenceFileKey;

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href="/reservations" className="hover:text-ink">
          ← My rentals
        </Link>
      </nav>
      <PageHeader
        title={`${d.vehicle.make} ${d.vehicle.model}`}
        description={
          <>
            Reference <span className="font-mono font-semibold text-ink" data-testid="reservation-reference">{r.reference}</span>
          </>
        }
        actions={
          <>
            <StatusBadge status={r.status} />
            {VOUCHER_STATUSES.has(r.status) && <ButtonLink href={`/reservations/${r.id}/voucher`}>Pick-up voucher</ButtonLink>}
            {isHoldActive(r) && <ButtonLink href={`/checkout/${r.id}`}>Complete payment</ButtonLink>}
          </>
        }
      />

      {sp.cancelled === "1" && r.status !== "CONFIRMED" && (
        <Alert tone="success" title="Reservation cancelled" className="mb-6">
          {r.cancellationFeeFils > 0 ? `Cancellation fee kept: ${formatMoney(r.cancellationFeeFils, r.currency)}. ` : "No cancellation fee. "}
          Refund: <span data-testid="refund-amount">{formatMoney(r.refundedFils, r.currency)}</span>
          {r.refundedFils > 0 ? " to your original payment method." : "."}
          {deposit ? ` Security deposit: ${labelFor(deposit.status).toLowerCase()}.` : ""}
        </Alert>
      )}
      {sp.changed === "1" && (
        <Alert tone="success" title="Dates updated" className="mb-6">
          Your booking now runs from {formatDateTime(r.pickupAt, ptz)} to {formatDateTime(r.returnAt, rtz)}.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row">
              <VehicleImage vehicle={d.vehicle} className="h-28 w-full shrink-0 rounded-xl sm:w-48" />
              <DescriptionList
                items={[
                  { label: "Pick-up", value: <>{formatDateTime(r.pickupAt, ptz)}<br />{d.pickupBranch.name}</> },
                  { label: "Return", value: <>{formatDateTime(r.returnAt, rtz)}<br />{d.returnBranch.name}</> },
                  { label: "Category", value: d.category.name },
                  { label: "Driver", value: `${r.driverName} · ${r.driverPhone}` },
                  {
                    label: "Driving licence",
                    value: licenceKey ? (
                      <a href={`/api/files?key=${encodeURIComponent(licenceKey)}`} target="_blank" rel="noopener" className="text-brand-700 hover:underline">
                        View uploaded licence
                      </a>
                    ) : (
                      "Not uploaded"
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>

          {manageable && (
            <Card>
              <CardHeader>
                <CardTitle>Change dates</CardTitle>
                <p className="mt-1 text-xs text-muted">Same car and branches. Times are local to each branch.</p>
              </CardHeader>
              <CardBody className="space-y-4">
                <Form action={`/reservations/${r.id}`} scroll={false} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="change" value="1" />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Field id="pickupDate" label="New pick-up date">
                      <Input id="pickupDate" type="date" name="pickupDate" min={zonedToday(ptz)} defaultValue={proposed.pickupDate} required />
                    </Field>
                    <Field id="pickupTime" label="Time">
                      <Select id="pickupTime" name="pickupTime" defaultValue={proposed.pickupTime}>
                        {timeSlots(d.pickupBranch.opensAtMinute, d.pickupBranch.closesAtMinute).map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Field id="returnDate" label="New return date">
                      <Input id="returnDate" type="date" name="returnDate" min={zonedToday(ptz)} defaultValue={proposed.returnDate} required />
                    </Field>
                    <Field id="returnTime" label="Time">
                      <Select id="returnTime" name="returnTime" defaultValue={proposed.returnTime}>
                        {timeSlots(d.returnBranch.opensAtMinute, d.returnBranch.closesAtMinute).map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" className={buttonClass("outline")}>
                      Check new price
                    </button>
                  </div>
                </Form>
                {changeError && <Alert tone="warning">{changeError}</Alert>}
                {change && change.available && (
                  <div className="space-y-4 rounded-xl border border-line p-4">
                    <PriceBreakdown quote={change.newQuote} title="New price" totalLabel="New total" />
                    <p className="text-sm">
                      {change.amountDueFils > 0 ? (
                        <>To pay now: <strong>{formatMoney(change.amountDueFils)}</strong></>
                      ) : change.refundFils > 0 ? (
                        <>We&apos;ll refund: <strong>{formatMoney(change.refundFils)}</strong></>
                      ) : (
                        "No price difference."
                      )}
                    </p>
                    <ConfirmChangeForm reservationId={r.id} window={proposed} amountDueFils={change.amountDueFils} refundFils={change.refundFils} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {manageable && cancelPreview && (
            <Card>
              <CardHeader>
                <CardTitle>Cancel booking</CardTitle>
              </CardHeader>
              <CardBody>
                {cancelPreview.eligible ? (
                  <CancelForm reservationId={r.id} feeFils={cancelPreview.feeFils} refundFils={cancelPreview.refundFils} free={cancelPreview.free} />
                ) : (
                  <p className="text-sm text-muted">This booking can no longer be cancelled{cancelPreview.reason ? `: ${cancelPreview.reason}` : ""}.</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardBody>
              <PriceBreakdown quote={reservationPrice(r, d.extras)} totalLabel="Rental total" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {d.payments.length === 0 && <p className="text-muted">No payments yet.</p>}
              {d.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {p.purpose === "CHARGE" ? "Rental payment" : "Additional charge"}
                    <span className="block text-xs text-muted">{formatDateTime(p.createdAt, ptz)}</span>
                  </span>
                  <span className="text-right">
                    {formatMoney(p.amountFils, p.currency)}
                    <span className="block">
                      <StatusBadge status={p.status} />
                    </span>
                    {p.refundedFils > 0 && <span className="block text-xs text-muted">Refunded {formatMoney(p.refundedFils, p.currency)}</span>}
                  </span>
                </div>
              ))}
              {deposit && (
                <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span>Security deposit</span>
                  <span className="text-right">
                    {formatMoney(deposit.amountFils, deposit.currency)}
                    <span className="block">
                      <StatusBadge status={deposit.status} />
                    </span>
                    {deposit.capturedFils > 0 && <span className="block text-xs text-muted">Captured {formatMoney(deposit.capturedFils, deposit.currency)}</span>}
                  </span>
                </div>
              )}
              {r.lateFeeFils > 0 && (
                <div className="flex justify-between border-t border-line pt-3">
                  <span>Charges after return</span>
                  <span>{formatMoney(r.lateFeeFils, r.currency)}</span>
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function nowMs() {
  return Date.now();
}

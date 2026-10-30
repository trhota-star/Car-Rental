import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDateTime } from "@/components/format";
import { HoldCountdown } from "@/components/hold-countdown";
import { PriceBreakdown } from "@/components/price-breakdown";
import { StatusBadge } from "@/components/status-badge";
import { Alert, ButtonLink, Card, CardBody, CardHeader, CardTitle, Container, DescriptionList, PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth-session";
import { getReservationForUser } from "@/server/reservations";
import { isHoldActive, reservationPrice, VOUCHER_STATUSES } from "../../_lib/reservation-view";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Payment" };

export default function PaymentPage({ params }: PageProps<"/checkout/[reservationId]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Payment params={params} />
    </Suspense>
  );
}

async function Payment({ params }: Pick<PageProps<"/checkout/[reservationId]">, "params">) {
  const { reservationId } = await params;
  const user = await requireUser(`/checkout/${reservationId}`);
  const d = await getReservationForUser(reservationId, user.id);
  if (!d) notFound();
  const r = d.reservation;
  if (VOUCHER_STATUSES.has(r.status)) redirect(`/reservations/${r.id}/voucher`);

  const pickupTz = d.pickupBranch.timeZone;
  const holdActive = isHoldActive(r);

  return (
    <Container className="py-8">
      <PageHeader
        eyebrow="Step 3 of 3"
        title="Payment"
        description={
          <>
            Reference <span className="font-mono font-semibold text-ink" data-testid="reservation-reference">{r.reference}</span>
          </>
        }
        actions={<StatusBadge status={r.status} />}
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {holdActive ? (
            <Alert tone="info" title="Your car is on hold">
              We&apos;re holding this car for you for <HoldCountdown expiresAt={r.holdExpiresAt!.toISOString()} /> minutes. Complete payment
              before the hold ends.
            </Alert>
          ) : r.status === "PENDING" ? (
            <Alert tone="warning" title="Your hold has ended">
              The hold on this car has expired. Please start a new booking.
            </Alert>
          ) : (
            <Alert tone="warning" title="This reservation can't be paid">
              Its status is <StatusBadge status={r.status} />. Please start a new booking.
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Pay securely</CardTitle>
            </CardHeader>
            <CardBody>
              {holdActive ? (
                <PaymentForm reservationId={r.id} totalFils={r.totalFils} depositFils={r.depositFils} currency={r.currency} />
              ) : (
                <ButtonLink href={`/vehicles/${d.vehicle.id}`}>Book this car again</ButtonLink>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>
                {d.vehicle.make} {d.vehicle.model}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  { label: "Pick-up", value: <>{formatDateTime(r.pickupAt, pickupTz)}<br />{d.pickupBranch.name}</> },
                  { label: "Return", value: <>{formatDateTime(r.returnAt, d.returnBranch.timeZone)}<br />{d.returnBranch.name}</> },
                  { label: "Driver", value: r.driverName },
                ]}
              />
              <PriceBreakdown quote={reservationPrice(r, d.extras)} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}

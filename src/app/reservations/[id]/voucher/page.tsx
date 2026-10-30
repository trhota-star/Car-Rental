import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { formatDateTime, formatMoney, labelFor, openingHours } from "@/components/format";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { StatusBadge } from "@/components/status-badge";
import { Alert, ButtonLink, Card, CardBody, Container, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth-session";
import { getReservationForUser } from "@/server/reservations";
import { VOUCHER_STATUSES } from "../../../_lib/reservation-view";

export const metadata: Metadata = { title: "Pick-up voucher" };

export default function VoucherPage(props: PageProps<"/reservations/[id]/voucher">) {
  return (
    <Suspense fallback={<PageSkeleton cards={1} />}>
      <Voucher {...props} />
    </Suspense>
  );
}

async function Voucher({ params, searchParams }: PageProps<"/reservations/[id]/voucher">) {
  const { id } = await params;
  const isNew = (await searchParams).new === "1";
  const user = await requireUser(`/reservations/${id}/voucher`);
  const d = await getReservationForUser(id, user.id);
  if (!d) notFound();
  const r = d.reservation;

  if (!VOUCHER_STATUSES.has(r.status)) {
    return (
      <Container className="py-8">
        <Alert tone="warning" title="No voucher for this reservation">
          A pick-up voucher is issued once payment is confirmed. Current status: <StatusBadge status={r.status} />
        </Alert>
        <div className="mt-4 flex gap-2">
          {r.status === "PENDING" && <ButtonLink href={`/checkout/${r.id}`}>Complete payment</ButtonLink>}
          <ButtonLink href={`/reservations/${r.id}`} variant="outline">
            View reservation
          </ButtonLink>
        </div>
      </Container>
    );
  }

  // QR code rendered on the server as SVG; it only carries the booking reference.
  const qrSvg = await QRCode.toString(`DRIVEEASY:${r.reference}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 220 });
  const tz = d.pickupBranch.timeZone;

  return (
    <Container className="max-w-3xl py-8">
      {isNew && (
        <Alert tone="success" title="Booking confirmed" className="no-print mb-6">
          Payment received and deposit held. Show this voucher at the counter when you collect the car.
        </Alert>
      )}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-brand-900 px-6 py-4 text-white">
          <span className="[&_span]:text-white">
            <Logo />
          </span>
          <span className="text-sm font-medium uppercase tracking-wider text-brand-200">Pick-up voucher</span>
        </div>
        <CardBody className="grid gap-6 p-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Reservation reference</p>
              <p className="font-mono text-3xl font-bold tracking-wider" data-testid="reservation-reference">
                {r.reference}
              </p>
              <div className="mt-1">
                <StatusBadge status={r.status} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Pick-up</p>
                <p className="font-semibold">{formatDateTime(r.pickupAt, tz)}</p>
                <p className="text-sm">{d.pickupBranch.name}</p>
                <p className="text-xs text-muted">{d.pickupBranch.address}</p>
                <p className="text-xs text-muted">{openingHours(d.pickupBranch.opensAtMinute, d.pickupBranch.closesAtMinute)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Return</p>
                <p className="font-semibold">{formatDateTime(r.returnAt, d.returnBranch.timeZone)}</p>
                <p className="text-sm">{d.returnBranch.name}</p>
                <p className="text-xs text-muted">{d.returnBranch.address}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Vehicle</p>
                <p className="font-semibold">
                  {d.vehicle.make} {d.vehicle.model}
                </p>
                <p className="text-sm text-muted">
                  {d.category.name} · {labelFor(d.vehicle.transmission)} · {d.vehicle.seats} seats
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Driver</p>
                <p className="font-semibold">{r.driverName}</p>
                <p className="text-sm text-muted">Bring your driving licence and the card used to pay.</p>
              </div>
            </div>
            {d.extras.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Extras</p>
                <p className="text-sm">{d.extras.map((e) => (e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name)).join(", ")}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-4 text-sm">
              <span>
                Paid: <strong>{formatMoney(r.totalFils, r.currency)}</strong>
              </span>
              <span>
                Deposit held: <strong>{formatMoney(r.depositFils, r.currency)}</strong>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div
              className="size-[220px] rounded-xl border border-line bg-white p-2 [&_svg]:size-full"
              data-testid="voucher-qr"
              role="img"
              aria-label={`QR code for reservation ${r.reference}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="text-xs text-muted">Scan at the counter</p>
          </div>
        </CardBody>
      </Card>
      <div className="no-print mt-6 flex flex-wrap gap-2">
        <PrintButton />
        <ButtonLink href={`/reservations/${r.id}`} variant="outline">
          Manage reservation
        </ButtonLink>
        <ButtonLink href="/reservations" variant="ghost">
          All my rentals
        </ButtonLink>
      </div>
    </Container>
  );
}

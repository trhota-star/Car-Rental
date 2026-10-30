import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDateTime, formatMoney } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { ButtonLink, Container, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { VehicleImage } from "@/components/vehicle-image";
import { requireUser } from "@/lib/auth-session";
import { listReservationsForUser } from "@/server/reservations";

export const metadata: Metadata = { title: "My rentals" };

export default function ReservationsPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={3} />}>
      <Reservations />
    </Suspense>
  );
}

const UPCOMING = new Set(["PENDING", "CONFIRMED", "PICKED_UP"]);

async function Reservations() {
  const user = await requireUser("/reservations");
  const rows = await listReservationsForUser(user.id);
  const upcoming = rows.filter((r) => UPCOMING.has(r.reservation.status)).reverse();
  const past = rows.filter((r) => !UPCOMING.has(r.reservation.status));

  return (
    <Container className="py-8">
      <PageHeader
        title="My rentals"
        description="View, change or cancel your bookings."
        actions={<ButtonLink href="/search">Book a car</ButtonLink>}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No rentals yet"
          description="When you book a car it will appear here with your voucher."
          action={<ButtonLink href="/search">Find a car</ButtonLink>}
        />
      ) : (
        <div className="space-y-10">
          <Section title="Upcoming and active" rows={upcoming} empty="No upcoming rentals." />
          <Section title="Past and cancelled" rows={past} empty="Nothing here yet." />
        </div>
      )}
    </Container>
  );
}

type Row = Awaited<ReturnType<typeof listReservationsForUser>>[number];

function Section({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <section aria-labelledby={`h-${title}`}>
      <h2 id={`h-${title}`} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ reservation: r, vehicle, pickupBranch, returnBranch }) => (
            <li key={r.id}>
              <Link
                href={`/reservations/${r.id}`}
                data-testid="reservation-row"
                className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center"
              >
                <VehicleImage vehicle={{ ...vehicle, color: null }} className="h-20 w-full shrink-0 rounded-xl sm:w-32" />
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {vehicle.make} {vehicle.model}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="font-mono text-xs text-muted">{r.reference}</p>
                  <p className="text-sm text-slate-700">
                    {formatDateTime(r.pickupAt, pickupBranch.timeZone)} · {pickupBranch.name}
                    <span className="text-muted"> → </span>
                    {formatDateTime(r.returnAt, returnBranch.timeZone)} · {returnBranch.name}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatMoney(r.totalFils, r.currency)}</p>
                  {r.refundedFils > 0 && <p className="text-xs text-muted">Refunded {formatMoney(r.refundedFils, r.currency)}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

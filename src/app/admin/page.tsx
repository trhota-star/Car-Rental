import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDateTime } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, PageSkeleton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth-session";
import { listReservations } from "@/server/admin/operations";
import { listDamageReports } from "@/server/admin/operations";
import { listFleet } from "@/server/admin/catalog";

export const metadata: Metadata = { title: "Admin" };

export default function AdminHome() {
  return (
    <Suspense fallback={<PageSkeleton cards={3} />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const admin = await requireAdmin("/admin");
  const [confirmed, onRent, pending, fleet, damage] = await Promise.all([
    listReservations(admin.id, { status: "CONFIRMED", limit: 200 }),
    listReservations(admin.id, { status: "PICKED_UP", limit: 200 }),
    listReservations(admin.id, { status: "PENDING", limit: 200 }),
    listFleet(admin.id),
    listDamageReports(admin.id, { status: "OPEN" }),
  ]);
  const upcoming = [...confirmed].sort((a, b) => a.reservation.pickupAt.getTime() - b.reservation.pickupAt.getTime()).slice(0, 8);
  const dueBack = [...onRent].sort((a, b) => a.reservation.returnAt.getTime() - b.reservation.returnAt.getTime()).slice(0, 8);

  const stats = [
    { label: "Upcoming pick-ups", value: confirmed.length, href: "/admin/reservations?status=CONFIRMED" },
    { label: "On rent", value: onRent.length, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Awaiting payment", value: pending.length, href: "/admin/reservations?status=PENDING" },
    { label: "Fleet size", value: fleet.filter((f) => f.vehicle.status !== "RETIRED").length, href: "/admin/fleet" },
    { label: "Open damage reports", value: damage.length, href: "/admin/damage" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Operations overview" description="Today's work at a glance. Times shown in each branch's time zone." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-2xl border border-line bg-surface p-4 shadow-sm hover:shadow-md">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <List title="Next pick-ups" rows={upcoming} when={(r) => r.reservation.pickupAt} empty="No upcoming pick-ups." />
        <List title="Due back" rows={dueBack} when={(r) => r.reservation.returnAt} empty="No cars on rent." />
      </div>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof listReservations>>[number];

function List({ title, rows, when, empty }: { title: string; rows: Row[]; when: (r: Row) => Date; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.reservation.id}>
                <Link href={`/admin/reservations/${r.reservation.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                  <span>
                    <span className="font-mono text-xs">{r.reservation.reference}</span>
                    <span className="block font-medium">
                      {r.vehicle.make} {r.vehicle.model} · {r.vehicle.plateNumber}
                    </span>
                    <span className="block text-xs text-muted">
                      {r.customer.name} · {r.pickupBranch.name}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    {formatDateTime(when(r), r.pickupBranch.timeZone)}
                    <span className="mt-1 block">
                      <StatusBadge status={r.reservation.status} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

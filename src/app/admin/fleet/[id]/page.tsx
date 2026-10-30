import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { formatDateTime } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, PageSkeleton } from "@/components/ui";
import { timeSlots, zonedToday } from "@/components/zoned-time";
import { requireAdmin } from "@/lib/auth-session";
import { listAllBranches } from "@/server/admin/catalog";
import { listDamageReports, listMaintenanceBlocks, listReservations } from "@/server/admin/operations";
import { getVehicle, getVehicleCalendar } from "@/server/availability";
import { listCategories, listFeatures } from "@/server/catalog";
import { cancelBlockAction, createBlockAction } from "../../actions";
import { ActionForm } from "../../_lib/action-form";
import { DamageForm, DamageList } from "../../_lib/damage";
import { VehicleForm } from "../../_lib/vehicle-form";

export const metadata: Metadata = { title: "Admin · Vehicle" };

export default function AdminVehiclePage({ params }: PageProps<"/admin/fleet/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <VehicleAdmin params={params} />
    </Suspense>
  );
}

async function VehicleAdmin({ params }: Pick<PageProps<"/admin/fleet/[id]">, "params">) {
  const { id } = await params;
  const admin = await requireAdmin(`/admin/fleet/${id}`);
  const data = await getVehicle(id);
  if (!data) notFound();
  const { vehicle: v, branch, features: vf } = data;
  const tz = branch.timeZone;
  const [branches, categories, features, blocks, damage, calendar, reservations] = await Promise.all([
    listAllBranches(admin.id),
    listCategories(),
    listFeatures(),
    listMaintenanceBlocks(admin.id, { vehicleId: v.id }),
    listDamageReports(admin.id, { vehicleId: v.id }),
    getVehicleCalendar(v.id, { from: zonedToday(tz) }),
    listReservations(admin.id, { vehicleId: v.id, limit: 20 }),
  ]);
  const slots = timeSlots();

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/fleet" className="hover:text-ink">
          ← Fleet
        </Link>
      </nav>
      <PageHeader
        eyebrow={`${branch.name} · ${v.plateNumber}`}
        title={`${v.make} ${v.model} (${v.year})`}
        actions={<StatusBadge status={v.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Vehicle details</CardTitle>
        </CardHeader>
        <CardBody>
          <VehicleForm vehicle={v} featureIds={vf.map((f) => f.id)} branches={branches} categories={categories} features={features} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
        </CardHeader>
        <CardBody>
          <AvailabilityCalendar days={calendar.days} timeZone={calendar.timeZone} />
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Maintenance blocks</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {blocks.length === 0 ? (
              <p className="text-sm text-muted">No maintenance scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {blocks.map(({ block: b }) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                    <span>
                      {formatDateTime(b.startsAt, tz)} → {formatDateTime(b.endsAt, tz)}
                      <span className="block text-xs text-muted">{b.reason}</span>
                    </span>
                    <ActionForm action={cancelBlockAction} submitLabel="Cancel block" variant="outline" className="flex items-center gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="vehicleId" value={v.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium">Block dates for maintenance</summary>
              <div className="mt-4">
                <ActionForm action={createBlockAction} submitLabel="Add maintenance block">
                  <input type="hidden" name="vehicleId" value={v.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="startDate" label="From date">
                      <Input id="startDate" name="startDate" type="date" required />
                    </Field>
                    <Field id="startTime" label="From time">
                      <select id="startTime" name="startTime" className="h-10 w-full rounded-lg border border-line bg-white px-2 text-sm" defaultValue="08:00">
                        {slots.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id="endDate" label="Until date">
                      <Input id="endDate" name="endDate" type="date" required />
                    </Field>
                    <Field id="endTime" label="Until time">
                      <select id="endTime" name="endTime" className="h-10 w-full rounded-lg border border-line bg-white px-2 text-sm" defaultValue="18:00">
                        {slots.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field id="reason" label="Reason">
                    <Input id="reason" name="reason" required placeholder="e.g. 20,000 km service" />
                  </Field>
                </ActionForm>
              </div>
            </details>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent reservations</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {reservations.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No reservations yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {reservations.map(({ reservation: r, customer }) => (
                  <li key={r.id}>
                    <Link href={`/admin/reservations/${r.id}`} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                      <span>
                        <span className="font-mono text-xs">{r.reference}</span>
                        <span className="block">{customer.name}</span>
                        <span className="block text-xs text-muted">
                          {formatDateTime(r.pickupAt, tz)} → {formatDateTime(r.returnAt, tz)}
                        </span>
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Damage history</CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          <DamageList reports={damage} timeZone={tz} />
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium">Report damage (not linked to a rental)</summary>
            <div className="mt-4">
              <DamageForm vehicleId={v.id} defaultStage="OTHER" />
            </div>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}

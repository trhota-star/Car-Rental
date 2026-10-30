import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { formatDateTime, formatMoney, labelFor } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, EmptyState, Field, Input, PageHeader, PageSkeleton, Select, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth-session";
import { listReservations } from "@/server/admin/operations";
import { listAllBranches } from "@/server/admin/catalog";
import { Table, Td } from "../_lib/table";

export const metadata: Metadata = { title: "Admin · Reservations" };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const;
type Status = (typeof STATUSES)[number];

export default function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  return (
    <Suspense fallback={<PageSkeleton cards={1} />}>
      <Reservations searchParams={searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function Reservations({ searchParams }: Pick<PageProps<"/admin/reservations">, "searchParams">) {
  const admin = await requireAdmin("/admin/reservations");
  const sp = await searchParams;
  const status = STATUSES.includes(one(sp.status) as Status) ? (one(sp.status) as Status) : undefined;
  const branchId = one(sp.branch) || undefined;
  const reference = one(sp.reference).trim() || undefined;
  const branches = await listAllBranches(admin.id);
  const rows = await listReservations(admin.id, {
    status,
    branchId: branches.some((b) => b.id === branchId) ? branchId : undefined,
    reference,
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Reservations" description="Find a booking to check a car out, check it in or report damage." />
      <Card>
        <CardBody>
          <Form action="/admin/reservations" className="grid gap-3 sm:grid-cols-4">
            <Field id="reference" label="Reference">
              <Input id="reference" name="reference" placeholder="DE-…" defaultValue={reference ?? ""} />
            </Field>
            <Field id="status" label="Status">
              <Select id="status" name="status" defaultValue={status ?? ""}>
                <option value="">Any</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labelFor(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="branch" label="Pick-up branch">
              <Select id="branch" name="branch" defaultValue={branchId ?? ""}>
                <option value="">Any</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <button type="submit" className={buttonClass("primary", "md", "w-full")}>
                Filter
              </button>
            </div>
          </Form>
        </CardBody>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="No reservations match" description="Try another status, branch or reference." />
      ) : (
        <Table head={["Reference", "Customer", "Vehicle", "Pick-up", "Return", "Total", "Status"]} caption="Reservations">
          {rows.map(({ reservation: r, vehicle, customer, pickupBranch }) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/reservations/${r.id}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {r.reference}
                </Link>
              </Td>
              <Td>
                {customer.name}
                <span className="block text-xs text-muted">{customer.email}</span>
              </Td>
              <Td>
                {vehicle.make} {vehicle.model}
                <span className="block text-xs text-muted">{vehicle.plateNumber}</span>
              </Td>
              <Td className="whitespace-nowrap">
                {formatDateTime(r.pickupAt, pickupBranch.timeZone)}
                <span className="block text-xs text-muted">{pickupBranch.name}</span>
              </Td>
              <Td className="whitespace-nowrap">{formatDateTime(r.returnAt, pickupBranch.timeZone)}</Td>
              <Td className="whitespace-nowrap">{formatMoney(r.totalFils, r.currency)}</Td>
              <Td>
                <StatusBadge status={r.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

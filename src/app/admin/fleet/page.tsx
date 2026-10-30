import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { labelFor } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Field, PageHeader, PageSkeleton, Select, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth-session";
import { listAllBranches, listFleet } from "@/server/admin/catalog";
import { listCategories, listFeatures } from "@/server/catalog";
import { Table, Td } from "../_lib/table";
import { VehicleForm } from "../_lib/vehicle-form";

export const metadata: Metadata = { title: "Admin · Fleet" };

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"] as const;
type Status = (typeof STATUSES)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function FleetPage({ searchParams }: PageProps<"/admin/fleet">) {
  return (
    <Suspense fallback={<PageSkeleton cards={1} />}>
      <Fleet searchParams={searchParams} />
    </Suspense>
  );
}

async function Fleet({ searchParams }: Pick<PageProps<"/admin/fleet">, "searchParams">) {
  const admin = await requireAdmin("/admin/fleet");
  const sp = await searchParams;
  const [branches, categories, features] = await Promise.all([listAllBranches(admin.id), listCategories(), listFeatures()]);
  const branchId = branches.some((b) => b.id === one(sp.branch)) ? one(sp.branch) : undefined;
  const categoryId = categories.some((c) => c.id === one(sp.category)) ? one(sp.category) : undefined;
  const status = STATUSES.includes(one(sp.status) as Status) ? (one(sp.status) as Status) : undefined;
  const fleet = await listFleet(admin.id, { branchId, categoryId, status });

  return (
    <div className="space-y-6">
      <PageHeader title="Fleet" description={`${fleet.length} vehicles`} />
      <Card>
        <CardBody>
          <Form action="/admin/fleet" className="grid gap-3 sm:grid-cols-4">
            <Field id="branch" label="Branch">
              <Select id="branch" name="branch" defaultValue={branchId ?? ""}>
                <option value="">Any</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="category" label="Category">
              <Select id="category" name="category" defaultValue={categoryId ?? ""}>
                <option value="">Any</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
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
            <div className="flex items-end">
              <button type="submit" className={buttonClass("primary", "md", "w-full")}>
                Filter
              </button>
            </div>
          </Form>
        </CardBody>
      </Card>

      {fleet.length === 0 ? (
        <EmptyState title="No vehicles match" />
      ) : (
        <Table head={["Vehicle", "Plate", "Category", "Branch", "Specs", "Odometer", "Status"]} caption="Fleet">
          {fleet.map(({ vehicle: v, category, branch }) => (
            <tr key={v.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">
                  {v.make} {v.model}
                </Link>
                <span className="block text-xs text-muted">
                  {v.year}
                  {v.color ? ` · ${v.color}` : ""}
                </span>
              </Td>
              <Td className="font-mono whitespace-nowrap">{v.plateNumber}</Td>
              <Td>{category.name}</Td>
              <Td>{branch.name}</Td>
              <Td className="text-xs whitespace-nowrap">
                {v.seats} seats · {labelFor(v.transmission)} · {labelFor(v.fuelType)}
              </Td>
              <Td className="whitespace-nowrap">{v.mileageKm.toLocaleString()} km</Td>
              <Td>
                <StatusBadge status={v.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a vehicle</CardTitle>
        </CardHeader>
        <CardBody>
          {branches.length === 0 || categories.length === 0 ? (
            <p className="text-sm text-muted">Create a branch and a category first.</p>
          ) : (
            <VehicleForm branches={branches} categories={categories} features={features} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

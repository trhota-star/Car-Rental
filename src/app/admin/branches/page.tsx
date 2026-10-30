import type { Metadata } from "next";
import { Suspense } from "react";
import { formatMoney, minutesToTime, openingHours } from "@/components/format";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, PageSkeleton } from "@/components/ui";
import type { Branch } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-session";
import { listAllBranches } from "@/server/admin/catalog";
import { createBranchAction, updateBranchAction } from "../actions";
import { ActionForm } from "../_lib/action-form";
import { filsToAed } from "../_lib/form-data";

export const metadata: Metadata = { title: "Admin · Branches" };

export default function AdminBranchesPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Branches />
    </Suspense>
  );
}

async function Branches() {
  const admin = await requireAdmin("/admin/branches");
  const branches = await listAllBranches(admin.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Branches" description="Opening hours are in each branch's own time zone." />
      <ul className="space-y-3">
        {branches.map((b) => (
          <li key={b.id}>
            <details className="group rounded-2xl border border-line bg-surface shadow-sm">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span>
                  <span className="font-semibold">{b.name}</span> <span className="font-mono text-xs text-muted">{b.code}</span>
                  <span className="block text-xs text-muted">
                    {b.city}, {b.emirate} · {openingHours(b.opensAtMinute, b.closesAtMinute)} · VAT {b.vatRateBp / 100}% · one-way fee{" "}
                    {formatMoney(b.oneWayFeeFils)}
                  </span>
                </span>
                <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? "Active" : "Inactive"}</Badge>
              </summary>
              <div className="border-t border-line px-5 py-4">
                <BranchForm branch={b} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Card>
        <CardHeader>
          <CardTitle>Add a branch</CardTitle>
        </CardHeader>
        <CardBody>
          <BranchForm />
        </CardBody>
      </Card>
    </div>
  );
}

function BranchForm({ branch: b }: { branch?: Branch }) {
  const p = b ? `b-${b.code}-` : "new-";
  const allDay = b ? b.opensAtMinute === 0 && b.closesAtMinute >= 1440 : false;
  return (
    <ActionForm action={b ? updateBranchAction : createBranchAction} submitLabel={b ? "Save branch" : "Add branch"}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={`${p}code`} label="Code">
          <Input id={`${p}code`} name="code" required defaultValue={b?.code} className="uppercase" placeholder="DXB-APT" />
        </Field>
        <Field id={`${p}name`} label="Name">
          <Input id={`${p}name`} name="name" required defaultValue={b?.name} />
        </Field>
        <Field id={`${p}phone`} label="Phone">
          <Input id={`${p}phone`} name="phone" type="tel" defaultValue={b?.phone ?? ""} />
        </Field>
        <Field id={`${p}city`} label="City">
          <Input id={`${p}city`} name="city" required defaultValue={b?.city} />
        </Field>
        <Field id={`${p}emirate`} label="Emirate">
          <Input id={`${p}emirate`} name="emirate" required defaultValue={b?.emirate} />
        </Field>
        <Field id={`${p}tz`} label="Time zone (IANA)">
          <Input id={`${p}tz`} name="timeZone" required defaultValue={b?.timeZone ?? "Asia/Dubai"} />
        </Field>
        <Field id={`${p}address`} label="Address" className="sm:col-span-2 lg:col-span-3">
          <Input id={`${p}address`} name="address" required defaultValue={b?.address} />
        </Field>
        <Field id={`${p}opens`} label="Opens at">
          <Input id={`${p}opens`} name="opensAt" type="time" step={60} defaultValue={minutesToTime(b?.opensAtMinute ?? 480)} />
        </Field>
        <Field id={`${p}closes`} label="Closes at" hint="23:59 means midnight">
          <Input id={`${p}closes`} name="closesAt" type="time" step={60} defaultValue={minutesToTime(Math.min(b?.closesAtMinute ?? 1320, 1439))} />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allDay" defaultChecked={allDay} className="size-4 accent-brand-600" />
            Open 24 hours
          </label>
        </div>
        <Field id={`${p}vat`} label="VAT (%)">
          <Input id={`${p}vat`} name="vatPercent" type="number" min={0} max={100} step={0.01} defaultValue={b ? b.vatRateBp / 100 : 5} />
        </Field>
        <Field id={`${p}oneway`} label="One-way drop-off fee (AED)">
          <Input id={`${p}oneway`} name="oneWayFee" inputMode="decimal" defaultValue={filsToAed(b?.oneWayFeeFils ?? 0)} />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} className="size-4 accent-brand-600" />
            Active (accepting rentals)
          </label>
        </div>
      </div>
    </ActionForm>
  );
}

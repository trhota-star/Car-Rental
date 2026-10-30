import type { Metadata } from "next";
import { Suspense } from "react";
import { formatMoney, labelFor } from "@/components/format";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, PageSkeleton, Select, Textarea } from "@/components/ui";
import type { Branch, Extra, PricingRule, VehicleCategory } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-session";
import { listAllBranches, listAllExtras, listFleet, listPricingRules } from "@/server/admin/catalog";
import { listCategories } from "@/server/catalog";
import {
  createCategoryAction,
  createExtraAction,
  createRuleAction,
  deleteRuleAction,
  updateCategoryAction,
  updateExtraAction,
  updateRuleAction,
} from "../actions";
import { ActionForm } from "../_lib/action-form";
import { filsToAed } from "../_lib/form-data";

export const metadata: Metadata = { title: "Admin · Pricing & extras" };

export default function PricingPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={3} />}>
      <Pricing />
    </Suspense>
  );
}

type VehicleOption = { id: string; label: string };

async function Pricing() {
  const admin = await requireAdmin("/admin/pricing");
  const [rules, extras, categories, branches, fleet] = await Promise.all([
    listPricingRules(admin.id),
    listAllExtras(admin.id),
    listCategories(),
    listAllBranches(admin.id),
    listFleet(admin.id),
  ]);
  const vehicles: VehicleOption[] = fleet.map((f) => ({ id: f.vehicle.id, label: `${f.vehicle.make} ${f.vehicle.model} · ${f.vehicle.plateNumber}` }));
  const target = (r: PricingRule) =>
    r.vehicleId ? (vehicles.find((v) => v.id === r.vehicleId)?.label ?? "Vehicle") : (categories.find((c) => c.id === r.categoryId)?.name ?? "Category");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pricing & extras"
        description="Daily rates come from the most specific active rule: vehicle over category, branch over any branch, longer minimum stay, then priority."
      />

      <section className="space-y-3" aria-labelledby="rules-h">
        <h2 id="rules-h" className="text-lg font-semibold">
          Daily rate rules
        </h2>
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id}>
              <details className="rounded-2xl border border-line bg-surface shadow-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted">
                      {target(r)} · {r.branchId ? branches.find((b) => b.id === r.branchId)?.name : "all branches"} · {r.minDays}+ days
                      {r.validFrom || r.validTo ? ` · ${r.validFrom ?? "…"} to ${r.validTo ?? "…"}` : ""} · priority {r.priority}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{formatMoney(r.dailyRateFils)}/day</span>
                    <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                  </span>
                </summary>
                <div className="space-y-4 border-t border-line px-5 py-4">
                  <RuleForm rule={r} categories={categories} branches={branches} vehicles={vehicles} />
                  <ActionForm action={deleteRuleAction} submitLabel="Delete rule" variant="outline" pendingLabel="Deleting…">
                    <input type="hidden" name="id" value={r.id} />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <Card>
          <CardHeader>
            <CardTitle>Add a rate rule</CardTitle>
          </CardHeader>
          <CardBody>
            <RuleForm categories={categories} branches={branches} vehicles={vehicles} />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="extras-h">
        <h2 id="extras-h" className="text-lg font-semibold">
          Extras
        </h2>
        <ul className="space-y-2">
          {extras.map((x) => (
            <li key={x.id}>
              <details className="rounded-2xl border border-line bg-surface shadow-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>
                    <span className="font-medium">{x.name}</span> <span className="font-mono text-xs text-muted">{x.code}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">
                      {formatMoney(x.priceFils)} {labelFor(x.pricing)}
                    </span>
                    <Badge tone={x.isActive ? "success" : "neutral"}>{x.isActive ? "Active" : "Inactive"}</Badge>
                  </span>
                </summary>
                <div className="border-t border-line px-5 py-4">
                  <ExtraForm extra={x} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <Card>
          <CardHeader>
            <CardTitle>Add an extra</CardTitle>
          </CardHeader>
          <CardBody>
            <ExtraForm />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="cats-h">
        <h2 id="cats-h" className="text-lg font-semibold">
          Categories and security deposits
        </h2>
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id}>
              <details className="rounded-2xl border border-line bg-surface shadow-sm">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-5 py-3">
                  <span className="font-medium">
                    {c.name} <span className="font-mono text-xs text-muted">{c.code}</span>
                  </span>
                  <span className="text-sm">Deposit {formatMoney(c.securityDepositFils)}</span>
                </summary>
                <div className="border-t border-line px-5 py-4">
                  <CategoryForm category={c} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <Card>
          <CardHeader>
            <CardTitle>Add a category</CardTitle>
          </CardHeader>
          <CardBody>
            <CategoryForm />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function RuleForm({
  rule: r,
  categories,
  branches,
  vehicles,
}: {
  rule?: PricingRule;
  categories: VehicleCategory[];
  branches: Branch[];
  vehicles: VehicleOption[];
}) {
  const p = r ? `r-${r.id.slice(0, 8)}-` : "rnew-";
  return (
    <ActionForm action={r ? updateRuleAction : createRuleAction} submitLabel={r ? "Save rule" : "Add rule"}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${p}name`} label="Name" className="sm:col-span-2">
          <Input id={`${p}name`} name="name" required defaultValue={r?.name} placeholder="e.g. Compact weekly" />
        </Field>
        <Field id={`${p}rate`} label="Daily rate (AED)">
          <Input id={`${p}rate`} name="dailyRate" inputMode="decimal" required defaultValue={filsToAed(r?.dailyRateFils)} />
        </Field>
        <Field id={`${p}min`} label="Minimum days">
          <Input id={`${p}min`} name="minDays" type="number" min={1} max={365} defaultValue={r?.minDays ?? 1} />
        </Field>
        <Field id={`${p}cat`} label="Category">
          <Select id={`${p}cat`} name="categoryId" defaultValue={r?.categoryId ?? ""}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}veh`} label="Or a specific vehicle">
          <Select id={`${p}veh`} name="vehicleId" defaultValue={r?.vehicleId ?? ""}>
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}branch`} label="Branch">
          <Select id={`${p}branch`} name="branchId" defaultValue={r?.branchId ?? ""}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}prio`} label="Priority">
          <Input id={`${p}prio`} name="priority" type="number" min={-1000} max={1000} defaultValue={r?.priority ?? 0} />
        </Field>
        <Field id={`${p}from`} label="Season from (optional)">
          <Input id={`${p}from`} name="validFrom" type="date" defaultValue={r?.validFrom ?? ""} />
        </Field>
        <Field id={`${p}to`} label="Season to (optional)">
          <Input id={`${p}to`} name="validTo" type="date" defaultValue={r?.validTo ?? ""} />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={r?.isActive ?? true} className="size-4 accent-brand-600" />
            Active
          </label>
        </div>
      </div>
    </ActionForm>
  );
}

function ExtraForm({ extra: x }: { extra?: Extra }) {
  const p = x ? `x-${x.code}-` : "xnew-";
  return (
    <ActionForm action={x ? updateExtraAction : createExtraAction} submitLabel={x ? "Save extra" : "Add extra"}>
      {x && <input type="hidden" name="id" value={x.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${p}code`} label="Code">
          <Input id={`${p}code`} name="code" required defaultValue={x?.code} readOnly={Boolean(x)} className="uppercase" placeholder="CHILD_SEAT" />
        </Field>
        <Field id={`${p}name`} label="Name">
          <Input id={`${p}name`} name="name" required defaultValue={x?.name} />
        </Field>
        <Field id={`${p}pricing`} label="Charged">
          <Select id={`${p}pricing`} name="pricing" defaultValue={x?.pricing ?? "PER_DAY"}>
            <option value="PER_DAY">Per day</option>
            <option value="PER_RENTAL">Per rental</option>
          </Select>
        </Field>
        <Field id={`${p}price`} label="Price (AED)">
          <Input id={`${p}price`} name="price" inputMode="decimal" required defaultValue={filsToAed(x?.priceFils)} />
        </Field>
        <Field id={`${p}max`} label="Cap per rental (AED, optional)">
          <Input id={`${p}max`} name="maxCharge" inputMode="decimal" defaultValue={filsToAed(x?.maxChargeFils)} />
        </Field>
        <Field id={`${p}qty`} label="Max quantity">
          <Input id={`${p}qty`} name="maxQuantity" type="number" min={1} max={10} defaultValue={x?.maxQuantity ?? 1} />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={x?.isActive ?? true} className="size-4 accent-brand-600" />
            Offered to customers
          </label>
        </div>
      </div>
      <Field id={`${p}desc`} label="Description">
        <Textarea id={`${p}desc`} name="description" rows={2} defaultValue={x?.description ?? ""} />
      </Field>
    </ActionForm>
  );
}

function CategoryForm({ category: c }: { category?: VehicleCategory }) {
  const p = c ? `c-${c.code}-` : "cnew-";
  return (
    <ActionForm action={c ? updateCategoryAction : createCategoryAction} submitLabel={c ? "Save category" : "Add category"}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${p}code`} label="Code">
          <Input id={`${p}code`} name="code" required defaultValue={c?.code} readOnly={Boolean(c)} placeholder="COMPACT" />
        </Field>
        <Field id={`${p}name`} label="Name">
          <Input id={`${p}name`} name="name" required defaultValue={c?.name} />
        </Field>
        <Field id={`${p}dep`} label="Security deposit (AED)">
          <Input id={`${p}dep`} name="deposit" inputMode="decimal" required defaultValue={filsToAed(c?.securityDepositFils ?? 0)} />
        </Field>
        <Field id={`${p}sort`} label="Sort order">
          <Input id={`${p}sort`} name="sortOrder" type="number" defaultValue={c?.sortOrder ?? 0} />
        </Field>
      </div>
      <Field id={`${p}desc`} label="Description">
        <Textarea id={`${p}desc`} name="description" rows={2} defaultValue={c?.description ?? ""} />
      </Field>
    </ActionForm>
  );
}

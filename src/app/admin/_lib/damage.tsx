import { formatDateTime, formatMoney, labelFor } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { listDamageReports } from "@/server/admin/operations";
import { createDamageAction, resolveDamageAction } from "../actions";
import { ActionForm } from "./action-form";

type Report = Awaited<ReturnType<typeof listDamageReports>>[number];

export function DamageList({ reports, timeZone, showVehicle = false }: { reports: Report[]; timeZone: string; showVehicle?: boolean }) {
  if (reports.length === 0) return <p className="text-sm text-muted">No damage reported.</p>;
  return (
    <ul className="space-y-4" data-testid="damage-list">
      {reports.map(({ report: d, vehicle }) => (
        <li key={d.id} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {labelFor(d.severity)} damage · {labelFor(d.stage)}
                {showVehicle && (
                  <span className="text-muted">
                    {" "}
                    · {vehicle.make} {vehicle.model} ({vehicle.plateNumber})
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">{formatDateTime(d.createdAt, timeZone)}</p>
            </div>
            <StatusBadge status={d.status} />
          </div>
          <p className="mt-2 text-sm">{d.description}</p>
          <p className="mt-1 text-xs text-muted">
            Repair estimate {formatMoney(d.repairCostFils)} · charged to customer {formatMoney(d.chargedFils)}
          </p>
          {d.imageKeys.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {d.imageKeys.map((key, i) => (
                <li key={key}>
                  <a href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noopener" className="block size-20 overflow-hidden rounded-lg border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image route */}
                    <img src={`/api/files?key=${encodeURIComponent(key)}`} alt={`Damage photo ${i + 1}`} className="size-full object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ActionForm action={resolveDamageAction} submitLabel={d.status === "OPEN" ? "Mark resolved" : "Reopen"} variant="outline">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="status" value={d.status === "OPEN" ? "RESOLVED" : "OPEN"} />
            </ActionForm>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DamageForm({ vehicleId, reservationId, defaultStage = "RETURN" }: { vehicleId: string; reservationId?: string; defaultStage?: string }) {
  return (
    <ActionForm action={createDamageAction} submitLabel="Save damage report" pendingLabel="Uploading…">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      {reservationId && <input type="hidden" name="reservationId" value={reservationId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="stage" label="Stage">
          <Select id="stage" name="stage" defaultValue={defaultStage}>
            <option value="PICKUP">At pick-up</option>
            <option value="RETURN">At return</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field id="severity" label="Severity">
          <Select id="severity" name="severity" defaultValue="MINOR">
            <option value="MINOR">Minor</option>
            <option value="MODERATE">Moderate</option>
            <option value="MAJOR">Major</option>
          </Select>
        </Field>
      </div>
      <Field id="damageDescription" label="Description">
        <Textarea id="damageDescription" name="description" rows={3} required minLength={3} placeholder="e.g. 10 cm scratch on rear left door" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="repairCost" label="Repair estimate (AED)">
          <Input id="repairCost" name="repairCost" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field id="charged" label="Charge to customer (AED)" hint="Recorded on the report. Use check-in to capture from the deposit.">
          <Input id="charged" name="charged" inputMode="decimal" placeholder="0.00" aria-describedby="charged-hint" />
        </Field>
      </div>
      <Field id="photos" label="Photos" hint="Up to 10 JPG, PNG or WebP images, max 5 MB each. Stored privately.">
        <Input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="photos-hint" />
      </Field>
    </ActionForm>
  );
}

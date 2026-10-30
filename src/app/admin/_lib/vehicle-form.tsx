import type { Branch, Vehicle, VehicleCategory } from "@/lib/db/schema";
import { labelFor } from "@/components/format";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { createVehicleAction, updateVehicleAction } from "../actions";
import { ActionForm } from "./action-form";

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"];

export function VehicleForm({
  vehicle,
  featureIds = [],
  branches,
  categories,
  features,
}: {
  vehicle?: Vehicle;
  featureIds?: string[];
  branches: Branch[];
  categories: VehicleCategory[];
  features: Array<{ id: string; name: string }>;
}) {
  const v = vehicle;
  const p = v ? `v-${v.id.slice(0, 8)}-` : "new-";
  return (
    <ActionForm action={v ? updateVehicleAction : createVehicleAction} submitLabel={v ? "Save vehicle" : "Add vehicle"}>
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${p}make`} label="Make">
          <Input id={`${p}make`} name="make" required defaultValue={v?.make} />
        </Field>
        <Field id={`${p}model`} label="Model">
          <Input id={`${p}model`} name="model" required defaultValue={v?.model} />
        </Field>
        <Field id={`${p}year`} label="Year">
          <Input id={`${p}year`} name="year" type="number" min={1990} max={2100} required defaultValue={v?.year ?? new Date().getFullYear()} />
        </Field>
        <Field id={`${p}color`} label="Colour">
          <Input id={`${p}color`} name="color" defaultValue={v?.color ?? ""} />
        </Field>
        <Field id={`${p}plate`} label="Plate number">
          <Input id={`${p}plate`} name="plateNumber" required defaultValue={v?.plateNumber} />
        </Field>
        <Field id={`${p}vin`} label="VIN">
          <Input id={`${p}vin`} name="vin" required minLength={17} maxLength={17} className="font-mono uppercase" defaultValue={v?.vin} />
        </Field>
        <Field id={`${p}category`} label="Category">
          <Select id={`${p}category`} name="categoryId" required defaultValue={v?.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}branch`} label="Home branch">
          <Select id={`${p}branch`} name="branchId" required defaultValue={v?.branchId}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}transmission`} label="Transmission">
          <Select id={`${p}transmission`} name="transmission" defaultValue={v?.transmission ?? "AUTOMATIC"}>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </Select>
        </Field>
        <Field id={`${p}fuel`} label="Fuel type">
          <Select id={`${p}fuel`} name="fuelType" defaultValue={v?.fuelType ?? "PETROL"}>
            {["PETROL", "DIESEL", "HYBRID", "ELECTRIC"].map((f) => (
              <option key={f} value={f}>
                {labelFor(f)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}seats`} label="Seats">
          <Input id={`${p}seats`} name="seats" type="number" min={1} max={15} required defaultValue={v?.seats ?? 5} />
        </Field>
        <Field id={`${p}doors`} label="Doors">
          <Input id={`${p}doors`} name="doors" type="number" min={2} max={6} defaultValue={v?.doors ?? 4} />
        </Field>
        <Field id={`${p}luggage`} label="Bags">
          <Input id={`${p}luggage`} name="luggage" type="number" min={0} max={20} defaultValue={v?.luggage ?? 2} />
        </Field>
        <Field id={`${p}mileage`} label="Odometer (km)">
          <Input id={`${p}mileage`} name="mileageKm" type="number" min={0} defaultValue={v?.mileageKm ?? 0} />
        </Field>
        <Field id={`${p}status`} label="Status">
          <Select id={`${p}status`} name="status" defaultValue={v?.status ?? "AVAILABLE"}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelFor(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}image`} label="Image URL (optional)">
          <Input id={`${p}image`} name="imageUrl" type="url" placeholder="https://…" defaultValue={v?.imageUrl ?? ""} />
        </Field>
      </div>
      <Field id={`${p}description`} label="Description">
        <Textarea id={`${p}description`} name="description" rows={2} defaultValue={v?.description ?? ""} />
      </Field>
      {features.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Features</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {features.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="featureIds" value={f.id} defaultChecked={featureIds.includes(f.id)} className="size-4 accent-brand-600" />
                {f.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

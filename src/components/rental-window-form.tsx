import Form from "next/form";
import type { Branch } from "@/lib/db/schema";
import { Field, Input, Select, fieldAria } from "./ui/field";
import { buttonClass } from "./ui/button";
import { timeSlots } from "./zoned-time";

/**
 * Date/time + return-branch picker for a single vehicle (pick-up branch is the
 * vehicle's own branch). Submits as GET to `action` so the server re-checks
 * availability and price.
 */
export function RentalWindowForm({
  action,
  pickupBranch,
  branches,
  values,
  errors = {},
  minDate,
  submitLabel = "Check availability",
}: {
  action: string;
  pickupBranch: Branch;
  branches: Branch[];
  values: { return: string; pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };
  errors?: Partial<Record<"return" | "pickupDate" | "returnDate", string>>;
  minDate: string;
  submitLabel?: string;
}) {
  const pickupSlots = timeSlots(pickupBranch.opensAtMinute, pickupBranch.closesAtMinute);
  const allSlots = timeSlots();
  return (
    <Form action={action} className="space-y-4" aria-label="Choose rental dates">
      <input type="hidden" name="pickup" value={pickupBranch.code} />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field id="pickupDate" label="Pick-up date" error={errors.pickupDate}>
          <Input {...fieldAria("pickupDate", errors.pickupDate)} type="date" name="pickupDate" min={minDate} defaultValue={values.pickupDate} required />
        </Field>
        <Field id="pickupTime" label="Pick-up time">
          <Select id="pickupTime" name="pickupTime" defaultValue={values.pickupTime}>
            {pickupSlots.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field id="returnDate" label="Return date" error={errors.returnDate}>
          <Input {...fieldAria("returnDate", errors.returnDate)} type="date" name="returnDate" min={minDate} defaultValue={values.returnDate} required />
        </Field>
        <Field id="returnTime" label="Return time">
          <Select id="returnTime" name="returnTime" defaultValue={values.returnTime}>
            {allSlots.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="return" label="Return branch" error={errors.return}>
        <Select {...fieldAria("return", errors.return)} name="return" defaultValue={values.return || pickupBranch.code}>
          {branches.map((b) => (
            <option key={b.id} value={b.code}>
              {b.name}
              {b.id !== pickupBranch.id && b.oneWayFeeFils > 0 ? " (one-way fee applies)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <button type="submit" className={buttonClass("outline", "md", "w-full")}>
        {submitLabel}
      </button>
    </Form>
  );
}

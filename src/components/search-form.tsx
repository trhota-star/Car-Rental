import Form from "next/form";
import type { Branch, VehicleCategory } from "@/lib/db/schema";
import { labelFor, openingHours } from "./format";
import { Field, Input, Select, fieldAria } from "./ui/field";
import { buttonClass } from "./ui/button";
import { cn } from "./ui/cn";
import { timeSlots } from "./zoned-time";

export interface SearchFormValues {
  pickup: string;
  return: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  category?: string;
  transmission?: string;
  fuel?: string;
  seats?: number;
  maxPrice?: number;
  sort?: string;
}

const slots = timeSlots();

/**
 * Search form (GET /search). Works without JavaScript; with JS, next/form
 * navigates client-side. All validation happens again on the server.
 */
export function SearchForm({
  branches,
  categories,
  values,
  errors = {},
  showFilters = false,
  minDate,
  className,
}: {
  branches: Branch[];
  categories: VehicleCategory[];
  values: SearchFormValues;
  errors?: Partial<Record<keyof SearchFormValues, string>>;
  showFilters?: boolean;
  minDate?: string;
  className?: string;
}) {
  return (
    <Form action="/search" className={cn("space-y-4", className)} aria-label="Search cars">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="pickup" label="Pick-up branch" error={errors.pickup}>
          <Select {...fieldAria("pickup", errors.pickup)} name="pickup" defaultValue={values.pickup} required>
            {branches.map((b) => (
              <option key={b.id} value={b.code}>
                {b.name} — {openingHours(b.opensAtMinute, b.closesAtMinute)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="return" label="Return branch" error={errors.return}>
          <Select {...fieldAria("return", errors.return)} name="return" defaultValue={values.return}>
            <option value="">Same as pick-up</option>
            {branches.map((b) => (
              <option key={b.id} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field id="pickupDate" label="Pick-up date" error={errors.pickupDate}>
            <Input
              {...fieldAria("pickupDate", errors.pickupDate)}
              type="date"
              name="pickupDate"
              min={minDate}
              defaultValue={values.pickupDate}
              required
            />
          </Field>
          <Field id="pickupTime" label="Pick-up time" error={errors.pickupTime}>
            <Select {...fieldAria("pickupTime", errors.pickupTime)} name="pickupTime" defaultValue={values.pickupTime}>
              {slots.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field id="returnDate" label="Return date" error={errors.returnDate}>
            <Input
              {...fieldAria("returnDate", errors.returnDate)}
              type="date"
              name="returnDate"
              min={minDate}
              defaultValue={values.returnDate}
              required
            />
          </Field>
          <Field id="returnTime" label="Return time" error={errors.returnTime}>
            <Select {...fieldAria("returnTime", errors.returnTime)} name="returnTime" defaultValue={values.returnTime}>
              {slots.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {showFilters && (
        <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <legend className="sr-only">Filters</legend>
          <Field id="category" label="Category" error={errors.category}>
            <Select {...fieldAria("category", errors.category)} name="category" defaultValue={values.category ?? ""}>
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="transmission" label="Transmission">
            <Select id="transmission" name="transmission" defaultValue={values.transmission ?? ""}>
              <option value="">Any</option>
              {["AUTOMATIC", "MANUAL"].map((t) => (
                <option key={t} value={t}>
                  {labelFor(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="fuel" label="Fuel type">
            <Select id="fuel" name="fuel" defaultValue={values.fuel ?? ""}>
              <option value="">Any</option>
              {["PETROL", "DIESEL", "HYBRID", "ELECTRIC"].map((t) => (
                <option key={t} value={t}>
                  {labelFor(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="seats" label="Seats (min)">
            <Select id="seats" name="seats" defaultValue={values.seats ? String(values.seats) : ""}>
              <option value="">Any</option>
              {[2, 4, 5, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </Select>
          </Field>
          <Field id="maxPrice" label="Max price / day (AED)">
            <Input
              id="maxPrice"
              name="maxPrice"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="No limit"
              defaultValue={values.maxPrice ?? ""}
            />
          </Field>
          <Field id="sort" label="Sort by">
            <Select id="sort" name="sort" defaultValue={values.sort ?? "price_asc"}>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="seats_desc">Most seats</option>
            </Select>
          </Field>
        </fieldset>
      )}

      <div className="flex justify-end">
        <button type="submit" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          {showFilters ? "Update results" : "Search cars"}
        </button>
      </div>
    </Form>
  );
}

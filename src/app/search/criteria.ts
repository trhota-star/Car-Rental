import { z } from "zod";
import type { Branch, VehicleCategory } from "@/lib/db/schema";
import { zonedToUtc, zonedToday } from "@/components/zoned-time";

// URL <-> search criteria. Branches and categories travel by `code` so URLs
// stay readable; dates and times are wall-clock values at the branch.

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(values).optional());

const raw = z.object({
  pickup: z.string().max(12),
  return: z.string().max(12),
  pickupDate: z.string().max(10),
  pickupTime: z.string().max(5),
  returnDate: z.string().max(10),
  returnTime: z.string().max(5),
  category: z.string().max(40),
  transmission: optionalEnum(["AUTOMATIC", "MANUAL"] as const),
  fuel: optionalEnum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"] as const),
  seats: z.preprocess((v) => (v === "" ? undefined : Number(v)), z.number().int().min(1).max(15).optional()).catch(undefined),
  maxPrice: z.preprocess((v) => (v === "" ? undefined : Number(v)), z.number().int().min(1).max(100000).optional()).catch(undefined),
  sort: optionalEnum(["price_asc", "price_desc", "seats_desc"] as const).catch(undefined),
});

export type SearchForm = z.infer<typeof raw>;

/** Read the form values from the URL, filling sensible defaults for empty dates. */
export function readSearchForm(sp: SearchParamsRecord, branches: Branch[]): SearchForm {
  const values = Object.fromEntries(Object.keys(raw.shape).map((k) => [k, first(sp[k])]));
  const parsed = raw.safeParse(values);
  const form: SearchForm = parsed.success
    ? parsed.data
    : {
        pickup: "",
        return: "",
        pickupDate: "",
        pickupTime: "",
        returnDate: "",
        returnTime: "",
        category: "",
        transmission: undefined,
        fuel: undefined,
        seats: undefined,
        maxPrice: undefined,
        sort: undefined,
      };
  const pickupBranch = branches.find((b) => b.code === form.pickup.toUpperCase()) ?? branches[0];
  const tz = pickupBranch?.timeZone ?? "Asia/Dubai";
  form.pickup = pickupBranch?.code ?? "";
  form.pickupDate ||= zonedToday(tz, 1);
  form.pickupTime ||= "10:00";
  form.returnDate ||= zonedToday(tz, 4);
  form.returnTime ||= form.pickupTime;
  return form;
}

export type ResolvedSearch =
  | {
      ok: true;
      pickupBranch: Branch;
      returnBranch: Branch;
      pickupAt: Date;
      returnAt: Date;
      category?: VehicleCategory;
    }
  | { ok: false; errors: Partial<Record<keyof SearchForm, string>> };

/** Turn form values into the UTC instants and ids the services expect. */
export function resolveSearch(form: SearchForm, branches: Branch[], categories: VehicleCategory[]): ResolvedSearch {
  const errors: Partial<Record<keyof SearchForm, string>> = {};
  const pickupBranch = branches.find((b) => b.code === form.pickup);
  const returnBranch = form.return ? branches.find((b) => b.code === form.return.toUpperCase()) : pickupBranch;
  if (!pickupBranch) errors.pickup = "Choose a pick-up branch";
  if (!returnBranch) errors.return = "Choose a return branch";

  const pickupAt = pickupBranch ? zonedToUtc(form.pickupDate, form.pickupTime, pickupBranch.timeZone) : null;
  const returnAt = returnBranch ? zonedToUtc(form.returnDate, form.returnTime, returnBranch.timeZone) : null;
  if (pickupBranch && !pickupAt) errors.pickupDate = "Enter a valid pick-up date and time";
  if (returnBranch && !returnAt) errors.returnDate = "Enter a valid return date and time";
  if (pickupAt && returnAt && returnAt <= pickupAt) errors.returnDate = "Return must be after pick-up";

  const category = form.category ? categories.find((c) => c.code === form.category) : undefined;
  if (form.category && !category) errors.category = "Unknown category";

  if (Object.keys(errors).length || !pickupBranch || !returnBranch || !pickupAt || !returnAt) {
    return { ok: false, errors };
  }
  return { ok: true, pickupBranch, returnBranch, pickupAt, returnAt, category };
}

/** Build a query string for links that carry the rental window (vehicle page, booking). */
export function windowQuery(form: Pick<SearchForm, "pickup" | "return" | "pickupDate" | "pickupTime" | "returnDate" | "returnTime">) {
  const q = new URLSearchParams();
  q.set("pickup", form.pickup);
  if (form.return && form.return !== form.pickup) q.set("return", form.return);
  q.set("pickupDate", form.pickupDate);
  q.set("pickupTime", form.pickupTime);
  q.set("returnDate", form.returnDate);
  q.set("returnTime", form.returnTime);
  return q.toString();
}

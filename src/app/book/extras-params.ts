import type { Extra } from "@/lib/db/schema";
import type { SearchParamsRecord } from "../search/criteria";

export interface ExtraChoice {
  extra: Extra;
  quantity: number;
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/** `?extra=GPS&extra=CHILD_SEAT&qty_CHILD_SEAT=2` -> chosen active extras with clamped quantities. */
export function readExtras(sp: SearchParamsRecord, available: Extra[]): ExtraChoice[] {
  const codes = new Set(list(sp.extra).map((c) => c.toUpperCase()));
  const out: ExtraChoice[] = [];
  for (const extra of available) {
    if (!codes.has(extra.code)) continue;
    const q = Number(list(sp[`qty_${extra.code}`])[0] ?? 1);
    const quantity = Number.isInteger(q) ? Math.min(Math.max(q, 1), extra.maxQuantity) : 1;
    out.push({ extra, quantity });
  }
  return out;
}

export function extrasQuery(choices: ExtraChoice[]): string {
  const q = new URLSearchParams();
  for (const c of choices) {
    q.append("extra", c.extra.code);
    if (c.quantity > 1) q.set(`qty_${c.extra.code}`, String(c.quantity));
  }
  return q.toString();
}

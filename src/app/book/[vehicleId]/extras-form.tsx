"use client";

import Form from "next/form";
import { useRef } from "react";
import { formatMoney, labelFor } from "@/components/format";
import { buttonClass } from "@/components/ui/button";

export interface ExtraOption {
  code: string;
  name: string;
  description: string | null;
  pricing: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxChargeFils: number | null;
  maxQuantity: number;
  selected: boolean;
  quantity: number;
}

/** Extras picker. Each change re-submits (GET) so the server recomputes the price. */
export function ExtrasForm({
  action,
  hidden,
  options,
}: {
  action: string;
  hidden: Record<string, string>;
  options: ExtraOption[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => ref.current?.requestSubmit();

  return (
    <Form ref={ref} action={action} replace scroll={false} className="space-y-3" aria-label="Choose extras">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <ul className="space-y-3">
        {options.map((o) => {
          const id = `extra-${o.code}`;
          return (
            <li key={o.code} className="flex flex-col gap-3 rounded-xl border border-line p-4 has-[input:checked]:border-brand-400 has-[input:checked]:bg-brand-50/50 sm:flex-row sm:items-center">
              <input
                id={id}
                type="checkbox"
                name="extra"
                value={o.code}
                defaultChecked={o.selected}
                onChange={submit}
                className="size-5 accent-brand-600"
              />
              <label htmlFor={id} className="flex-1 cursor-pointer">
                <span className="block font-medium">{o.name}</span>
                {o.description && <span className="block text-sm text-muted">{o.description}</span>}
              </label>
              {o.maxQuantity > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Qty</span>
                  <select
                    name={`qty_${o.code}`}
                    defaultValue={String(o.quantity)}
                    onChange={submit}
                    className="h-9 rounded-lg border border-line bg-white px-2"
                    aria-label={`${o.name} quantity`}
                  >
                    {Array.from({ length: o.maxQuantity }, (_, i) => (
                      <option key={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </label>
              )}
              <span className="text-sm font-semibold whitespace-nowrap">
                {formatMoney(o.priceFils)} <span className="font-normal text-muted">{labelFor(o.pricing)}</span>
                {o.maxChargeFils !== null && (
                  <span className="block text-xs font-normal text-muted">max {formatMoney(o.maxChargeFils)} per rental</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <noscript>
        <button type="submit" className={buttonClass("outline")}>
          Update price
        </button>
      </noscript>
    </Form>
  );
}

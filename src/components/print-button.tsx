"use client";

import { buttonClass } from "./ui/button";

export function PrintButton({ label = "Print voucher" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary")}>
      {label}
    </button>
  );
}

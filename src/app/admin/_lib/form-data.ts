// Small FormData readers for admin forms. Values are validated again by the
// db services (Zod); these only convert strings to the right primitive types.

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Empty string -> undefined (field omitted). */
export function optStr(fd: FormData, key: string): string | undefined {
  const v = str(fd, key);
  return v === "" ? undefined : v;
}

/** Empty string -> null (field cleared). */
export function nullableStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}

export function int(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

/** "129.5" AED -> 12950 fils, parsed as a string so no float rounding is involved. */
export function aedToFils(value: string): number | undefined {
  const v = value.trim().replace(/,/g, "");
  if (v === "") return undefined;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function fils(fd: FormData, key: string): number | undefined {
  return aedToFils(str(fd, key));
}

/** fils -> "129.50" for an <input> default value. */
export function filsToAed(fils: number | null | undefined): string {
  if (fils === null || fils === undefined) return "";
  return `${Math.floor(fils / 100)}.${String(fils % 100).padStart(2, "0")}`;
}

/** "08:30" -> 510 */
export function timeToMinutes(value: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Pure display helpers (safe on server and client). Money arrives as integer
// fils (1 AED = 100 fils); never do arithmetic here, only formatting.

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(fils: number, currency = "AED"): string {
  let f = moneyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-AE", { style: "currency", currency, minimumFractionDigits: 2 });
    moneyFormatters.set(currency, f);
  }
  return f.format(fils / 100);
}

/** e.g. "Sat, 1 Nov 2026, 10:00" in the given IANA zone. */
export function formatDateTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function formatDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

/** Short zone label, e.g. "GST" / "GMT+4". */
export function zoneLabel(timeZone: string, at: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(at));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

export function minutesToTime(minutes: number): string {
  if (minutes >= 1440) return "24:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function openingHours(opensAtMinute: number, closesAtMinute: number): string {
  if (opensAtMinute === 0 && closesAtMinute >= 1440) return "Open 24 hours";
  return `${minutesToTime(opensAtMinute)} – ${minutesToTime(closesAtMinute)}`;
}

const enumLabels: Record<string, string> = {
  AUTOMATIC: "Automatic",
  MANUAL: "Manual",
  PETROL: "Petrol",
  DIESEL: "Diesel",
  HYBRID: "Hybrid",
  ELECTRIC: "Electric",
  PICKED_UP: "On rent",
  PER_DAY: "per day",
  PER_RENTAL: "per rental",
};

/** "PICKED_UP" -> "On rent", "CONFIRMED" -> "Confirmed". */
export function labelFor(value: string): string {
  return enumLabels[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

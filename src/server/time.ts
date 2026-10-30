// Time helpers (no server-only: pure functions, safe for unit tests).
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Billable rental days: every started 24h counts, minimum 1. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
export function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(at: Date, timeZone: string): string {
  return new Date(at.getTime() + tzOffsetMs(timeZone, at)).toISOString().slice(0, 10);
}

/** Minutes after local midnight of an instant in a time zone. */
export function localMinuteOfDay(at: Date, timeZone: string): number {
  const local = new Date(at.getTime() + tzOffsetMs(timeZone, at));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** UTC instant of local midnight starting `date` (YYYY-MM-DD) in a time zone. */
export function zonedDayStart(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(timeZone, new Date(guess));
  return new Date(guess - tzOffsetMs(timeZone, new Date(first)));
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Convert between branch-local wall-clock time and UTC instants without a
// date library. Used to turn the search form's "date + time at the pick-up
// branch" into the UTC Dates the server services expect.

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-11-01" + "10:30" in Asia/Dubai -> the UTC Date of that local moment. Null when invalid. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  if (new Date(guess).getUTCDate() !== da) return null;
  try {
    // Two passes handle DST transitions in zones that have them.
    let utc = guess - offsetMs(new Date(guess), timeZone);
    utc = guess - offsetMs(new Date(utc), timeZone);
    return new Date(utc);
  } catch {
    return null;
  }
}

/** UTC instant -> { date: "YYYY-MM-DD", time: "HH:MM" } in the given zone. */
export function utcToZoned(instant: Date | string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Today's date (YYYY-MM-DD) in a zone, offset by `days`. */
export function zonedToday(timeZone: string, days = 0, now = new Date()): string {
  return utcToZoned(new Date(now.getTime() + days * 86_400_000), timeZone).date;
}

/** Half-hour slots "00:00".."23:30", limited to opening hours when given. */
export function timeSlots(opensAtMinute = 0, closesAtMinute = 1440): string[] {
  const out: string[] = [];
  // Branches are open in [opens, closes): the closing minute itself is not bookable.
  for (let m = opensAtMinute; m < closesAtMinute && m < 1440; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

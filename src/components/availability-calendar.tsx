import { cn } from "./ui/cn";

export type DayStatus = "available" | "partial" | "booked" | "maintenance";

export interface CalendarDay {
  /** YYYY-MM-DD in the vehicle's branch time zone. */
  date: string;
  status: DayStatus;
}

const styles: Record<DayStatus, string> = {
  available: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  booked: "bg-red-50 text-red-700 ring-red-200 line-through",
  maintenance: "bg-slate-100 text-slate-500 ring-slate-200 line-through",
};

const labels: Record<DayStatus, string> = {
  available: "Available",
  partial: "Partly booked",
  booked: "Booked",
  maintenance: "Unavailable (maintenance)",
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grids of per-day availability. Pure presentation; statuses come from the server. */
export function AvailabilityCalendar({
  days,
  selected,
  timeZone,
}: {
  days: CalendarDay[];
  /** Highlight the chosen rental range (YYYY-MM-DD, inclusive). */
  selected?: { from: string; to: string };
  timeZone: string;
}) {
  const byMonth = new Map<string, CalendarDay[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(d);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 sm:grid-cols-2">
        {[...byMonth.entries()].map(([month, list]) => {
          const [y, m] = month.split("-").map(Number);
          const first = new Date(Date.UTC(y, m - 1, 1));
          const lead = (first.getUTCDay() + 6) % 7; // Monday-first
          const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
          const map = new Map(list.map((d) => [d.date, d]));
          const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return (
            <div key={month}>
              <h3 className="mb-2 text-sm font-semibold">{monthName}</h3>
              <div role="grid" aria-label={`Availability for ${monthName}`} className="grid grid-cols-7 gap-1 text-center text-xs">
                {weekdays.map((w) => (
                  <div key={w} role="columnheader" className="py-1 font-medium text-muted">
                    {w}
                  </div>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <div key={`lead-${i}`} aria-hidden />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                  const day = map.get(date);
                  const inSel = selected && date >= selected.from && date <= selected.to;
                  return (
                    <div
                      key={date}
                      role="gridcell"
                      aria-label={day ? `${date}: ${labels[day.status]}` : `${date}: outside range`}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md ring-1 ring-inset",
                        day ? styles[day.status] : "text-slate-300 ring-transparent",
                        inSel && "outline-2 outline-offset-1 outline-brand-600",
                      )}
                    >
                      {i + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
        {(Object.keys(labels) as DayStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded ring-1 ring-inset", styles[s])} aria-hidden />
            {labels[s]}
          </li>
        ))}
        {selected && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded outline-2 outline-brand-600" aria-hidden />
            Your dates
          </li>
        )}
        <li>Dates shown in {timeZone} time.</li>
      </ul>
    </div>
  );
}

/**
 * Booked labour (Tom, 15 Oct 2026, 12 First Avenue): every calendar day an
 * employed painter is booked onto a job is a work day, costed at the standard
 * day's hours × that painter's cost rate on the day — from the moment the
 * booking is made, ahead of the day as well as behind it. Pure.
 *
 * The rule, in order, for each painter still on the job and each day of
 * their booking that is a Melbourne working day (Monday to Friday, public
 * holidays excluded — the autofill's own rule since 17 Sep; a weekend the
 * office records counts through its real row):
 *
 *   1. a timesheet entry on that day with an approved labour cost → that row
 *      is the day (jobProfit already counts it; nothing is projected);
 *   2. an entry the office rejected (and no approved one) → not worked, nil;
 *   3. otherwise the day is BOOKED: standard hours × the rate on the day. No
 *      rate on the day → nothing can be priced; the painter is reported in
 *      `missingRate` so the screen says so instead of reading as $0.
 *
 * Labour rows recorded outside a booking (extra hours, a weekend the office
 * recorded, a day worked on a job the painter was never booked on) are real
 * costs and count as they always did — this module only ADDS the booked days
 * no row covers yet. Once the day passes, the sweep's autofill records it and
 * the projected line becomes the recorded one at the same figure.
 *
 * Money in integer cents; hours to two places as `timesheet_hours` keeps them.
 */
import { labourCostCents } from "../pricing/labour";
import { isWorkingDay } from "../time/workingDays";

export type BookedPainter = {
  id: string;
  name: string;
  /** employment_type on the contractors row — a subcontractor is paid the offer, never by the day. */
  employee: boolean;
  startDate: string;
  endDate: string;
};
export type BookedEntry = { painterId: string; workDate: string; status: string; jobCostId: string | null };
export type CostRate = { painterId: string; effectiveFrom: string; centsPerHour: number };
/** timesheet_day_setting(): "07:30:00", "15:30:00", 30. */
export type StandardDay = { dayStart: string; dayFinish: string; breakMinutes: number };

export type BookedDay = {
  /** `booked:<painter>:<date>` — never a job_costs id. */
  id: string;
  painterId: string;
  name: string;
  date: string;
  hours: number;
  cents: number;
  label: string;
};
export type BookedLabour = {
  projected: BookedDay[];
  /** Painters with booked days that no cost rate covers, and how many. */
  missingRate: { painterId: string; name: string; days: number }[];
  workingDays: number;
};

const clock = (t: string): number => {
  const [h, m, s] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0) + (s ?? 0) / 60;
};

/** Hours in the standard day less its break, to two places — timesheet_hours on the standard day. */
export function standardDayHours(d: StandardDay): number {
  const minutes = clock(d.dayFinish) - clock(d.dayStart) - (d.breakMinutes || 0);
  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
}

/** The rate in force on a day: the latest effective_from on or before it (employee_cost_rate_on). */
export function rateOn(rates: readonly CostRate[], painterId: string, date: string): number | null {
  let best: CostRate | null = null;
  for (const r of rates) {
    if (r.painterId !== painterId || r.effectiveFrom > date) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best?.centsPerHour ?? null;
}

const nextDay = (ymd: string): string => new Date(Date.parse(`${ymd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (ymd: string): number => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const dayLabel = (ymd: string): string =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(`${ymd}T12:00:00Z`));

export function bookedLabour(input: {
  painters: readonly BookedPainter[];
  entries: readonly BookedEntry[];
  rates: readonly CostRate[];
  day: StandardDay;
  holidays: ReadonlySet<string>;
  /** Ids of labour job_costs that count (approved or paid) — an entry pinned to one is a recorded day. */
  countedCostIds: ReadonlySet<string>;
}): BookedLabour {
  const hours = standardDayHours(input.day);
  const projected: BookedDay[] = [];
  const missing = new Map<string, { painterId: string; name: string; days: number }>();
  let workingDays = 0;
  for (const p of input.painters) {
    if (!p.employee || !p.startDate || !p.endDate || p.endDate < p.startDate) continue;
    for (let d = p.startDate; d <= p.endDate; d = nextDay(d)) {
      if (!isWorkingDay(weekdayOf(d), d, input.holidays)) continue;
      workingDays += 1;
      const onDay = input.entries.filter((e) => e.painterId === p.id && e.workDate === d);
      if (onDay.some((e) => e.jobCostId && input.countedCostIds.has(e.jobCostId))) continue;
      if (onDay.length && onDay.every((e) => e.status === "rejected")) continue;
      const rate = rateOn(input.rates, p.id, d);
      if (rate === null) {
        const m = missing.get(p.id) ?? { painterId: p.id, name: p.name, days: 0 };
        m.days += 1; missing.set(p.id, m);
        continue;
      }
      projected.push({
        id: `booked:${p.id}:${d}`, painterId: p.id, name: p.name, date: d, hours,
        cents: labourCostCents(hours, rate),
        label: `${p.name} · ${dayLabel(d)} · booked ${hours} h`,
      });
    }
  }
  return { projected, missingRate: [...missing.values()], workingDays };
}

/** The panel's one line for painters whose booked days cannot be priced. */
export function missingRateNote(missing: readonly { name: string; days: number }[]): string | null {
  if (!missing.length) return null;
  const who = missing.map((m) => `${m.name} (${m.days} booked ${m.days === 1 ? "day" : "days"})`).join(", ");
  return `No cost rate is set for ${who}, so those days count nothing here and the profit reads too high. Set the rate under Contractors and the days post themselves.`;
}

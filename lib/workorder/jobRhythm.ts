/**
 * The rhythm of a booked job (Tom, 25 Sep 2026) — PURE, shared by two things
 * that must never disagree about "day 1", "half way" or "the last day":
 *
 *   · the painter's "update your work order" texts
 *     (lib/automations/sweeps/jobReminders.ts, automation
 *     contractor_job_update_reminder);
 *   · the office's customer check-in items on the one work queue
 *     (lib/crm/work-queue.ts, kinds job_checkin / job_followup).
 *
 * A job's days are its BOOKED working days: the calendar span start→end,
 * skipping Saturday / Sunday unless the painter works them (the same rule
 * scheduleDays uses for hours). "N% through" is the day at that fraction of
 * the way from day 1 to the last day, rounded, and never day 1 or the last
 * day itself on a job of three or more days.
 *
 * Painter reminders (Tom's brackets; 6 days falls in the 3–6 bracket, and
 * anything over 15 days follows the 7–15 pattern):
 *   1–2 days   day 1 07:30 · day 2 15:30 (a one-day job: day 1 15:30)
 *   3–6 days   day 1 07:30 · 50% 15:30 · last day 15:30
 *   7+ days    day 1 07:30 · 30% 15:30 · 60% 15:30 · last day 15:30
 *
 * Office check-ins with the customer:
 *   1–2 days   a follow-up after the job completes — are they happy?
 *   3–6 days   50% through: a mid-job check-in (high importance)
 *   7+ days    35% and 70% through: two mid-job check-ins (high importance)
 */
import { melbourneInstant } from "@/lib/time/businessHours";

export type WorkWeek = { worksSaturday?: boolean; worksSunday?: boolean };

const DAY_MS = 86_400_000;
const utcDate = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
// Calendar arithmetic in UTC on purpose (the dates ARE calendar days); spelt
// from the UTC parts rather than the ISO slice the loop's convention bans.
const isoOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** The booked working days, start→end inclusive, as YYYY-MM-DD. Empty when unbooked or inverted. */
export function jobDays(startDate: string | null | undefined, endDate: string | null | undefined, week: WorkWeek = {}): string[] {
  if (!startDate || !endDate) return [];
  const a = utcDate(startDate); const b = utcDate(endDate);
  if (!a || !b || b < a) return [];
  const out: string[] = [];
  for (let t = a.getTime(); t <= b.getTime(); t += DAY_MS) {
    const d = new Date(t); const dow = d.getUTCDay();
    if (dow === 6 && !week.worksSaturday) continue;
    if (dow === 0 && !week.worksSunday) continue;
    out.push(isoOf(d));
  }
  // A booking that is only weekend days for a weekday painter still has days on it.
  if (out.length === 0) out.push(startDate);
  return out;
}

/** The day `pct` of the way through — never day 1 or the last day on a job of 3+ days. */
export function dayAt(days: readonly string[], pct: number): string {
  const n = days.length;
  if (n === 0) return "";
  if (n <= 2) return days[Math.min(n - 1, Math.round((n - 1) * pct))];
  const idx = Math.min(n - 2, Math.max(1, Math.round((n - 1) * pct)));
  return days[idx];
}

export type JobRung = { id: string; date: string; hour: number; minute: number };

/** The painter's "update your work order" moments for a job of these days. */
export function painterUpdateRungs(days: readonly string[]): JobRung[] {
  const n = days.length;
  if (n === 0) return [];
  const first = days[0]; const last = days[n - 1];
  const morning = (id: string, date: string): JobRung => ({ id, date, hour: 7, minute: 30 });
  const afternoon = (id: string, date: string): JobRung => ({ id, date, hour: 15, minute: 30 });
  if (n <= 2) return [morning("day1", first), afternoon(n === 1 ? "day1_pm" : "day2", last)];
  if (n <= 6) return [morning("day1", first), afternoon("mid", dayAt(days, 0.5)), afternoon("last", last)];
  return [morning("day1", first), afternoon("mid30", dayAt(days, 0.3)), afternoon("mid60", dayAt(days, 0.6)), afternoon("last", last)];
}

export type CheckinPlan =
  | { id: "after"; kind: "after"; date: string }
  | { id: string; kind: "mid"; date: string; pct: number };

/** The office's customer check-ins for a job of these days. */
export function customerCheckins(days: readonly string[]): CheckinPlan[] {
  const n = days.length;
  if (n === 0) return [];
  if (n <= 2) return [{ id: "after", kind: "after", date: days[n - 1] }];
  if (n <= 6) return [{ id: "mid50", kind: "mid", date: dayAt(days, 0.5), pct: 50 }];
  return [
    { id: "mid35", kind: "mid", date: dayAt(days, 0.35), pct: 35 },
    { id: "mid70", kind: "mid", date: dayAt(days, 0.7), pct: 70 },
  ];
}

/** A rung's instant in Melbourne wall-clock time (the offset is measured, never written). */
export function rungInstant(r: { date: string; hour: number; minute: number }): Date {
  const [y, m, d] = r.date.split("-").map(Number);
  return melbourneInstant(y, m, d, r.hour, r.minute);
}

/** "Day 3 of 7" for a date on the job, or "" when the date is not a booked day. */
export function dayLabel(days: readonly string[], date: string): string {
  const i = days.indexOf(date);
  return i < 0 ? "" : `day ${i + 1} of ${days.length}`;
}

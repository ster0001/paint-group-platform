/**
 * Calendar-date arithmetic. Plain `YYYY-MM-DD` strings, never instants.
 *
 * This module exists because of a real bug. The helpers below were written
 * three times over — in the board loader, the schedule page and the schedule
 * board component — and one version parsed `YYYY-MM-DD` as LOCAL midnight and
 * formatted it back through `toISOString()`, which returns the UTC day. East of
 * Greenwich that lands on the previous date: a job dropped on 1 September was
 * written to the database as 31 August.
 *
 * The rule, and the reason each function is shaped the way it is:
 *
 *   - arithmetic on a calendar date parses with an explicit `T00:00:00Z` and
 *     moves with `setUTCDate`, so no local offset can touch it;
 *   - "today", by contrast, is a question about the LOCAL clock, so it is built
 *     from getFullYear/getMonth/getDate and never from `toISOString()`.
 *
 * Both halves are pinned by `dates.test.ts`, which runs under Melbourne time.
 * No Supabase and no React imports: Client Components import this too.
 */

/** A calendar date `n` days after `iso`. Negative `n` goes back. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/**
 * Today as the user's own calendar sees it.
 *
 * Takes an optional Date so tests can pin the clock; production calls it bare.
 */
export function todayIso(now: Date = new Date()): string {
  return localIso(now);
}

/** The local calendar date of an instant — NOT its UTC date. */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Guards a string from a URL or form before it is treated as a date. */
export function isDateString(s: string | null | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
}

/** The inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0, n = dayDiff(from, to); i <= n; i++) out.push(addDays(from, i));
  return out;
}

// ---- working days (Tom, 22 Sep 2026) ---------------------------------------------
//
// "When scheduling work, don't count weekends as working days: a 7-day job that
// starts on a Monday finishes the following Tuesday." A painter who has ticked
// "works Saturdays" / "works Sundays" on their profile keeps those days.

export type WorkingWeek = { saturday?: boolean; sunday?: boolean };

/** Monday–Friday, plus the weekend days this painter works. */
export function isWorkingDay(iso: string, week: WorkingWeek = {}): boolean {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();   // 0 = Sunday, 6 = Saturday
  if (dow === 6) return Boolean(week.saturday);
  if (dow === 0) return Boolean(week.sunday);
  return true;
}

/**
 * The last calendar day of a span of `days` working days that starts on `start`.
 * The start day counts as the first working day when it is one; a start on a
 * day the painter does not work counts from the next day they do.
 * `days` ≤ 1 gives the first working day on or after `start`.
 */
export function addWorkingDays(start: string, days: number, week: WorkingWeek = {}): string {
  let d = start;
  let left = Math.max(1, Math.round(days));
  for (let guard = 0; guard < 4000; guard++) {
    if (isWorkingDay(d, week)) { left -= 1; if (left === 0) return d; }
    d = addDays(d, 1);
  }
  return d;
}

/** Working days from `from` to `to`, inclusive — never fewer than one. */
export function workingDaysBetween(from: string, to: string, week: WorkingWeek = {}): number {
  if (to < from) return 1;
  let n = 0;
  for (const d of dateRange(from, to)) if (isWorkingDay(d, week)) n += 1;
  return Math.max(1, n);
}


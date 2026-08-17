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

/**
 * Working days, Melbourne, public holidays excluded (visit booking addendum A,
 * R23 / R33). "Answered within one working day" means by the END of the next
 * working day after the request: a request made on a Friday is due by the end
 * of Monday; one made the day before a public holiday is due by the end of the
 * next working day after the holiday. Pure; the holiday list comes from
 * `settings.visit_booking_rules.publicHolidays` and is passed in.
 */
import { melbourneInstant, melbourneParts } from "./businessHours";

/** 17:00 Melbourne — the end of a working day. */
export const END_OF_DAY_HOUR = 17;

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

/** Monday to Friday and not in the holiday list. `date` is YYYY-MM-DD, Melbourne. */
export function isWorkingDay(weekday: number, date: string, holidays: ReadonlySet<string>): boolean {
  return weekday >= 1 && weekday <= 5 && !holidays.has(date);
}

/** The Melbourne calendar day `n` days after `at`'s day, at noon (so the offset cannot shift the date). */
function dayAfter(at: Date, n: number): { y: number; m: number; d: number; weekday: number } {
  const p = melbourneParts(at);
  const noon = new Date(Date.UTC(p.y, p.m - 1, p.d, 12) + n * 86_400_000);
  const q = { y: noon.getUTCFullYear(), m: noon.getUTCMonth() + 1, d: noon.getUTCDate() };
  return { ...q, weekday: melbourneParts(melbourneInstant(q.y, q.m, q.d, 12)).weekday };
}

/** End (17:00) of the next working day strictly after `from`'s Melbourne day. */
export function endOfNextWorkingDay(from: Date, holidays: ReadonlySet<string>): Date {
  for (let n = 1; n < 60; n++) {
    const d = dayAfter(from, n);
    if (isWorkingDay(d.weekday, ymdOf(d), holidays)) return melbourneInstant(d.y, d.m, d.d, END_OF_DAY_HOUR);
  }
  throw new Error("no working day in the next 60 days");
}

/** The holiday list that falls in a given year. */
export function holidaysInYear(holidays: readonly string[], year: number): string[] {
  return holidays.filter((d) => d.startsWith(`${year}-`)).sort();
}

/**
 * Section 4.4: "raise a work-queue item each November to add the following
 * year". True from 1 November when next year's list is empty.
 */
export function nextYearHolidaysMissing(holidays: readonly string[], now: Date): boolean {
  const p = melbourneParts(now);
  return p.m >= 11 && holidaysInYear(holidays, p.y + 1).length === 0;
}

/**
 * Business-hours maths in Melbourne (brief §4: "due in 4 business hours",
 * "next business morning"). Pure, and the zone is measured with Intl at the
 * instant in question — never a written-down offset (CLAUDE.md: Melbourne is
 * +11 Oct–Apr, +10 otherwise).
 */

const TZ = "Australia/Melbourne";
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 17;

const fmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});

type Parts = { y: number; m: number; d: number; h: number; min: number; s: number; weekday: number };
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The Melbourne wall-clock parts of an instant. */
export function melbourneParts(at: Date): Parts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: WD[p.weekday] ?? 0 };
}

/** Offset (ms) of Melbourne from UTC at an instant, measured. */
function offsetAt(at: Date): number {
  const p = melbourneParts(at);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - at.getTime();
}

/** The instant of a Melbourne wall-clock time. Two passes so a DST edge resolves. */
export function melbourneInstant(y: number, m: number, d: number, h: number, min = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetAt(new Date(guess));
  t = guess - offsetAt(new Date(t));
  return new Date(t);
}

const isBusinessDay = (weekday: number) => weekday >= 1 && weekday <= 5;

/** The next moment the office is open, at or after `at`. */
export function nextOpen(at: Date): Date {
  const p = melbourneParts(at);
  if (isBusinessDay(p.weekday) && p.h >= OPEN_HOUR && p.h < CLOSE_HOUR) return at;
  // Same day before opening, or roll to the next business day at 9:00.
  let day = melbourneInstant(p.y, p.m, p.d, OPEN_HOUR);
  if (!(isBusinessDay(p.weekday) && p.h < OPEN_HOUR)) {
    do { day = new Date(day.getTime() + 24 * 3_600_000); day = (() => { const q = melbourneParts(day); return melbourneInstant(q.y, q.m, q.d, OPEN_HOUR); })(); }
    while (!isBusinessDay(melbourneParts(day).weekday));
  }
  return day;
}

/** `at` + `hours` of office time (Mon–Fri 9–17, Melbourne). */
export function addBusinessHours(at: Date, hours: number): Date {
  let remaining = hours * 3_600_000;
  let cur = nextOpen(at);
  while (remaining > 0) {
    const p = melbourneParts(cur);
    const close = melbourneInstant(p.y, p.m, p.d, CLOSE_HOUR);
    const room = close.getTime() - cur.getTime();
    if (remaining <= room) return new Date(cur.getTime() + remaining);
    remaining -= room;
    cur = nextOpen(new Date(close.getTime() + 60_000));
  }
  return cur;
}

/** 9:00 on the next business day strictly after `at`'s Melbourne day. */
export function nextBusinessMorning(at: Date): Date {
  const p = melbourneParts(at);
  let day = melbourneInstant(p.y, p.m, p.d, OPEN_HOUR);
  do {
    day = new Date(day.getTime() + 24 * 3_600_000);
    const q = melbourneParts(day);
    day = melbourneInstant(q.y, q.m, q.d, OPEN_HOUR);
  } while (!isBusinessDay(melbourneParts(day).weekday));
  return day;
}

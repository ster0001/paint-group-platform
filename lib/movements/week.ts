import { addDays, isDateString } from "@/lib/scheduling/dates";

/**
 * Movements — which week the board opens on (brief §3.4): the Monday of THIS week until
 * Wednesday, NEXT week's Monday from Thursday — by Thursday the office is planning the
 * week ahead. Six columns, Monday to Saturday. `today` is the Melbourne calendar day.
 */
export const WEEK_DAYS = 6;

export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function defaultWeekStart(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = mondayOf(today);
  return dow === 0 || dow >= 4 ? addDays(thisMonday, 7) : thisMonday;
}

/** A `week=` query value: a valid date is snapped to its Monday; anything else is the default. */
export function weekStartFrom(param: string | undefined, today: string): string {
  return isDateString(param) ? mondayOf(param) : defaultWeekStart(today);
}

export function weekEnd(start: string): string {
  return addDays(start, WEEK_DAYS - 1);
}

const WEEK_LABEL = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
/** "19 Oct" — the headline's week. */
export function weekLabel(start: string): string {
  return WEEK_LABEL.format(new Date(`${start}T00:00:00Z`));
}

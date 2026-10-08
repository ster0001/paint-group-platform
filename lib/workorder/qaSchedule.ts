/**
 * When a quality check happens (Tom, 8 Oct 2026). Pure — no clock, no DB.
 *
 * The main check sits on the WORKING DAY BEFORE the final walkthrough (Mon–Fri,
 * Settings → public holidays skipped), at the time it already had, else 09:00
 * Melbourne. The database owns the rule — wo_qa_place_open_checks (migration
 * 20270247) moves the check whenever the final is booked or moved, by any
 * door. This is its twin, used to pre-fill the PC's date and time boxes and to
 * explain a refusal before the round trip; the e2e spec pins the two together.
 *
 * Every date here is a plain calendar date (YYYY-MM-DD, Melbourne), stepped by
 * calendar day at UTC noon — daylight saving cannot move a date.
 */

export const QA_DEFAULT_TIME = "09:00";

const two = (n: number) => String(n).padStart(2, "0");

function addDays(date: string, n: number): { iso: string; weekday: number } {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return { iso: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`, weekday: d.getUTCDay() };
}

/** The last working day strictly before `date`. */
export function workingDayBefore(date: string, holidays: ReadonlySet<string>): string {
  for (let n = 1; n <= 60; n++) {
    const d = addDays(date, -n);
    if (d.weekday >= 1 && d.weekday <= 5 && !holidays.has(d.iso)) return d.iso;
  }
  return addDays(date, -1).iso;
}

export type QaWhen = { date: string; time: string };

/** Where the rule puts a check for a final on `finalDate`. */
export function defaultQaWhen(finalDate: string, holidays: ReadonlySet<string>, keepTime?: string | null): QaWhen {
  return { date: workingDayBefore(finalDate, holidays), time: keepTime || QA_DEFAULT_TIME };
}

export type QaWhenProblem = "past" | "after_final" | "no_time" | "already_recorded" | "closed";

/** The same refusals wo_qa_set_schedule / wo_add_qa_check give, decided here first. */
export function qaWhenProblem(
  when: { date: string; time: string | null },
  final: { date: string; time: string | null } | null,
  today: string,
): QaWhenProblem | null {
  if (!when.time) return "no_time";
  if (when.date < today) return "past";
  if (!final) return null;
  if (when.date > final.date) return "after_final";
  if (when.date === final.date && (!final.time || when.time >= final.time)) return "after_final";
  return null;
}

export function qaWhenMessage(p: QaWhenProblem): string {
  switch (p) {
    case "past": return "That day has gone — pick today or later.";
    case "after_final": return "A check has to be before the final walkthrough. Pick an earlier day (or an earlier time on the day).";
    case "no_time": return "Pick a time as well as a day.";
    case "already_recorded": return "This check has already been recorded.";
    case "closed": return "This job is closed.";
  }
}

/** The main end-of-job check, and the extras the office adds. */
export function qaCheckLabel(kind: string): string {
  if (kind === "final") return "Quality check";
  if (kind === "mid") return "Site check-in";
  if (kind === "spot") return "Spot check";
  if (kind === "day_one") return "Day-one check";
  return "Check";
}

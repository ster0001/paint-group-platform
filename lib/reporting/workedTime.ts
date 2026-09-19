/**
 * Home dashboard v2 · 0c — days and hours worked on a job, from ONE function.
 *
 * Tom's blended rule (19 Sep 2026): every job gets a time figure from one of
 * two sources, and the source is always stored and shown.
 *
 *   entered  — the contractor is opted in (contractors.capture_worked_hours)
 *              and typed days and hours at the final DONE tick
 *              (wo_worked_hours, source 'entered').
 *   schedule — nobody typed anything, so days = the booked days between the
 *              booking's start and its end (the CURRENT end, which already
 *              includes approved extensions), hours = days × the standard day
 *              length (Settings 'worked_day_hours', default 8), capped at the
 *              booking's hours allowance when the job finished early.
 *
 * Two things never happen: a tile silently averages entered and schedule
 * figures without saying so, and the calibration table (estimated vs actual
 * hours, the Phase-1 gate) uses `entered` rows only — schedule-derived hours
 * are the estimate restated, not evidence. `isCalibrationEvidence` says which.
 *
 * Pure: dates in, numbers out. The caller loads the rows; nothing here reads.
 */

export type WorkedTimeSource = "entered" | "schedule";

export type WorkedTime = {
  days: number;
  hours: number;
  source: WorkedTimeSource;
  /** Schedule only: the booking had no dates, so nothing could be derived. */
  incomplete?: true;
};

export type WorkedTimeInput = {
  /** The contractor's own entry, when there is one. */
  entered?: { days: number; hours: number } | null;
  /** The accepted booking: yyyy-mm-dd, end inclusive (current end, extensions included). */
  booking?: { startDate: string | null; endDate: string | null } | null;
  /** The day the last surface was ticked (yyyy-mm-dd) — a job finished early stops counting there. */
  finishedOn?: string | null;
  /** The booking's hours allowance (the estimate's hours) — the schedule cap. */
  estimateHours?: number | null;
  /** Settings 'worked_day_hours'. */
  dayHours: number;
  /** The contractor's working week; a day they never work is not a booked day. */
  worksSaturday?: boolean;
  worksSunday?: boolean;
};

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * Booked days between two calendar dates, inclusive, skipping the days this
 * painter never works. Dates are calendar days, so the zone is irrelevant —
 * counted in UTC to keep the arithmetic exact.
 */
export function scheduleDays(
  startDate: string, endDate: string,
  week: { worksSaturday?: boolean; worksSunday?: boolean } = {},
): number {
  const a = utcDate(startDate); const b = utcDate(endDate);
  if (!a || !b || b < a) return 0;
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 6 && !week.worksSaturday) continue;
    if (dow === 0 && !week.worksSunday) continue;
    n += 1;
  }
  return n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function workedTime(input: WorkedTimeInput): WorkedTime {
  if (input.entered && input.entered.days > 0 && input.entered.hours >= 0) {
    return { days: round2(input.entered.days), hours: round2(input.entered.hours), source: "entered" };
  }
  const start = input.booking?.startDate ?? null;
  let end = input.booking?.endDate ?? null;
  if (!start || !end) return { days: 0, hours: 0, source: "schedule", incomplete: true };
  // Finished early: the schedule stops counting on the day the last surface was ticked.
  if (input.finishedOn && input.finishedOn < end && input.finishedOn >= start) end = input.finishedOn;
  const days = scheduleDays(start, end, { worksSaturday: input.worksSaturday, worksSunday: input.worksSunday });
  let hours = days * Math.max(0, input.dayHours);
  if (input.estimateHours != null && input.estimateHours >= 0 && input.finishedOn && input.finishedOn <= end) {
    hours = Math.min(hours, input.estimateHours);
  }
  return { days, hours: round2(hours), source: "schedule" };
}

/** The calibration table takes entered rows only. */
export function isCalibrationEvidence(t: WorkedTime): boolean {
  return t.source === "entered";
}

/**
 * The coverage line a tile shows beside a blended figure —
 * "actual on 4 of 11 jobs, schedule on 7". Never a silent average.
 */
export function coverageLine(times: ReadonlyArray<WorkedTime>): string {
  const entered = times.filter((t) => t.source === "entered").length;
  const schedule = times.length - entered;
  if (times.length === 0) return "no jobs in range";
  return `actual on ${entered} of ${times.length} job${times.length === 1 ? "" : "s"}, schedule on ${schedule}`;
}

/** The label a drill-through row shows in its source column. */
export function sourceLabel(source: WorkedTimeSource): string {
  return source === "entered" ? "Entered by the painter" : "From the schedule";
}

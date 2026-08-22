/**
 * Which calendar days a contractor's jobs occupy.
 *
 * Three screens draw the same calendar — the Calendar tab, the offer card on
 * Requests, and a single job's own page — and each had rolled its own version
 * of this. They disagreed, in ways that mattered:
 *
 *  - Requests omitted the job `id`, so tapping a booked day on an offer's
 *    calendar did nothing at all. That is the bug Tom reported (22 Aug).
 *  - Requests and the job page both used the START DATE ONLY, so a four-day
 *    booking showed as a single booked square. On the offer card that is the
 *    dangerous one: a contractor deciding whether to accept was looking at a
 *    calendar that under-reported their own existing commitments, and could
 *    accept a job straight over the top of one they already had.
 *
 * One function now, so the three can't drift apart again.
 */
import type { ContractorJob } from "./jobs";
import type { PortalJobDay } from "@/app/portal/calendar/CalendarGrid";
// The project's own local-date helper. Never toISOString() here — see the note
// in lib/scheduling/dates.ts about the day-shifting bug that caused.
import { localIso } from "@/lib/scheduling/dates";

/**
 * How many days a booking covers. The booking's own end date decides it;
 * estimated hours are a fallback for jobs booked before end dates existed — a
 * guess must never override what the office actually booked.
 */
export function spanOf(job: Pick<ContractorJob, "startDate" | "endDate" | "doc">): number {
  if (!job.startDate) return 0;
  if (job.endDate) {
    const days = Math.round(
      (Date.parse(`${job.endDate}T00:00:00Z`) - Date.parse(`${job.startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    return Math.max(1, days);
  }
  const hours = job.doc
    ? job.doc.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + (s.hours ?? 0), 0)
    : 0;
  return Math.max(1, Math.ceil((hours || 8) / 8));
}

/** Every day these jobs occupy, carrying the id so a tap can open the job. */
export function jobDaysFor(jobs: ContractorJob[]): PortalJobDay[] {
  const out: PortalJobDay[] = [];
  for (const j of jobs) {
    if (!j.startDate) continue;
    const span = spanOf(j);
    for (let i = 0; i < span; i++) {
      const d = new Date(j.startDate + "T00:00:00");
      d.setDate(d.getDate() + i);
      out.push({ date: localIso(d), label: j.doc?.jobTitle || j.woRef, status: j.status, id: j.id });
    }
  }
  return out;
}

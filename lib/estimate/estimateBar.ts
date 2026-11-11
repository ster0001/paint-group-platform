import { ESTIMATE_STAGES, ESTIMATE_STAGE_LABEL, type EstimateStage, type EstimateStageEvent } from "@/lib/crm/estimateStage";

/**
 * Estimates tab session 6 (brief §4.6): the two lines of the estimate page's
 * funnel bar. Pure.
 *
 * The STAGE STRIP is the main path an estimate walks, in stage order, with
 * the estimate's own stage put in its place when it is off that path
 * (Needs help, Question asked, Declined…), so the current one is always on
 * the strip and highlighted.
 */
const MAIN_PATH: ReadonlySet<EstimateStage> = new Set([
  "details_captured", "range_no_action", "visit_requested", "visit_booked", "visit_done",
  "estimate_sent", "estimate_viewed", "accepted", "booked", "in_progress", "signed_off", "paid",
]);

export type StripStep = { stage: EstimateStage; label: string; state: "done" | "current" | "ahead" };

export function stageStrip(current: EstimateStage | null): StripStep[] {
  const order = ESTIMATE_STAGES.map((s) => s.key) as EstimateStage[];
  const keep = order.filter((k) => MAIN_PATH.has(k) || k === current);
  const at = current ? keep.indexOf(current) : -1;
  return keep.map((stage, i) => ({ stage, label: ESTIMATE_STAGE_LABEL[stage], state: at < 0 ? "ahead" : i < at ? "done" : i === at ? "current" : "ahead" }));
}

export type PathStep = { step: string; seconds: number | null; slow: boolean };
/** A step is slow when it took longer than this and more than twice the session's median step. */
export const SLOW_FLOOR_SECONDS = 60;

/**
 * The WIZARD PATH: the steps the session saw, in the order it first saw
 * them, with the time from first seeing each to first completing it
 * (`wizard_step_viewed` → `wizard_step_completed`). A step never completed
 * has no time. Slow steps are bold on the page.
 */
export function wizardPath(events: readonly EstimateStageEvent[]): PathStep[] {
  const seen = new Map<string, string>(); const done = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const step = typeof e.payload?.step === "string" ? e.payload.step : null;
    if (!step) continue;
    if (e.type === "wizard_step_viewed" && !seen.has(step)) seen.set(step, e.occurred_at);
    if (e.type === "wizard_step_completed" && !done.has(step)) done.set(step, e.occurred_at);
  }
  const steps = [...seen.entries()].map(([step, at]) => {
    const end = done.get(step);
    return { step, seconds: end && end >= at ? Math.round((Date.parse(end) - Date.parse(at)) / 1000) : null };
  });
  const times = steps.map((s) => s.seconds).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  return steps.map((s) => ({ ...s, slow: s.seconds != null && s.seconds > SLOW_FLOOR_SECONDS && s.seconds > 2 * median }));
}

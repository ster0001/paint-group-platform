/**
 * The seven-stage work-order loop, mirrored from the database.
 *
 * (Seven enum stages; the screens show seven LANES too since 1 Oct 2026, but a
 * different seven — completion_prep folds into In progress and pre_start splits
 * by start date into Booking confirmed / Pre-start. See `laneFor`.)
 *
 * `wo_stage_transitions`, re-seeded canonically in
 * 20261110000000_wo_no_walkthrough_colour_match.sql, is the source of truth — the RPC reads that table, so the database is what actually
 * decides. This module exists so the UI can offer only the moves that exist and
 * so the rules can be unit-tested without a round trip.
 *
 * The two are kept honest by `stages.test.ts`, which parses the migration and
 * diffs it against TRANSITIONS. Change one without the other and the suite goes
 * red — that is the whole point of the mirror.
 */

export const WO_STAGES = [
  "offered",
  "pre_start",
  "in_progress",
  "qa",
  "completion_prep",
  "walkthrough",
  "closed",
] as const;

export type WoStage = (typeof WO_STAGES)[number];

/** Who may ASK for a move. "system" is the trigger and the scheduled sweep; it
 *  is never a value a caller can supply. */
export type WoActor = "system" | "staff" | "contractor" | "customer";

export type WoTransition = {
  from: WoStage;
  to: WoStage;
  label: string;
  actors: readonly WoActor[];
};

// NOTE: the `label` on each transition mirrors the seed row in
// supabase/migrations — stages.test.ts compares them string-for-string, and
// they are never shown to anyone. The console writes its own button copy, so
// the "QA" wording here is the database's, not the screen's.
export const TRANSITIONS: readonly WoTransition[] = [
  { from: "offered", to: "pre_start", label: "contractor accepted the offer", actors: ["system", "staff"] },
  { from: "pre_start", to: "offered", label: "booking released — back to the tray", actors: ["system", "staff"] },
  { from: "pre_start", to: "in_progress", label: "pre-start checklist complete", actors: ["system", "staff", "contractor"] },
  { from: "in_progress", to: "completion_prep", label: "all surfaces done — prep begins", actors: ["system", "staff", "contractor"] },
  { from: "completion_prep", to: "qa", label: "prep confirmed — quality check due", actors: ["system", "staff", "contractor"] },
  { from: "completion_prep", to: "walkthrough", label: "prep confirmed — evidence pack delivered", actors: ["system", "staff", "contractor"] },
  // Tom, 23 Aug: "walkthrough not required" on the booking — straight to closed (invoice stage).
  { from: "completion_prep", to: "closed", label: "prep confirmed — no walkthrough required", actors: ["system", "staff", "contractor"] },
  { from: "qa", to: "walkthrough", label: "quality check passed — evidence pack delivered", actors: ["system", "staff", "contractor"] },
  { from: "qa", to: "closed", label: "quality check passed — no walkthrough required", actors: ["system", "staff", "contractor"] },
  { from: "qa", to: "in_progress", label: "QA failed — rectification raised", actors: ["staff"] },
  { from: "walkthrough", to: "closed", label: "signed off", actors: ["system", "staff", "customer"] },
  { from: "walkthrough", to: "in_progress", label: "area flagged — rectification raised", actors: ["staff", "customer"] },
  // Tom, 23 Aug: something picked up within days of signing — staff reopen.
  { from: "closed", to: "walkthrough", label: "reopened after sign-off", actors: ["staff"] },
];

/**
 * The stages a person SEES. completion_prep still exists in the machine — it
 * is the gate between the ticks and the qa/sign-off split — but Tom ruled it
 * off every screen (23 Aug): the prep questions are part of the tick-off step,
 * and a job passing through (or parked at) completion_prep displays as
 * In progress. Fold with `visibleStage()`, list lanes with VISIBLE_STAGES.
 */
export type VisibleStage = Exclude<WoStage, "completion_prep">;
export const VISIBLE_STAGES =
  WO_STAGES.filter((s): s is VisibleStage => s !== "completion_prep");

/** Where a stage DISPLAYS — completion_prep folds into in_progress. */
export const visibleStage = (s: WoStage): VisibleStage =>
  s === "completion_prep" ? "in_progress" : s;

/**
 * The LANES on the project-progress bar (Tom, 1 Oct 2026): a booked job whose
 * start is more than a week away sits in **Booking confirmed**, between Offer
 * and Pre-start; **Pre-start** holds only the jobs due to start within the
 * next seven days (or already past their start date and not yet started).
 *
 * It is a display split of the `pre_start` stage, not a stage of its own: the
 * enum, the transition table and every gate are unchanged. "Due within a
 * week" is a fact about the calendar, so it is derived at render from the
 * start date and today's Melbourne date — a stored stage would need a sweep
 * to move jobs every morning, and would be wrong for the hours in between.
 */
export type Lane = VisibleStage | "booking_confirmed";
export const LANES: readonly Lane[] = [
  "offered", "booking_confirmed", "pre_start", "in_progress", "qa", "walkthrough", "closed",
];

/** How many days ahead a job may start and still count as Pre-start. */
export const PRE_START_WINDOW_DAYS = 7;

/** Whole days from one yyyy-mm-dd date to another; the strings are calendar
 *  dates so no zone is involved. */
const daysBetween = (from: string, to: string): number => {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
};

/**
 * The lane a job sits in. `today` is the Melbourne calendar date (yyyy-mm-dd)
 * — never `toISOString().slice(0, 10)`, which is the UTC date.
 *
 * A booked job with no start date is not due within a week of anything, so it
 * sits in Booking confirmed until one is set.
 */
export function laneFor(stage: WoStage, startDate: string | null, today: string): Lane {
  if (stage !== "pre_start") return visibleStage(stage);
  if (startDate === null) return "booking_confirmed";
  return daysBetween(today, startDate) <= PRE_START_WINDOW_DAYS ? "pre_start" : "booking_confirmed";
}

/** Lane numbering and wording on the project-progress bar and the stage rail. */
export const LANE_LABELS: Record<Lane, { n: string; title: string }> = {
  offered: { n: "01", title: "Offer" },
  booking_confirmed: { n: "02", title: "Booking confirmed" },
  pre_start: { n: "03", title: "Pre-start" },
  in_progress: { n: "04", title: "In progress" },
  qa: { n: "05", title: "Quality check" },
  walkthrough: { n: "06", title: "Walkthrough" },
  closed: { n: "07", title: "Closed — final invoice sent" },
};

/**
 * Stage numbering and wording where only the STAGE is known (a badge on the
 * job sheet, an invoice row). Pre-start carries its lane number; a job that
 * would display in Booking confirmed is labelled by `laneFor` where the start
 * date is to hand.
 */
export const STAGE_LANES: Record<WoStage, { n: string; title: string }> = {
  offered: LANE_LABELS.offered,
  pre_start: LANE_LABELS.pre_start,
  in_progress: LANE_LABELS.in_progress,
  qa: LANE_LABELS.qa,
  // Display identity of in_progress — never shown as its own lane or rail stop.
  completion_prep: LANE_LABELS.in_progress,
  walkthrough: LANE_LABELS.walkthrough,
  closed: LANE_LABELS.closed,
};

/**
 * Employed painters (brief §3.4): stage 1 is "Offer" for a contractor's job
 * and "Assigned" for a crew of employees. A LABEL derived from how the job
 * left stage 1 (`acceptance_mode: 'assigned'` on the stage_changed event, or
 * simply the presence of assignments) — the enum value never changes.
 */
export function stageTitle(stage: WoStage | Lane, mode: "offered" | "assigned" = "offered"): string {
  if (stage === "offered" && mode === "assigned") return "Assigned";
  return stage === "completion_prep" ? STAGE_LANES[stage].title : LANE_LABELS[stage].title;
}

export function findTransition(from: WoStage, to: WoStage): WoTransition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function isLegalTransition(from: WoStage, to: WoStage): boolean {
  return findTransition(from, to) !== undefined;
}

/** The moves a given actor may ask for from here — what the UI offers. */
export function nextStages(from: WoStage, actor: WoActor): WoTransition[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor));
}

/**
 * v1's `status` derived from the stage, mirroring public.wo_derive_status.
 * The contractor link, the schedule board and the status chips all still read
 * `status`; nothing types it by hand any more.
 */
export function deriveStatus(
  stage: WoStage,
  issuedAt: string | null,
): "draft" | "issued" | "in_progress" | "complete" {
  if (stage === "closed") return "complete";
  // Not started yet: the document decides draft vs issued. A booking can be
  // accepted before the estimate has a saved work-order document, so pre_start
  // reads issued_at exactly as offered does — see migration 20260929.
  if (stage === "offered" || stage === "pre_start") return issuedAt === null ? "draft" : "issued";
  return "in_progress";
}

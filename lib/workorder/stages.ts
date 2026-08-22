/**
 * The seven-stage work-order loop, mirrored from the database.
 *
 * `wo_stage_transitions`, re-seeded canonically in
 * 20261019000000_wo_autostart.sql, is the source of truth — the RPC reads that table, so the database is what actually
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
  { from: "pre_start", to: "in_progress", label: "pre-start checklist complete", actors: ["system", "staff"] },
  { from: "in_progress", to: "qa", label: "all surfaces done — QA is scheduled", actors: ["system", "staff", "contractor"] },
  { from: "in_progress", to: "completion_prep", label: "all surfaces done — no QA due", actors: ["system", "staff", "contractor"] },
  { from: "qa", to: "completion_prep", label: "QA passed", actors: ["staff"] },
  { from: "qa", to: "in_progress", label: "QA failed — rectification raised", actors: ["staff"] },
  { from: "completion_prep", to: "walkthrough", label: "evidence pack delivered", actors: ["system", "staff", "contractor"] },
  { from: "walkthrough", to: "closed", label: "signed off", actors: ["system", "staff", "customer"] },
  { from: "walkthrough", to: "in_progress", label: "area flagged — rectification raised", actors: ["staff", "customer"] },
];

/** Console lane numbering and wording — the mockup's "01 Offer" … "07 Closed". */
export const STAGE_LANES: Record<WoStage, { n: string; title: string }> = {
  offered: { n: "01", title: "Offer" },
  pre_start: { n: "02", title: "Pre-start" },
  in_progress: { n: "03", title: "In progress" },
  qa: { n: "04", title: "Quality check" },
  completion_prep: { n: "05", title: "Prep" },
  walkthrough: { n: "06", title: "Walkthrough" },
  closed: { n: "07", title: "Closed" },
};

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

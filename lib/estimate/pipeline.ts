import { ESTIMATE_STAGE_LABEL, PIPELINE_STAGES, type EstimateStageResult, type PipelineStage } from "@/lib/crm/estimateStage";

/**
 * Estimates tab session 4 (brief §4.2): the Pipeline — open estimates and
 * priced wizard sessions in lanes by their DERIVED stage. Pure: the loader
 * (`pipelineLoad.ts`) gathers, `estimateStageFor` decides the lane, this lays
 * the cards out. No drag, no stored lane.
 */

export type PipelineCard = {
  /** Estimate id, or `draft:<id>` for a session with no estimate yet. */
  key: string;
  href: string;
  name: string;
  address: string | null;
  brand: string | null;
  jobType: string | null;
  /** Integer cents: the estimate's total, or the session's estimate of value. */
  valueCents: number | null;
  /** True when the value is the wizard's guess, not a price (shown as "about"). */
  valueIsGuess: boolean;
  viewCount: number;
  cameBack: number;
  accountId: string | null;
  temperature: "hot" | "warm" | "cold" | null;
  snoozedUntil: string | null;
  stage: EstimateStageResult;
};

export type PipelineLane = { stage: PipelineStage; label: string; count: number; valueCents: number; cards: PipelineCard[] };
export type Pipeline = { lanes: PipelineLane[]; total: number; snoozed: number };

const IS_PIPELINE = new Set<string>(PIPELINE_STAGES);

/**
 * Lanes in stage order, every lane present even when empty. A card is on the
 * board when its stage is a Pipeline stage and it is not snoozed; snoozed ones
 * are counted, not shown. Within a lane: hot first, then the longest in stage.
 */
export function buildPipeline(cards: readonly PipelineCard[], now: Date): Pipeline {
  const nowMs = now.getTime();
  let snoozed = 0;
  const by = new Map<PipelineStage, PipelineCard[]>();
  for (const c of cards) {
    if (!IS_PIPELINE.has(c.stage.stage)) continue;
    if (c.snoozedUntil && Date.parse(c.snoozedUntil) > nowMs) { snoozed += 1; continue; }
    const k = c.stage.stage as PipelineStage;
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  const heat = (t: PipelineCard["temperature"]) => (t === "hot" ? 0 : t === "warm" ? 1 : t === "cold" ? 3 : 2);
  const lanes = PIPELINE_STAGES.map((stage) => {
    const laneCards = (by.get(stage) ?? []).sort((a, b) => heat(a.temperature) - heat(b.temperature) || a.stage.since.localeCompare(b.stage.since));
    return {
      stage, label: ESTIMATE_STAGE_LABEL[stage], count: laneCards.length,
      valueCents: laneCards.reduce((s, c) => s + (c.valueCents ?? 0), 0),
      cards: laneCards,
    };
  });
  return { lanes, total: lanes.reduce((s, l) => s + l.count, 0), snoozed };
}

/** "3 days" / "5 hours" / "just now" — how long the card has been in its stage. */
export function stageAge(since: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60_000));
  if (mins < 60) return mins < 2 ? "just now" : `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

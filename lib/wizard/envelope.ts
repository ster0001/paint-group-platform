import { priceEstimateTotals, type Adjustments, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { makeDraftSurface } from "@/lib/extract/draft";
import { doorCodeFor, doorStyleOfCode, windowRateCode } from "@/lib/extract/scope";
import { CUPBOARD_BY_ROOM_TYPE } from "./rooms-loop";
import type { WizardState } from "./state";
import type { BandSettings } from "./policy";

/**
 * THE RANGE ENVELOPE (Tom, 14 Sep 2026).
 *
 * The guide range used to be one total with a percentage band around it —
 * ±15% until the accuracy score crossed 70, then ±8%. Answering one detail
 * question crossed that line and the LOW end jumped $750 on a job that had
 * barely changed. The range was a statement about our confidence, not about
 * the job.
 *
 * Now the range is the job's best case and worst case: the same rooms
 * priced twice, once with every unanswered question at its cheapest answer
 * and once at its dearest. Answering a question takes it out of the
 * envelope, so the range can only narrow — the low end rises only when the
 * customer's answer added something (panel doors, robe doors), never
 * because we became surer. What stays uncertain after every question is
 * answered is the room sizes; that residual shrinks as rooms are confirmed,
 * from the wide band with none confirmed to the tight band with all of
 * them, by the share confirmed — a slope, never a step.
 *
 * No money is computed anywhere but here and lib/pricing: this module calls
 * `priceEstimateTotals` on two trees and rounds the ends outward.
 */

export type OpenQuestion = "doors" | "windows" | "height" | "cupboards";

export type Envelope = {
  loCents: number;
  hiCents: number;
  /** The half-spread as a percentage of the midpoint, for copy that says "±N%". */
  bandPct: number;
  /** The questions still holding the envelope open. */
  open: OpenQuestion[];
  /** How much of the tree the customer has confirmed, 0–1 (sizes residual). */
  confirmedShare: number;
};

type LooseBlock = Record<string, unknown> & {
  id?: unknown; kind?: unknown; type?: unknown; roomType?: unknown; H?: unknown;
  assumedFields?: unknown; customer?: { cup?: boolean | null } | null;
  surfaces?: Array<Record<string, unknown> & { id?: unknown; code?: unknown }>;
};

const DEAR_HEIGHT_M = 3.0;
const DEAR_WINDOW = "colonial_bay";

/** Which discrete questions are still open on this state and tree. */
export function openQuestions(state: WizardState | null, blocks: LooseBlock[], rateCodes: ReadonlySet<string>): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const interior = blocks.filter((b) => b.kind === "area" && b.type !== "Exterior");
  if (!interior.length) return out;
  const hasDoors = interior.some((b) => (b.surfaces ?? []).some((s) => doorStyleOfCode(String(s.code ?? "")) != null));
  if (hasDoors && (state?.details.doorStyle ?? "unsure") === "unsure") out.push("doors");
  const hasWindows = interior.some((b) => (b.surfaces ?? []).some((s) => String(s.code ?? "") === "Awning / Casement Window"));
  if (hasWindows && (state?.details.windowStyle ?? "unsure") === "unsure" && rateCodes.has(windowRateCode(DEAR_WINDOW) ?? "")) out.push("windows");
  if ((state?.details.ceilingHeight ?? "unsure") === "unsure" && interior.some((b) => Number(b.H) < DEAR_HEIGHT_M)) out.push("height");
  const cupboardOpen = interior.some((b) => {
    const cfg = CUPBOARD_BY_ROOM_TYPE[String(b.roomType ?? "")];
    return cfg && rateCodes.has(cfg.code) && (b.customer?.cup ?? null) === null
      && !(b.surfaces ?? []).some((s) => String(s.code ?? "") === cfg.code);
  });
  if (cupboardOpen) out.push("cupboards");
  return out;
}

/** The dearest honest resolution of every open question, applied to a copy of the tree. */
export function dearestTree(state: WizardState | null, blocks: LooseBlock[], open: OpenQuestion[], rateCodes: ReadonlySet<string>): LooseBlock[] {
  let nextId = Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0)])) + 1;
  const doorScope = state?.details.doorScope ?? "frame";
  const panelCode = doorCodeFor("panel", doorScope);
  const dearWindowCode = windowRateCode(DEAR_WINDOW);
  return blocks.map((b) => {
    if (b.kind !== "area" || b.type === "Exterior") return b;
    let surfaces = (b.surfaces ?? []).map((s) => ({ ...s }));
    if (open.includes("doors") && panelCode) {
      surfaces = surfaces.map((s) => (doorStyleOfCode(String(s.code ?? "")) === "flat" ? { ...s, code: panelCode } : s));
    }
    if (open.includes("windows") && dearWindowCode) {
      surfaces = surfaces.map((s) => (String(s.code ?? "") === "Awning / Casement Window" ? { ...s, code: dearWindowCode } : s));
    }
    if (open.includes("cupboards")) {
      const cfg = CUPBOARD_BY_ROOM_TYPE[String(b.roomType ?? "")];
      if (cfg && rateCodes.has(cfg.code) && (b.customer?.cup ?? null) === null && !surfaces.some((s) => String(s.code ?? "") === cfg.code)) {
        surfaces.push(makeDraftSurface(nextId++, cfg.code, cfg.unit, cfg.defaultCount, "ai_assumed", 0.5, []) as unknown as Record<string, unknown>);
      }
    }
    const H = open.includes("height") && Number(b.H) < DEAR_HEIGHT_M ? DEAR_HEIGHT_M : b.H;
    return { ...b, H, surfaces };
  });
}

/** The size residual: the wide band with nothing confirmed, the tight band with everything, a straight line between. */
export function sizeResidualPct(confirmedShare: number, bands: BandSettings): number {
  const share = Math.max(0, Math.min(1, confirmedShare));
  return bands.widePct - (bands.widePct - bands.tightPct) * share;
}

const roundLo = (cents: number) => Math.floor(cents / 1000) * 1000;
const roundHi = (cents: number) => Math.ceil(cents / 1000) * 1000;

export function envelopeFor(input: {
  blocks: LooseBlock[];
  state: WizardState | null;
  ctx: PricingContext;
  adj: Adjustments;
  bands: BandSettings;
  /** C12's commercial widening (⚑20), applied to both ends. */
  widenPct?: number;
  /** areaId → confirmed, from the confirm loop; null = nothing confirmed yet. */
  confirmed: Map<number, "pending" | "confirmed"> | null;
}): Envelope {
  const rateCodes = new Set(input.ctx.rateItems.map((r) => r.code));
  const priced = input.blocks.filter((b) => b.kind === "area" && b.isOption !== true);
  const open = openQuestions(input.state, priced, rateCodes);
  const cheap = priceEstimateTotals(priced as unknown as BlockInput[], input.ctx, input.adj).totalCents;
  const dear = open.length
    ? priceEstimateTotals(dearestTree(input.state, priced, open, rateCodes) as unknown as BlockInput[], input.ctx, input.adj).totalCents
    : cheap;
  const areas = priced.length;
  const confirmedCount = input.confirmed ? [...input.confirmed.values()].filter((s) => s === "confirmed").length : 0;
  const confirmedShare = areas ? Math.min(1, confirmedCount / areas) : 0;
  const residual = (sizeResidualPct(confirmedShare, input.bands) + (input.widenPct ?? 0)) / 100;
  const loCents = roundLo(Math.min(cheap, dear) * (1 - residual));
  const hiCents = roundHi(Math.max(cheap, dear) * (1 + residual));
  const mid = (loCents + hiCents) / 2;
  const bandPct = mid > 0 ? Math.round(((hiCents - loCents) / 2 / mid) * 100) : 0;
  return { loCents, hiCents, bandPct, open, confirmedShare };
}

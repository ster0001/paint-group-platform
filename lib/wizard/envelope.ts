import { priceEstimateTotals, type Adjustments, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { doorCodeFor, doorStyleOfCode, windowRateCode } from "@/lib/extract/scope";
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

/**
 * Tom, 14 Sep (round 2):
 *  - cupboards (robes, vanities, kitchen fronts, laundry) are ASSUMED NOT
 *    painted for the range — they are an add-on the editor asks per room,
 *    never part of "the whole interior", so they were inflating the worst
 *    case by 40% on a three-bed;
 *  - ceilings are ASSUMED 3 m or more until the customer answers, on BOTH
 *    ends of the range (the conservative reading), and the answer reprices;
 *  - a question counts as answered by the TREE (the confirmed height has
 *    left `assumedFields`), not by the quick-look state, which the editor's
 *    confirm_height never touches.
 */
export type OpenQuestion = "doors" | "windows" | "height";

export type Envelope = {
  loCents: number;
  hiCents: number;
  /** The half-spread as a percentage of the midpoint, for copy that says "±N%". */
  bandPct: number;
  /** The questions still holding the envelope open. */
  open: OpenQuestion[];
  /** How much of the tree the customer has confirmed, 0–1 (sizes residual). */
  confirmedShare: number;
  /** What answering each open question closes, in cents (the dear end for
   * doors/windows; both ends for height, priced at 3 m until answered). */
  closesCents: Partial<Record<OpenQuestion, number>>;
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
  // Height is open while any inside room still carries the ASSUMED height —
  // the editor's confirm_height strips "H" from assumedFields; the quick-look
  // state's ceilingHeight is not what it writes.
  if (interior.some((b) => Array.isArray(b.assumedFields) && (b.assumedFields as string[]).includes("H"))) out.push("height");
  return out;
}

/** Tom, 14 Sep: an unanswered ceiling height is priced at 3 m on BOTH ends. */
export function assumedHeightTree(blocks: LooseBlock[], open: OpenQuestion[]): LooseBlock[] {
  if (!open.includes("height")) return blocks;
  return blocks.map((b) => (b.kind === "area" && b.type !== "Exterior" && Array.isArray(b.assumedFields) && (b.assumedFields as string[]).includes("H") && Number(b.H) < DEAR_HEIGHT_M
    ? { ...b, H: DEAR_HEIGHT_M }
    : b));
}

/** The dearest honest resolution of every open question, applied to a copy of the tree. */
export function dearestTree(state: WizardState | null, blocks: LooseBlock[], open: OpenQuestion[], rateCodes: ReadonlySet<string>): LooseBlock[] {
  void rateCodes;
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
    return { ...b, surfaces };
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
  // Tom, 14 Sep: 3 m ceilings until answered — on both ends.
  const base = assumedHeightTree(priced, open);
  const cheap = priceEstimateTotals(base as unknown as BlockInput[], input.ctx, input.adj).totalCents;
  const dear = open.some((q) => q !== "height")
    ? priceEstimateTotals(dearestTree(input.state, base, open, rateCodes) as unknown as BlockInput[], input.ctx, input.adj).totalCents
    : cheap;
  // What each open question is worth: the dear tree without it (doors,
  // windows), or the base tree at 2.4 m instead of 3 m (height).
  const closesCents: Partial<Record<OpenQuestion, number>> = {};
  for (const q of open) {
    if (q === "height") {
      const lower = priceEstimateTotals(priced as unknown as BlockInput[], input.ctx, input.adj).totalCents;
      closesCents.height = Math.max(0, cheap - lower);
    } else {
      const without = open.filter((x) => x !== q);
      const dearWithout = without.some((x) => x !== "height")
        ? priceEstimateTotals(dearestTree(input.state, base, without, rateCodes) as unknown as BlockInput[], input.ctx, input.adj).totalCents
        : cheap;
      closesCents[q] = Math.max(0, dear - dearWithout);
    }
  }
  const areas = priced.length;
  const confirmedCount = input.confirmed ? [...input.confirmed.values()].filter((s) => s === "confirmed").length : 0;
  const confirmedShare = areas ? Math.min(1, confirmedCount / areas) : 0;
  const residual = (sizeResidualPct(confirmedShare, input.bands) + (input.widenPct ?? 0)) / 100;
  const loCents = roundLo(Math.min(cheap, dear) * (1 - residual));
  const hiCents = roundHi(Math.max(cheap, dear) * (1 + residual));
  const mid = (loCents + hiCents) / 2;
  const bandPct = mid > 0 ? Math.round(((hiCents - loCents) / 2 / mid) * 100) : 0;
  return { loCents, hiCents, bandPct, open, confirmedShare, closesCents };
}

/** Tom, 14 Sep: a "both" job's headline is the SUM of its two parts' envelopes. */
export function sumEnvelopes(parts: Envelope[]): Envelope {
  const loCents = parts.reduce((n, e) => n + e.loCents, 0);
  const hiCents = parts.reduce((n, e) => n + e.hiCents, 0);
  const mid = (loCents + hiCents) / 2;
  const open = [...new Set(parts.flatMap((e) => e.open))];
  const areas = parts.length;
  const confirmedShare = areas ? parts.reduce((n, e) => n + e.confirmedShare, 0) / areas : 0;
  const closesCents: Partial<Record<OpenQuestion, number>> = {};
  for (const e of parts) for (const [k, v] of Object.entries(e.closesCents)) closesCents[k as OpenQuestion] = (closesCents[k as OpenQuestion] ?? 0) + (v ?? 0);
  return { loCents, hiCents, bandPct: mid > 0 ? Math.round(((hiCents - loCents) / 2 / mid) * 100) : 0, open, confirmedShare, closesCents };
}


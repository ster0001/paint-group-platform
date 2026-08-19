import {
  priceArea,
  priceEstimateTotals,
  type Adjustments,
  type AreaInput,
  type BlockInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import { accuracyScore, roomConfidencePct, type ScoredArea } from "./accuracy";
import { rangeBandPct, rangeFromTotal, type BandSettings, type GuardrailDecision } from "./policy";

/**
 * The editor's view of the estimate: every room with its provenance and its
 * SERVER-priced dollars, plus totals, margin and the accuracy score. Both
 * wizard routes return exactly this after every mutation, so the editor never
 * computes a number of its own (W3: "every edit reprices server-side").
 */

export type WizardRoomView = {
  areaId: number;
  name: string;
  roomType: string | null;
  L: number;
  W: number;
  H: number;
  priceCents: number;
  /** confirmed = a human settled it · extracted = read from the plan ·
   *  typical = starter-list size · check = read but low-confidence. */
  status: "confirmed" | "extracted" | "typical" | "check";
  /** R1.4: from the ONE confidence function (accuracy.ts) — the same
   * credit() the header aggregates, docked for this room's open questions. */
  confidencePct: number;
  assumedFields: string[];
  surfaces: Array<{ label: string; count: number; coats: number }>;
};

export type WizardDeferred = {
  room: string;
  what: string;
  count: number;
  needs: string;
  /** The room node that raised the question; null = whole-job. */
  areaId?: number | null;
  /** Machine-readable category - consumers branch on this, not on the prose. */
  kind?: string;
};

export type WizardEditorPayload = {
  rooms: WizardRoomView[];
  totals: { subtotalCents: number; totalCents: number; contractorHours: number; marginCents: number };
  accuracyPct: number;
  deferred: WizardDeferred[];
  /** True while any area still has an assumed ceiling height. */
  heightUnconfirmed: boolean;
  /** Rule 2 was used: exterior widths came from the floorplan's room sums —
   * flagged at the top of the editor until a human confirms them. */
  exteriorWidthFromPlan: boolean;
  /** An exterior wall has no width at all — staff add it in the builder. */
  exteriorWidthMissing: boolean;
};

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; surfaces?: Array<Record<string, unknown>>;
};

/**
 * Step 8: what the CUSTOMER sees. Never a point price, never a margin, never
 * an internal label — a range whose width follows the accuracy score, room
 * cards with inclusions and confidence, and the guardrail verdict.
 */
export type CustomerRoomView = {
  areaId: number;
  name: string;
  summary: string;
  confidencePct: number;
  status: WizardRoomView["status"] | "stated";
};

export type CustomerPayload = {
  outcome: "reveal";
  rooms: CustomerRoomView[];
  rangeLoCents: number;
  rangeHiCents: number;
  bandPct: number;
  /** The SERVER's verdict on whether the tight band applied - the UI must
   * never re-derive this from a hardcoded threshold. */
  tightBand: boolean;
  accuracyPct: number;
  canAccept: boolean;
  walkthroughRequired: boolean;
  heightUnconfirmed: boolean;
  exteriorWidthFromPlan: boolean;
  exteriorWidthMissing: boolean;
  /** Customer-worded "we confirm on site" notes — never internal reasons. */
  confirmOnSite: string[];
};

export function customerPayload(
  payload: WizardEditorPayload,
  blocks: unknown[],
  decision: GuardrailDecision,
  bands: BandSettings,
): CustomerPayload {
  const loose = blocks as LooseBlock[];
  const rooms: CustomerRoomView[] = payload.rooms.map((r) => {
    const block = loose.find((b) => Number(b.id) === r.areaId);
    const origin = typeof block?.origin === "string" ? block.origin : "";
    const status = origin === "customer_stated" ? "stated" : r.status;
    const parts = r.surfaces.map((s) => (s.count > 1 ? `${s.count} × ${s.label.toLowerCase()}` : s.label.toLowerCase()));
    return {
      areaId: r.areaId,
      name: r.name,
      summary: parts.slice(0, 6).join(", ") + (parts.length > 6 ? "…" : ""),
      // R1.4: the card % IS the header's function — never a second lookup.
      confidencePct: r.confidencePct,
      status,
    };
  });

  const bandPct = rangeBandPct(payload.accuracyPct, bands);
  const { loCents, hiCents } = rangeFromTotal(payload.totals.totalCents, bandPct);

  return {
    outcome: "reveal",
    rooms,
    rangeLoCents: loCents,
    rangeHiCents: hiCents,
    bandPct,
    tightBand: payload.accuracyPct >= bands.tightMin,
    accuracyPct: payload.accuracyPct,
    canAccept: decision.canAccept,
    walkthroughRequired: decision.walkthroughRequired,
    heightUnconfirmed: payload.heightUnconfirmed,
    exteriorWidthFromPlan: payload.exteriorWidthFromPlan,
    exteriorWidthMissing: payload.exteriorWidthMissing,
    confirmOnSite: payload.deferred.map((d) =>
      d.room === "Whole job" || d.room === "Exterior"
        ? `${d.what} — confirmed before your final quote`
        : `${d.room}: ${d.what} — confirmed before your final quote`,
    ),
  };
}

function roomStatus(origin: string, confidence: number, assumed: string[]): WizardRoomView["status"] {
  if (origin === "human_confirmed" || origin === "") return "confirmed";
  if (assumed.includes("L") || assumed.includes("W")) return "typical";
  if (confidence < 0.7) return "check";
  return "extracted";
}

export function editorPayload(
  blocks: unknown[],
  ctx: PricingContext,
  adj: Adjustments,
  deferred: WizardDeferred[],
): WizardEditorPayload {
  const loose = blocks as LooseBlock[];
  const rooms: WizardRoomView[] = [];
  const scored: ScoredArea[] = [];
  let heightUnconfirmed = false;
  let exteriorWidthFromPlan = false;

  for (const b of loose) {
    if (b.kind !== "area") continue;
    const assumed = Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [];
    const origin = typeof b.origin === "string" ? b.origin : "";
    const confidence = typeof b.confidence === "number" ? b.confidence : 1;
    const priceCents = priceArea(b as unknown as AreaInput, ctx, adj);
    if (assumed.includes("H")) heightUnconfirmed = true;
    if (assumed.includes("width_from_plan")) exteriorWidthFromPlan = true;

    const scoredArea: ScoredArea = { priceCents, origin: origin || "human_confirmed", confidence, assumedFields: assumed };
    // R2b: an excluded side (isOption — "not painting") sits outside the
    // total, so it must sit outside the accuracy weighting too.
    if (b.isOption !== true) scored.push(scoredArea);
    const ownDeferred = deferred.filter((d) => d.areaId != null && d.areaId === Number(b.id)).length;
    rooms.push({
      areaId: Number(b.id) || 0,
      name: String(b.name ?? "Unnamed"),
      roomType: typeof b.roomType === "string" ? b.roomType : null,
      L: Number(b.L) || 0,
      W: Number(b.W) || 0,
      H: Number(b.H) || 0,
      priceCents,
      status: roomStatus(origin, confidence, assumed),
      confidencePct: roomConfidencePct(scoredArea, ownDeferred),
      assumedFields: assumed,
      surfaces: (b.surfaces ?? []).map((s) => ({
        label: String(s.internalLabel ?? s.code ?? ""),
        count: Number(s.count) || 1,
        coats: Number(s.coats) || 2,
      })),
    });
  }

  const totals = priceEstimateTotals(blocks as BlockInput[], ctx, adj);
  return {
    rooms,
    totals: {
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      contractorHours: Math.round(totals.contractorHours * 100) / 100,
      marginCents: totals.marginCents,
    },
    accuracyPct: accuracyScore(scored, deferred.length),
    deferred,
    heightUnconfirmed,
    exteriorWidthFromPlan,
    exteriorWidthMissing: deferred.some((d) => d.kind === "exterior_width" || /width measurement required/i.test(d.needs)),
  };
}

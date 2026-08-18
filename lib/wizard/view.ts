import {
  priceArea,
  priceEstimateTotals,
  type Adjustments,
  type AreaInput,
  type BlockInput,
  type PricingContext,
} from "@/lib/pricing/estimate";
import { accuracyScore, type ScoredArea } from "./accuracy";

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
};

export type WizardEditorPayload = {
  rooms: WizardRoomView[];
  totals: { subtotalCents: number; totalCents: number; contractorHours: number; marginCents: number };
  accuracyPct: number;
  deferred: WizardDeferred[];
  /** True while any area still has an assumed ceiling height. */
  heightUnconfirmed: boolean;
};

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; surfaces?: Array<Record<string, unknown>>;
};

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

  for (const b of loose) {
    if (b.kind !== "area") continue;
    const assumed = Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [];
    const origin = typeof b.origin === "string" ? b.origin : "";
    const confidence = typeof b.confidence === "number" ? b.confidence : 1;
    const priceCents = priceArea(b as unknown as AreaInput, ctx, adj);
    if (assumed.includes("H")) heightUnconfirmed = true;

    scored.push({ priceCents, origin: origin || "human_confirmed", confidence, assumedFields: assumed });
    rooms.push({
      areaId: Number(b.id) || 0,
      name: String(b.name ?? "Unnamed"),
      roomType: typeof b.roomType === "string" ? b.roomType : null,
      L: Number(b.L) || 0,
      W: Number(b.W) || 0,
      H: Number(b.H) || 0,
      priceCents,
      status: roomStatus(origin, confidence, assumed),
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
  };
}

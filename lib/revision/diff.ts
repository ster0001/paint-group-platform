/**
 * The revision diff — the working scope measured against the accepted scope,
 * priced change by change through the SAME engine that priced the estimate
 * (invoice-builder addendum §3: "the diff against the accepted scope IS the
 * variation set").
 *
 * The arithmetic is a CHAIN, not per-block re-pricing in isolation: starting
 * from the accepted blocks, each changed block is swapped in one at a time and
 * the whole-estimate total re-run, so a change's delta is "what this change
 * does to the total, given everything before it". Sundries, discount caps and
 * GST rounding all ride along, which gives the property the addendum's A4
 * gate demands: Σ deltas = working total − accepted total, TO THE CENT, by
 * construction. A final step swaps the estimate-level adjustments (discount,
 * modifiers, materials, rate overrides) so a knob change is its own line.
 *
 * Pure functions only — no client, no clock. The server action re-runs this
 * with the same inputs before any money is written (never trust the browser).
 */
import {
  priceEstimateTotals,
  type Adjustments,
  type AreaInput,
  type BlockInput,
  type PricingContext,
  type SurfaceInput,
} from "../pricing/estimate";
import { adjustmentsFrom } from "../pricing/context";
import { gstFromIncCents } from "../invoicing/gst";

/** The builder_state subset the diff reads. */
export type RevisionState = Record<string, unknown> & { blocks?: unknown };

export type RevisionChange = {
  /** Stable ref for one-variation-per-change: "block:<id>" or "adjustments". */
  blockRef: string;
  kind: "added" | "removed" | "changed" | "adjustments";
  title: string;
  detail: string;
  credit: boolean;
  /** Signed inc-GST delta this change makes to the job total. */
  deltaIncCents: number;
  /** abs(deltaIncCents) — what wo_variations.price_cents stores (credit flips). */
  priceIncCents: number;
  /** abs contractor-hours delta, 2dp. */
  hours: number;
  /** Signed contractor-hours delta — what the change does to the job's hours. */
  hoursDelta: number;
  /** wo_surfaces keys ("areaId:surfaceId") this change removes — the strike. */
  surfaceKeys: string[];
  /** The engine's line detail for the /v page. */
  pricedLines: { label: string; cents: number }[];
};

export type RevisionDiff = {
  changes: RevisionChange[];
  acceptedIncCents: number;
  workingIncCents: number;
};

/** builder_state blocks are the pricing inputs plus the builder's identity
 * fields — the ids are what make a stable per-change blockRef possible. */
type RevSurface = SurfaceInput & { id: number; internalLabel?: string; clientLabel?: string };
type RevArea = Omit<AreaInput, "surfaces"> & { id: number; name?: string; surfaces: RevSurface[] };
type RevLine = Extract<BlockInput, { kind: "line" }> & { id: number; name?: string };
type RevBlock = RevArea | RevLine;

const blockName = (b: RevBlock | undefined, fallback: string) =>
  (b && typeof b.name === "string" && b.name.trim()) || fallback;

const surfaceLabel = (s: RevSurface) =>
  (typeof s.clientLabel === "string" && s.clientLabel.trim()) ||
  (typeof s.internalLabel === "string" && s.internalLabel.trim()) ||
  s.code || "surface";

const blocksOf = (state: RevisionState): RevBlock[] =>
  Array.isArray(state.blocks) ? (state.blocks as RevBlock[]) : [];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Human summary of what changed inside one area block. */
function areaDetail(a: RevArea | undefined, w: RevArea | undefined): {
  detail: string; removedKeys: string[];
} {
  if (!a && w) {
    const labels = w.surfaces.map((s) => surfaceLabel(s)).join(", ");
    return { detail: labels ? `New area — ${labels}` : "New area", removedKeys: [] };
  }
  if (a && !w) {
    return {
      detail: "Whole area removed from scope",
      removedKeys: a.surfaces.map((s) => `${a.id}:${s.id}`),
    };
  }
  if (!a || !w) return { detail: "", removedKeys: [] };

  const before = new Map(a.surfaces.map((s) => [s.id, s]));
  const after = new Map(w.surfaces.map((s) => [s.id, s]));
  const bits: string[] = [];
  const removedKeys: string[] = [];
  for (const [id, s] of after) {
    if (!before.has(id)) bits.push(`added ${surfaceLabel(s)}`);
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(s))
      bits.push(`changed ${surfaceLabel(s)}`);
  }
  for (const [id, s] of before) {
    if (!after.has(id)) {
      bits.push(`removed ${surfaceLabel(s)}`);
      removedKeys.push(`${a.id}:${s.id}`);
    }
  }
  const dims =
    a.L !== w.L || a.W !== w.W || a.H !== w.H ? ["measurements changed"] : [];
  return { detail: [...bits, ...dims].join(" · ") || "details changed", removedKeys };
}

export function diffRevision(
  acceptedState: RevisionState,
  workingState: RevisionState,
  ctx: PricingContext,
): RevisionDiff {
  const adjA = adjustmentsFrom(acceptedState);
  const adjW = adjustmentsFrom(workingState);
  const blocksA = blocksOf(acceptedState);
  const blocksW = blocksOf(workingState);
  const byIdA = new Map(blocksA.map((b) => [b.id, b]));
  const byIdW = new Map(blocksW.map((b) => [b.id, b]));

  // Ordered walk: accepted order first (so removals land where the customer
  // remembers them), then any brand-new blocks in working order.
  const ids: number[] = [
    ...blocksA.map((b) => b.id),
    ...blocksW.filter((b) => !byIdA.has(b.id)).map((b) => b.id),
  ];

  const changes: RevisionChange[] = [];
  let current: RevBlock[] = blocksA;
  let prevTotals = priceEstimateTotals(current as BlockInput[], ctx, adjA);
  const acceptedIncCents = prevTotals.totalCents;

  for (const id of ids) {
    const a = byIdA.get(id);
    const w = byIdW.get(id);
    if (a && w && JSON.stringify(a) === JSON.stringify(w)) continue;

    const next: RevBlock[] = w
      ? a
        ? current.map((b) => (b.id === id ? w : b))
        : [...current, w]
      : current.filter((b) => b.id !== id);

    const nextTotals = priceEstimateTotals(next as BlockInput[], ctx, adjA);
    const deltaInc = nextTotals.totalCents - prevTotals.totalCents;
    const hoursDelta = round2(nextTotals.contractorHours - prevTotals.contractorHours);
    const hours = Math.abs(hoursDelta);

    const kind: RevisionChange["kind"] = !a ? "added" : !w ? "removed" : "changed";
    const name = blockName(w ?? a, (w ?? a)?.kind === "line" ? "Line item" : "Area");
    const isArea = (w ?? a)?.kind === "area";
    const { detail, removedKeys } = isArea
      ? areaDetail(a as RevArea | undefined, w as RevArea | undefined)
      : { detail: kind === "changed" ? "amount or details changed" : "", removedKeys: [] };

    if (deltaInc !== 0 || hours > 0) {
      changes.push({
        blockRef: `block:${id}`,
        kind,
        title:
          kind === "added" ? `${name} — added`
          : kind === "removed" ? `${name} — removed from scope`
          : `${name} — scope changed`,
        detail,
        credit: deltaInc < 0,
        deltaIncCents: deltaInc,
        priceIncCents: Math.abs(deltaInc),
        hours,
        hoursDelta,
        surfaceKeys: removedKeys,
        pricedLines: [
          {
            label:
              kind === "added" ? `${name} (measured & priced by the estimator)`
              : kind === "removed" ? `${name} — credit for work not done`
              : `${name} — net change`,
            cents: deltaInc,
          },
        ],
      });
    }
    current = next;
    prevTotals = nextTotals;
  }

  // Estimate-level knobs last: discount, modifiers, materials, overrides.
  if (JSON.stringify(adjA) !== JSON.stringify(adjW)) {
    const nextTotals = priceEstimateTotals(current as BlockInput[], ctx, adjW);
    const deltaInc = nextTotals.totalCents - prevTotals.totalCents;
    const hoursDelta = round2(nextTotals.contractorHours - prevTotals.contractorHours);
    const hours = Math.abs(hoursDelta);
    if (deltaInc !== 0 || hours > 0) {
      changes.push({
        blockRef: "adjustments",
        kind: "adjustments",
        title: "Pricing adjustments changed",
        detail: "Job-level settings (discount, condition, materials or rates)",
        credit: deltaInc < 0,
        deltaIncCents: deltaInc,
        priceIncCents: Math.abs(deltaInc),
        hours,
        hoursDelta,
        surfaceKeys: [],
        pricedLines: [{ label: "Job-level adjustment", cents: deltaInc }],
      });
    }
    prevTotals = nextTotals;
  }

  return { changes, acceptedIncCents, workingIncCents: prevTotals.totalCents };
}

/** The invariant A4 proves end-to-end, exported so tests can pin it cheaply. */
export function sumDeltas(diff: RevisionDiff): number {
  return diff.changes.reduce((s, c) => s + c.deltaIncCents, 0);
}

/** Ex-GST view of a signed inc delta — mirrors lib/invoicing/variation. */
export function deltaExCents(deltaIncCents: number): number {
  const sign = deltaIncCents < 0 ? -1 : 1;
  const abs = Math.abs(deltaIncCents);
  return sign * (abs - gstFromIncCents(abs));
}

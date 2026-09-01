/**
 * The exterior ANSWERS, applied to the area nodes — extracted verbatim from
 * the submit route (C15 step 3) so the DRAFT pricer and the SUBMIT path run
 * the same code. Two copies of "storeys give every side its height" is how a
 * drop-out gets valued differently from the estimate they'd have received.
 *
 * What it does (R2, unchanged): lays the four-elevation scaffold when nothing
 * measured the outside; adds the whole-job extras as placeholders; gives
 * unmeasured sides the storey height and typical lengths (tagged assumed);
 * turns condition/access/gear into review deferrals; prices a stated fence
 * length.
 */

import { exteriorExtrasNodes, starterExteriorNodes } from "./starter";
import { applyFenceLength } from "./scope-editor";
import { ALLOWANCE_CODES, rateFor, toggleExtrasItem, WEATHERED_MODIFIER_CODE, type LooseBlock } from "./sides";
import type { WizardState, WizardSurfaceKey } from "./state";
import type { DraftArea } from "@/lib/extract/draft";

export type MergedBundle = {
  areas: DraftArea[];
  skipped: Array<{ name: string; reason: string }>;
  deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }>;
  assumedCount: number;
};

export function applyExteriorAnswers(
  merged: MergedBundle,
  state: WizardState,
  nextId: () => number,
  tickedSurfaces: ReadonlySet<WizardSurfaceKey>,
): void {
  const wantsExterior = state.jobType === "exterior" || state.jobType === "both";
  if (!wantsExterior) return;

  // Feature #2: an exterior/both job that measured NO exterior surfaces still
  // needs the exterior scaffold — otherwise the estimator sees interior only.
  const hasExteriorNodes = merged.areas.some((a) => a.type === "Exterior");
  if (!hasExteriorNodes) {
    const scaffold = starterExteriorNodes(nextId, tickedSurfaces);
    merged.areas.push(...scaffold.areas);
    merged.deferred = merged.deferred.filter((d) => d.what !== "exterior envelope");
    merged.deferred.push(...scaffold.deferred);
  }

  // A2: ticked whole-job extras are never measured by an elevation read —
  // they always arrive as $0 placeholders to measure.
  const extras = exteriorExtrasNodes(nextId, tickedSurfaces);
  merged.areas.push(...extras.areas);
  merged.deferred.push(...extras.deferred);

  if (!state.exterior) return;
  const ext = state.exterior;

  // Storeys give every side its height; unmeasured sides take typical lengths
  // (12 m front/back, 14 m sides), tagged assumed until the confirm loop
  // settles them.
  const sideH = ext.storeys === "double" ? 5.2 : 2.6;
  for (const a of merged.areas) {
    if (a.type !== "Exterior" || a.areaType !== "surface") continue;
    if (!(Number(a.H) > 0)) {
      a.H = sideH;
      if (!a.assumedFields.includes("H")) a.assumedFields = [...a.assumedFields, "H"];
    }
    if (!(Number(a.L) > 0)) {
      a.L = /front|rear|back/i.test(a.name) ? 12 : 14;
      if (!a.assumedFields.includes("L")) a.assumedFields = [...a.assumedFields, "L"];
    }
  }

  // Weathered pricing itself moved to applyConditionPricing (Tom, 31 Aug:
  // condition must be IN the first price, not a jump at the end) — the amber
  // deferral here is only the fallback when the card can't price it.
  if (ext.condition === "peeling") {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1,
      needs: "needs eyes on it before a fixed price — prep scope and (pre-1970) a lead-safe check on the visit",
    });
  }
  // Access allowance pricing lives in applyConditionPricing too — the amber
  // deferral is its fallback when the card carries no allowance row.
  // Tom, 29 Aug: special access equipment is NOT priced by the wizard — the
  // estimator prices hire, delivery and set-up after confirming the need.
  for (const gear of ext.accessEquipment) {
    merged.deferred.push({
      room: "Exterior", areaId: null,
      what: gear === "scissor_lift" ? "scissor lift access"
        : gear === "boom_lift" ? "boom lift access" : "scaffold / platform access",
      count: 1,
      needs: "customer says this equipment is needed — NOT priced in the estimate; confirm hire, delivery and set-up with them",
    });
  }
  if (ext.extras.fence) {
    if (ext.extras.fenceMetres != null) {
      const priced = applyFenceLength(merged.areas as unknown as Parameters<typeof applyFenceLength>[0], ext.extras.fenceMetres);
      if (priced.ok) {
        merged.areas = priced.blocks as unknown as typeof merged.areas;
        merged.deferred = merged.deferred.filter((d) => !/fence/i.test(d.what));
      }
    } else {
      merged.deferred.push({
        room: "Exterior", areaId: null, what: "fence length", count: 1,
        needs: "customer isn't sure of the fence length — measure it on site",
      });
    }
  }
}

/** The slice of the pricing context this module needs — structural, so both
 * the submit route and the draft pricer can hand their ctx straight in. */
type ConditionCtx = {
  modifiers: ReadonlyArray<{ code: string; multiplier: number }>;
  rateItems: ReadonlyArray<{
    code: string; category: string;
    rate_2_coat?: number | null; charge_out_cents?: number | null;
  }>;
};

/** The builder's interior condition modifier for damage-tier answers. */
export const INTERIOR_POOR_MODIFIER_CODE = "COND-POOR";

/**
 * Tom, 31 Aug: the condition answers "adjust the quote quite substantially",
 * so they must be IN the price from the FIRST reveal — worst case up front,
 * never a jump when the confirm loop re-asks at the end.
 *
 * Prices what the wizard already asked, the same way the loop's Condition
 * card does (wizard-edit `loop_cond`):
 *  - exterior "weathered" → the EXT-WEATHERED labour modifier;
 *  - any ticked exterior access answer → the flat Access Allowance row;
 *  - interior damage tier ≥ 2 → the builder's Poor condition modifier.
 * When two condition modifiers apply (a Both job), the WORSE multiplier wins.
 * A code the live card can't price falls back to the amber deferral — the
 * pre-31-Aug behaviour, never a silent $0.
 *
 * Returns the modSel patch for builder_state; mutates merged.areas (the
 * allowance line) and merged.deferred (fallbacks) in place.
 */
export function applyConditionPricing(
  merged: MergedBundle,
  state: WizardState,
  nextId: () => number,
  ctx: ConditionCtx,
): Record<string, string> {
  const modSel: Record<string, string> = {};
  const findMod = (code: string) => ctx.modifiers.find((m) => m.code === code) ?? null;

  const candidates: Array<{ code: string; multiplier: number }> = [];

  if ((state.jobType === "exterior" || state.jobType === "both") && state.exterior) {
    const ext = state.exterior;
    if (ext.condition === "weathered") {
      const mod = findMod(WEATHERED_MODIFIER_CODE);
      if (mod) candidates.push(mod);
      else merged.deferred.push({
        room: "Exterior", areaId: null, what: "weathered paintwork", count: 1,
        needs: "extra preparation allowed for — confirm the prep scope at review",
      });
    }
    if (ext.access.length > 0) {
      const r = rateFor(ctx.rateItems, ALLOWANCE_CODES.access.code);
      const res = r
        ? toggleExtrasItem(
            merged.areas as unknown as LooseBlock[],
            ALLOWANCE_CODES.access.code, ALLOWANCE_CODES.access.label, true,
            nextId, r.chargeOutDollars,
          )
        : null;
      if (res?.ok) merged.areas = res.blocks as unknown as typeof merged.areas;
      else {
        for (const acc of ext.access) {
          merged.deferred.push({
            room: "Exterior", areaId: null,
            what: acc === "steep" ? "steep block" : acc === "tight" ? "tight side access" : "double-height entry",
            count: 1, needs: "access affects setup time — allow for it at review",
          });
        }
      }
    }
  }

  if (state.jobType !== "exterior" && state.details.damageTier >= 2) {
    const mod = findMod(INTERIOR_POOR_MODIFIER_CODE);
    if (mod) candidates.push(mod);
    // No fallback deferral: tier ≥ 2 already demands photos, which raise
    // their own damage-to-price deferral through the defect reader.
  }

  // One Condition slot in modSel — the worst case wins, per Tom's ruling.
  const worst = candidates.sort((a, b) => b.multiplier - a.multiplier)[0];
  if (worst) modSel.Condition = worst.code;
  return modSel;
}

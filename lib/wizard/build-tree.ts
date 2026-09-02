/**
 * The WIZARD PATH from answers to a priced tree, as one pure function.
 *
 * Extracted from draftValue.ts (C15) so three callers run the same code and
 * cannot drift: the draft pricer (what a drop-out was worth), the assistant's
 * guided build (S3 — an answered conversation IS a wizard state), and the
 * parity test that proves the two paths price identically. The submit route
 * still owns persistence and the floorplan path; this is the no-plan path's
 * starter → draft → answers → exterior → condition sequence, verbatim.
 */

import { ceilingHeightFrom, type WizardState, type WizardSurfaceKey } from "./state";
import {
  backfillTypicalSizes, markStarterProvenance, starterExtraction, starterRoomList,
  type StarterRoom, type TypicalSizeRow,
} from "./starter";
import { applyWizardAnswers } from "./merge";
import { applyConditionPricing, applyExteriorAnswers, type MergedBundle } from "./exteriorAnswers";
import { buildDraft, type DraftArea } from "@/lib/extract/draft";
import type { Alias, ScopeRule } from "@/lib/extract/scope";
import type { DefectRate } from "@/lib/capture/commit";
import type { PricingContext } from "@/lib/pricing/estimate";

export type TreeRefs = {
  rules: ScopeRule[];
  aliases: Alias[];
  defectRates: DefectRate[];
  typicals: TypicalSizeRow[];
};

export type BuiltTree = {
  areas: DraftArea[];
  deferred: MergedBundle["deferred"];
  skipped: MergedBundle["skipped"];
  assumedCount: number;
  /** Estimate-level modifier selection the condition answers chose. */
  modSel: Record<string, string>;
  /** The next free node id after the build. */
  nextId: number;
};

export type TreeSkip = "incomplete" | "has_plan" | "nothing_to_price";

export function buildTreeFromState(
  state: WizardState,
  refs: TreeRefs,
  ctx: PricingContext,
  startId = 1,
  /** The assistant's co-work build: rooms named in a brief replace the
   *  starter composition (same drafting code, different list). */
  roomsOverride: StarterRoom[] | null = null,
): BuiltTree | { skip: TreeSkip } {
  const wantsInterior = state.jobType !== "exterior";
  if (wantsInterior && !state.noPlan && state.planRunIds.length > 0) return { skip: "has_plan" };

  let nextId = startId;
  const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };

  if (wantsInterior) {
    if (!state.basics) return { skip: "incomplete" };
    const height = ceilingHeightFrom(state.details.ceilingHeight);
    const list = roomsOverride ?? starterRoomList(state.basics);
    const x = starterExtraction(list, refs.typicals, {
      heightM: height.assumed ? null : height.heightM,
      bedrooms: state.basics.bedrooms,
    });
    const draft = buildDraft(x, refs.rules, refs.aliases, { startId: nextId, defectRates: refs.defectRates });
    nextId = Math.max(nextId, ...draft.areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)]), 0) + 1;
    markStarterProvenance(draft.areas);
    backfillTypicalSizes(draft.areas, refs.typicals);
    merged.areas.push(...draft.areas);
    merged.skipped.push(...draft.skipped);
    merged.deferred.push(...draft.deferred);
    merged.assumedCount += draft.assumedCount;
  }

  const answered = applyWizardAnswers(merged, state, () => nextId++);
  const ticked = new Set<WizardSurfaceKey>(state.surfaces);
  applyExteriorAnswers(answered as MergedBundle, state, () => nextId++, ticked);
  if (answered.areas.length === 0) return { skip: "nothing_to_price" };

  const modSel = applyConditionPricing(answered as MergedBundle, state, () => nextId++, ctx);
  return {
    areas: answered.areas,
    deferred: answered.deferred,
    skipped: answered.skipped,
    assumedCount: answered.assumedCount,
    modSel,
    nextId,
  };
}

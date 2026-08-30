/**
 * What a part-finished wizard run is roughly worth (C15 step 3).
 *
 * The point: Tom's call rule is "$7,500 — worth an hour of the office's
 * time". Until now a draft carried no value, so the rule fell back to the
 * 80%-answered test. This prices a draft with the SUBMIT ROUTE'S OWN
 * functions — starterRoomList → starterExtraction → buildDraft →
 * applyWizardAnswers → applyExteriorAnswers → editorPayload — so the number
 * on the board is the number the customer would have been shown, not a
 * second opinion.
 *
 * Honesty rules:
 *   · A state that fails the full wizard schema is NOT priced. A guess built
 *     on half-answers dressed up as a dollar figure would put phone calls on
 *     the wrong desks.
 *   · A run with an uploaded floorplan is NOT priced here — its rooms live in
 *     extraction rows this pure function cannot see. The upload itself
 *     already fires the call prompt, which is the better signal anyway.
 */

import { wizardStateSchema, type WizardState, type WizardSurfaceKey } from "./state";
import { ceilingHeightFrom } from "./state";
import {
  backfillTypicalSizes, markStarterProvenance, starterExtraction, starterRoomList,
  type TypicalSizeRow,
} from "./starter";
import { applyWizardAnswers } from "./merge";
import { applyExteriorAnswers, type MergedBundle } from "./exteriorAnswers";
import { editorPayload } from "./view";
import { buildDraft } from "@/lib/extract/draft";
import { type Alias, type ScopeRule } from "@/lib/extract/scope";
import type { DefectRate } from "@/lib/capture/commit";
import { adjustmentsFrom } from "@/lib/pricing/context";
import type { PricingContext } from "@/lib/pricing/estimate";

export type DraftRefData = {
  rules: ScopeRule[];
  aliases: Alias[];
  defectRates: DefectRate[];
  typicals: TypicalSizeRow[];
};

export type DraftValue = { totalCents: number; accuracyPct: number };

/** Why a draft was not priced — stored nowhere, but the caller can log it. */
export type DraftValueSkip = "incomplete" | "has_plan" | "nothing_to_price";

export function estimateDraftValue(
  rawState: unknown,
  refs: DraftRefData,
  ctx: PricingContext,
): DraftValue | { skip: DraftValueSkip } {
  const parsed = wizardStateSchema.safeParse(rawState);
  if (!parsed.success) return { skip: "incomplete" };
  const state: WizardState = parsed.data;

  const wantsInterior = state.jobType !== "exterior";
  if (wantsInterior && !state.noPlan && state.planRunIds.length > 0) return { skip: "has_plan" };

  let nextId = 1;
  const merged: MergedBundle = { areas: [], skipped: [], deferred: [], assumedCount: 0 };

  if (wantsInterior) {
    if (!state.basics) return { skip: "incomplete" };
    const height = ceilingHeightFrom(state.details.ceilingHeight);
    const list = starterRoomList(state.basics);
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

  const payload = editorPayload(
    answered.areas,
    ctx,
    adjustmentsFrom({}),
    answered.deferred,
  );
  if (!(payload.totals.totalCents > 0)) return { skip: "nothing_to_price" };

  return { totalCents: payload.totals.totalCents, accuracyPct: payload.accuracyPct };
}

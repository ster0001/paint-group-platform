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

import { wizardStateSchema, type WizardState } from "./state";
import { buildTreeFromState, type TreeRefs } from "./build-tree";
import { editorPayload } from "./view";
import { adjustmentsFrom } from "@/lib/pricing/context";
import type { PricingContext } from "@/lib/pricing/estimate";

/** The reference data the wizard path needs — one shape, shared with the
 *  assistant's build (lib/wizard/build-tree.ts). */
export type DraftRefData = TreeRefs;

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

  // ONE pipeline with the submit route and the assistant (build-tree.ts).
  const built = buildTreeFromState(state, refs, ctx);
  if ("skip" in built) return { skip: built.skip };

  const payload = editorPayload(
    built.areas,
    ctx,
    adjustmentsFrom({ modSel: built.modSel }),
    built.deferred,
  );
  if (!(payload.totals.totalCents > 0)) return { skip: "nothing_to_price" };

  return { totalCents: payload.totals.totalCents, accuracyPct: payload.accuracyPct };
}

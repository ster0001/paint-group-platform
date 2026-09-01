import { test } from "vitest";
import assert from "node:assert/strict";
import { applyConditionPricing, INTERIOR_POOR_MODIFIER_CODE, type MergedBundle } from "./exteriorAnswers.ts";
import { ALLOWANCE_CODES, WEATHERED_MODIFIER_CODE } from "./sides.ts";
import { defaultExterior, defaultWizardState, type WizardState } from "./state.ts";

/**
 * Tom, 31 Aug 2026: the condition answers "adjust the quote quite
 * substantially", so they price from the FIRST reveal — the same modifier and
 * allowance the loop's Condition card applies, applied at submit.
 */

const ctx = {
  modifiers: [
    { code: WEATHERED_MODIFIER_CODE, multiplier: 1.8 },
    { code: INTERIOR_POOR_MODIFIER_CODE, multiplier: 1.35 },
  ],
  rateItems: [
    { code: ALLOWANCE_CODES.access.code, category: "Exterior", rate_2_coat: 2.6, charge_out_cents: 10000 },
  ],
};

const bundle = (): MergedBundle => ({ areas: [], skipped: [], deferred: [], assumedCount: 0 });

const exteriorState = (over: Partial<NonNullable<WizardState["exterior"]>> = {}): WizardState => ({
  ...defaultWizardState(),
  jobType: "exterior",
  exterior: { ...defaultExterior(), condition: "good", ...over },
});

test("weathered exterior prices the modifier at submit, with no amber double-up", () => {
  const m = bundle();
  let next = 1;
  const modSel = applyConditionPricing(m, exteriorState({ condition: "weathered" }), () => next++, ctx);
  assert.equal(modSel.Condition, WEATHERED_MODIFIER_CODE);
  assert.equal(m.deferred.length, 0, "priced means no amber fallback");
});

test("weathered without the modifier row falls back to the amber deferral", () => {
  const m = bundle();
  let next = 1;
  const modSel = applyConditionPricing(m, exteriorState({ condition: "weathered" }), () => next++,
    { ...ctx, modifiers: [] });
  assert.equal(modSel.Condition, undefined);
  assert.equal(m.deferred.some((d) => /weathered/.test(d.what)), true);
});

test("a ticked access answer lands the flat Access Allowance line at submit", () => {
  const m = bundle();
  let next = 1;
  applyConditionPricing(m, exteriorState({ access: ["steep"] }), () => next++, ctx);
  const extras = m.areas.find((a) => /Exterior - Extras/i.test(String(a.name)));
  assert.ok(extras, "the extras block was created");
  assert.equal(extras!.surfaces.some((s) => s.code === ALLOWANCE_CODES.access.code), true);
  assert.equal(m.deferred.length, 0);
});

test("interior damage tier 2+ prices the Poor condition modifier up front", () => {
  const m = bundle();
  let next = 1;
  const state: WizardState = { ...defaultWizardState(), jobType: "interior" };
  state.details = { ...state.details, damageTier: 3 };
  const modSel = applyConditionPricing(m, state, () => next++, ctx);
  assert.equal(modSel.Condition, INTERIOR_POOR_MODIFIER_CODE);
});

test("a Both job with weathered exterior AND heavy interior damage takes the WORSE multiplier", () => {
  const m = bundle();
  let next = 1;
  const state: WizardState = {
    ...defaultWizardState(),
    jobType: "both",
    exterior: { ...defaultExterior(), condition: "weathered" },
  };
  state.details = { ...state.details, damageTier: 3 };
  const modSel = applyConditionPricing(m, state, () => next++, ctx);
  assert.equal(modSel.Condition, WEATHERED_MODIFIER_CODE, "×1.8 beats ×1.35");
});

test("good condition, no access, light damage — no modifier, nothing added", () => {
  const m = bundle();
  let next = 1;
  const modSel = applyConditionPricing(m, exteriorState(), () => next++, ctx);
  assert.deepEqual(modSel, {});
  assert.equal(m.areas.length, 0);
  assert.equal(m.deferred.length, 0);
});

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

test("peeling & flaking exterior prices the Poor condition modifier up front (3 Sep)", () => {
  // Before 3 Sep 2026 "peeling" priced nothing — only the visit deferral — so
  // a job the customer marked as poor reached the painter with ordinary hours.
  const m = bundle();
  let next = 1;
  const modSel = applyConditionPricing(m, exteriorState({ condition: "peeling" }), () => next++, ctx);
  assert.equal(modSel.Condition, INTERIOR_POOR_MODIFIER_CODE);
});

test("peeling on a weathered card still takes the worse of the two", () => {
  const m = bundle();
  let next = 1;
  const state: WizardState = {
    ...defaultWizardState(), jobType: "both",
    exterior: { ...defaultExterior(), condition: "peeling" },
  };
  state.details = { ...state.details, damageTier: 1 };
  const modSel = applyConditionPricing(m, state, () => next++, ctx);
  assert.equal(modSel.Condition, INTERIOR_POOR_MODIFIER_CODE, "×1.35 — the interior tier 1 adds nothing");
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


// ---- Tom, 5 Sep 2026: read measurements beat the typical-size constants ----
import { applyExteriorAnswers, sideKeyOfName } from "./exteriorAnswers.ts";

test("a plan-read width and a photo-read height replace the 12/14 × 2.6 constants on that side only", () => {
  const b = bundle();
  applyExteriorAnswers(b, exteriorState(), (() => { let n = 1; return () => n++; })(), new Set(["weatherboards"]), {
    front: { L: 9.4, H: 3.1 },
    left: { L: 16.2 },
  });
  const side = (name: RegExp) => b.areas.find((a) => a.type === "Exterior" && a.areaType === "surface" && name.test(a.name))!;
  assert.equal(side(/front/i).L, 9.4);
  assert.equal(side(/front/i).H, 3.1);
  assert.ok(!side(/front/i).assumedFields.includes("L") && !side(/front/i).assumedFields.includes("H"));
  assert.equal(side(/left/i).L, 16.2);
  assert.equal(side(/left/i).H, 2.6);                  // height still typical → still flagged
  assert.ok(side(/left/i).assumedFields.includes("H"));
  assert.equal(side(/right/i).L, 14);                  // nothing read → the constant, flagged
  assert.ok(side(/right/i).assumedFields.includes("L"));
  assert.equal(side(/rear/i).L, 12);
});

test("nothing measured → exactly the old behaviour", () => {
  const b = bundle();
  applyExteriorAnswers(b, exteriorState({ storeys: "double" }), (() => { let n = 1; return () => n++; })(), new Set(["weatherboards"]));
  for (const a of b.areas.filter((a) => a.type === "Exterior" && a.areaType === "surface")) {
    assert.equal(a.H, 5.2);
    assert.ok(a.assumedFields.includes("L") && a.assumedFields.includes("H"));
  }
  assert.equal(sideKeyOfName("Exterior - Rear"), "back");
  assert.equal(sideKeyOfName("Exterior - Extras"), null);
});

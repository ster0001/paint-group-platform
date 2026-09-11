import { describe, expect, test } from "vitest";
import { requiresSiteCheck } from "./ladder";
import { DEFAULT_POLICY, evaluateGuardrails, type GuardrailAnswers } from "./policy";
import { defaultExterior, defaultWizardState } from "./state";

/**
 * C2 — audit 9.1. `requires_site_check` was decided twice in one file: derived
 * properly for the COLUMN at the end of the submit route, and passed as
 * `wantsExterior` into `evaluateGuardrails` a hundred lines earlier. An interior
 * job with condition photos was therefore told it could accept online while the
 * database said it could not, and the proving snapshot recorded the wrong
 * `walkthroughRequired` for exactly those jobs.
 *
 * These pin the derivation itself and the consequence at the ladder.
 */

const state = (over: Record<string, unknown> = {}) => ({ ...defaultWizardState(), ...over }) as Parameters<typeof requiresSiteCheck>[0]["state"];

describe("the clause 9.1 lost: condition photos, interior or exterior", () => {
  test("an INTERIOR job with one condition photo needs a person", () => {
    const s = state({ jobType: "interior", details: { ...defaultWizardState().details, damagePhotoCount: 1 } });
    expect(requiresSiteCheck({ state: s })).toBe(true);
  });

  test("condition photos counted from conditionSourceIds too", () => {
    const s = state({ jobType: "interior", conditionSourceIds: ["src-1"] });
    expect(requiresSiteCheck({ state: s })).toBe(true);
  });

  test("a plain interior job with no photos does NOT need one", () => {
    expect(requiresSiteCheck({ state: state({ jobType: "interior" }) })).toBe(false);
  });

  test("this is the bug: wantsExterior would have said false for both photo cases", () => {
    const withPhoto = state({ jobType: "interior", details: { ...defaultWizardState().details, damagePhotoCount: 1 } });
    const wantsExterior = withPhoto!.jobType !== "interior";
    expect(wantsExterior).toBe(false);                      // what was passed
    expect(requiresSiteCheck({ state: withPhoto })).toBe(true); // what is true
  });
});

describe("the exterior reasons survive the move", () => {
  const ext = (over: Record<string, unknown> = {}) =>
    state({ jobType: "exterior", exterior: { ...defaultExterior(), ...over } });

  test("an exterior job with no exterior answers needs a person", () => {
    expect(requiresSiteCheck({ state: state({ jobType: "exterior", exterior: null }) })).toBe(true);
  });
  test("double storey", () => { expect(requiresSiteCheck({ state: ext({ storeys: "double" }) })).toBe(true); });
  test("peeling", () => { expect(requiresSiteCheck({ state: ext({ condition: "peeling" }) })).toBe(true); });
  test("access equipment", () => { expect(requiresSiteCheck({ state: ext({ accessEquipment: ["scaffold"] }) })).toBe(true); });
  test("a metal fence", () => {
    const e = defaultExterior();
    expect(requiresSiteCheck({ state: ext({ extras: { ...e.extras, fenceType: "metal" } }) })).toBe(true);
  });
  test("an unpriceable target (floor, wall, shed)", () => {
    expect(requiresSiteCheck({ state: ext({ targets: ["house", "shed"] }) })).toBe(true);
  });
  test("'other' cladding", () => { expect(requiresSiteCheck({ state: ext({ substrates: ["other"] }) })).toBe(true); });
  test("a plain single-storey exterior does not, on its own", () => {
    expect(requiresSiteCheck({ state: ext() })).toBe(false);
  });
  test("interior + exterior together always does", () => {
    expect(requiresSiteCheck({ state: state({ jobType: "both", exterior: defaultExterior() }) })).toBe(true);
  });
});

describe("the stored column is ORed in, never replaced", () => {
  test("a flag the editor raised after submit survives a state that would not derive it", () => {
    // The editor sets the column for a custom surface, rot or a geometry flag
    // (wizard-edit :493 and :887). Deriving from state alone would forget it.
    expect(requiresSiteCheck({ state: state({ jobType: "interior" }), stored: true })).toBe(true);
  });
  test("a false column cannot soften a state that derives true", () => {
    const s = state({ jobType: "interior", details: { ...defaultWizardState().details, damagePhotoCount: 2 } });
    expect(requiresSiteCheck({ state: s, stored: false })).toBe(true);
  });
  test("no state and no column is false, not a crash", () => {
    expect(requiresSiteCheck({ state: null, stored: null })).toBe(false);
    expect(requiresSiteCheck({})).toBe(false);
  });
});

describe("the consequence at the ladder — what 9.1 actually cost", () => {
  const answers: GuardrailAnswers = {
    jobType: "interior", propertyKind: "house", heritageListed: "no", bodyCorporate: "no",
    asbestosSuspected: "no", builtPre1970: "no", damageTier: 1, postcode: "3000",
  };

  test("an interior job with a condition photo cannot accept online, and the snapshot says so", () => {
    const s = state({ jobType: "interior", details: { ...defaultWizardState().details, damagePhotoCount: 1 } });
    const siteCheck = requiresSiteCheck({ state: s });
    const d = evaluateGuardrails(answers, 400_000, 95, siteCheck, DEFAULT_POLICY, [], false);

    expect(siteCheck).toBe(true);
    expect(d.canAccept).toBe(false);
    expect(d.walkthroughRequired).toBe(true);          // what the snapshot records
    expect(d.reasons).toContain("site_check_required");
  });

  test("the old behaviour is the regression: passing wantsExterior let it accept", () => {
    const wantsExterior = false; // an interior job — what the route used to pass
    const wrong = evaluateGuardrails(answers, 400_000, 95, wantsExterior, DEFAULT_POLICY, [], false);
    expect(wrong.canAccept).toBe(true);               // the bug, pinned
    expect(wrong.walkthroughRequired).toBe(false);    // and the poisoned snapshot
  });

  test("both callers derive the same answer from the same estimate", () => {
    // submit passes state only; the scope page passes state + the stored column.
    const s = state({ jobType: "interior", details: { ...defaultWizardState().details, damagePhotoCount: 1 } });
    const atSubmit = requiresSiteCheck({ state: s });
    const onScopePage = requiresSiteCheck({ state: s, stored: atSubmit });
    expect(onScopePage).toBe(atSubmit);
    expect(onScopePage).toBe(true);
  });
});

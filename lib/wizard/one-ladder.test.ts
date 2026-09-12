import { describe, expect, test } from "vitest";
import {
  DEFAULT_BANDS, DEFAULT_POLICY, evaluateGuardrails, policyFromSettings,
  type GuardrailAnswers, type WizardPolicySettings,
} from "./policy";
import { ladderFor, mayFixOnline } from "./ladder";
import { defaultSidesLoop } from "./sides";

/**
 * C1 — one ladder. These are the audit findings the chunk closes, each written
 * so it fails again if the second source of truth ever comes back.
 *
 *   9.2  a cap changed in Settings moved rung 5 and nothing else, because three
 *        call sites re-derived it from `scope_editor.selfServe*` with their own
 *        hard-coded fallbacks.
 *   9.5  the same commercial site, asked two different ways, gave a trade actor
 *        two different outcomes.
 *   9.6  more than one function answered "can this be accepted online?".
 */

const answers = (over: Partial<GuardrailAnswers> = {}): GuardrailAnswers => ({
  jobType: "interior", propertyKind: "house", heritageListed: "no", bodyCorporate: "no",
  asbestosSuspected: "no", builtPre1970: "no", damageTier: 1, postcode: "3000",
  ...over,
});

/** The one decision, as every surface now takes it. */
/** Every total here clears DEFAULT_POLICY.minJobCents ($2,000) — below it the
 *  ladder answers `below_minimum` and never reaches the caps. */
const decide = (a: GuardrailAnswers, totalCents: number, accuracyPct: number, policy: WizardPolicySettings, trade = false) =>
  evaluateGuardrails(a, totalCents, accuracyPct, false, policy, [], trade);

describe("9.2 · the cap lives in one place", () => {
  test("lowering the interior cap in wizard_policy takes the accept away", () => {
    const a = answers();
    const wide = policyFromSettings({ interiorSelfServeCapCents: 600_000 });
    const tight = policyFromSettings({ interiorSelfServeCapCents: 500_000 });

    expect(decide(a, 550_000, 95, wide).canAccept).toBe(true);
    expect(decide(a, 550_000, 95, tight).canAccept).toBe(false);
    expect(decide(a, 550_000, 95, tight).reasons).toContain("over_self_serve_cap");
  });

  test("every surface reads the same settings row — a scope_editor cap cannot override it", () => {
    // The three deleted re-derivations all read `scope_editor`. Nothing does now:
    // a job under the wizard_policy cap accepts even when scope_editor disagrees.
    const policy = policyFromSettings({ interiorSelfServeCapCents: 900_000 });
    expect(decide(answers(), 800_000, 95, policy).canAccept).toBe(true);
  });

  test("the accuracy bar moves with the setting too", () => {
    const a = answers();
    const policy = policyFromSettings({ interiorSelfServeMinAccuracyPct: 95 });
    expect(decide(a, 400_000, 94, policy).canAccept).toBe(false);
    expect(decide(a, 400_000, 94, policy).reasons).toContain("accuracy_below_bar");
    expect(decide(a, 400_000, 95, policy).canAccept).toBe(true);
  });
});

describe("9.5 · the same site, asked two ways, answers the same", () => {
  const strataByKind = answers({ propertyKind: "commercial", commercialKind: "strata" });
  const strataBySegment = answers({ propertyKind: "commercial", commercialSegment: "strata" });

  test("a TRADE actor gets the same outcome from the kind question and the segment question", () => {
    const viaKind = decide(strataByKind, 400_000, 95, DEFAULT_POLICY, true);
    const viaSegment = decide(strataBySegment, 400_000, 95, DEFAULT_POLICY, true);
    expect(viaSegment.outcome).toBe(viaKind.outcome);
    expect(viaSegment.canAccept).toBe(viaKind.canAccept);
    expect(viaSegment.walkthroughRequired).toBe(viaKind.walkthroughRequired);
  });

  test("healthcare by segment is soft for trade, exactly as strata is", () => {
    const health = decide(answers({ propertyKind: "commercial", commercialSegment: "healthcare" }), 400_000, 95, DEFAULT_POLICY, true);
    expect(health.outcome).not.toBe("handoff");
  });

  test("an ANONYMOUS visitor still hands off on both paths — the relaxation is the trade account, not the question", () => {
    expect(decide(strataByKind, 400_000, 95, DEFAULT_POLICY, false).outcome).toBe("handoff");
    expect(decide(strataBySegment, 400_000, 95, DEFAULT_POLICY, false).outcome).toBe("handoff");
  });

  /**
   * C12: the seven gates are no longer a wall — height is sized in the tree
   * (a hall's bracket, an EWP line), hours is a loading, induction and
   * committees live on the brief. A stored gate answer changes nothing; the
   * segment ROW decides, and a range segment is a guide range with a person
   * confirming on every account.
   */
  test("a stored gate answer is ignored; a range segment reveals with a person confirming, trade or not", () => {
    const stored = answers({ propertyKind: "commercial", commercialSegment: "office", commercialGates: { height: "yes" } });
    for (const trade of [true, false]) {
      const d = decide(stored, 400_000, 95, DEFAULT_POLICY, trade);
      expect(d.outcome).toBe("reveal");
      expect(d.reasons).toContain("commercial_range");
      expect(d.reasons).not.toContain("commercial_gate_height");
      expect(d.walkthroughRequired).toBe(true);
      expect(d.canAccept).toBe(false);
    }
  });
});

describe("9.6 · one decision, and it never leaks", () => {
  test("no trade job accepts online, whatever the numbers say (⚑11)", () => {
    const d = decide(answers(), 400_000, 99, DEFAULT_POLICY, true);
    expect(d.canAccept).toBe(false);
    expect(d.reasons).toContain("trade_signoff");
  });

  test("exterior never accepts online, whatever the cap says", () => {
    const d = decide(answers({ jobType: "exterior" }), 400_000, 99, DEFAULT_POLICY);
    expect(d.canAccept).toBe(false);
    expect(d.reasons).toContain("exterior_signoff");
  });

  test("the reveal carries both what the customer told us and what the ladder added, once each", () => {
    // heritage_unsure comes from the answers; exterior_signoff is added by the
    // ladder. Both must survive to the reveal, and neither may accumulate.
    //
    // NOTE ON THE :338 COPY. C1 changed `const softReasons = reasons` to a copy.
    // That is DEFENSIVE, not a bug fix, and this test does not prove it: both
    // returns that hand back the bare `reasons` array (:238 hard_stop, :313
    // handoff) happen before the first push, so the alias never escaped and no
    // assertion through the public API can tell the two versions apart. The copy
    // stops the next reader of `reasons` after :338 — there is already one at
    // :346 — from silently seeing the ladder's additions as customer answers.
    const d = decide(answers({ jobType: "exterior", heritageListed: "unsure" }), 400_000, 99, DEFAULT_POLICY);
    expect(d.reasons).toContain("heritage_unsure");
    expect(d.reasons).toContain("exterior_signoff");
    expect(d.reasons.filter((r) => r === "exterior_signoff")).toHaveLength(1);
  });
});

/**
 * C7 — "may this price be fixed without a person?" is the same question 9.6
 * closed, asked at a new moment: the tap, not the render.
 *
 * The route could have written the three-clause expression itself — it is
 * short, and it was already written that way once. These tests exist so the
 * copy that would have drifted cannot: `mayFixOnline` is the only answer, and
 * `ladderFor` is a caller of it rather than a second implementation.
 */
describe("C7 · fixing a price online asks the same one ladder", () => {
  const ok = decide(answers(), 480_000, 95, DEFAULT_POLICY);

  test("a clean job under the cap and over the bar may fix online", () => {
    expect(ok.outcome).toBe("reveal");
    expect(mayFixOnline(ok)).toBe(true);
  });

  test("anything short of a reveal cannot — a job with no price has none to fix", () => {
    // Below the minimum job value: the ladder reveals nothing, so there is no
    // figure a fix could be made of. (A job merely OVER the acceptance cap
    // still reveals — the cap takes `canAccept`, not the range, which is the
    // case below.)
    const tiny = decide(answers(), 50_000, 95, DEFAULT_POLICY);
    expect(tiny.outcome).not.toBe("reveal");
    expect(mayFixOnline(tiny)).toBe(false);
  });

  test("over the acceptance cap still reveals a range — and still cannot be fixed online", () => {
    const big = decide(answers(), 50_000_000, 95, DEFAULT_POLICY);
    expect(big.outcome).toBe("reveal");
    expect(big.canAccept).toBe(false);
    expect(mayFixOnline(big)).toBe(false);
  });

  test("a walkthrough required takes it away even when everything else says yes", () => {
    // The exact stale-client case: the job qualified when the screen rendered,
    // then a flagged spot forced the walkthrough. `canAccept` can still be
    // true — `walkthroughRequired` is the separate veto, and dropping it from
    // the expression is the mistake this test exists to catch.
    expect(mayFixOnline({ ...ok, walkthroughRequired: true })).toBe(false);
  });

  test("`canAccept` alone is not enough, and neither is the outcome alone", () => {
    expect(mayFixOnline({ ...ok, canAccept: false })).toBe(false);
  });

  test("the tier and the fix door cannot disagree — ladderFor is a CALLER, not a copy", () => {
    for (const d of [ok, { ...ok, canAccept: false }, { ...ok, walkthroughRequired: true }]) {
      const ladder = ladderFor({
        accuracyPct: 95, decision: d, bands: DEFAULT_BANDS,
        sidesMeta: defaultSidesLoop(), deferred: [], hasExterior: false, hasPlan: false,
        pendingAreas: 0, visitSlots: [],
      });
      expect(ladder.selfServe).toBe(mayFixOnline(d));
    }
  });
});

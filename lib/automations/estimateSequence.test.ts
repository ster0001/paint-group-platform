import { describe, expect, it } from "vitest";
import { ESTIMATE_STEPS, expiryWords, type EstimateStepKey } from "./estimateSequence";
import { sequenceStepsDue } from "./leadSequence";
import { automationByKey } from "./registry";

/** E2–E7 (17 Nov 2026): what is due for a sent quote, from its stage and how long it has been there. */
const sent = "2026-11-10T00:00:00Z";
const at = (d: number) => new Date(Date.parse(sent) + d * 86_400_000);
const on = new Map<EstimateStepKey, number>(ESTIMATE_STEPS.map((s) => [s.key, s.defaultAfter]));
const facts = (over: Partial<Parameters<typeof sequenceStepsDue>[1]> = {}) => ({ stage: "estimate_sent", since: sent, claimed: new Set<string>(), conversationAt: null, ...over });
const keys = (d: number, f = facts()) => sequenceStepsDue(ESTIMATE_STEPS, f, at(d), on).map((s) => s.key);

describe("the estimate sequence E2–E7", () => {
  it("unopened: E2 text at 2 days, E3 chat at 5", () => {
    expect(keys(1.9)).toEqual([]);
    expect(keys(2)).toEqual(["estimate_unopened"]);
    expect(keys(5)).toEqual(["estimate_unopened_again"]);
    expect(keys(3.5)).toEqual([]); // E2 is never more than a day late
  });
  it("viewed, no reply: E4 at 2 days, E5 at 5, E7 at 14 — and nothing from the unopened steps", () => {
    const viewed = facts({ stage: "estimate_viewed" });
    expect(keys(2, viewed)).toEqual(["estimate_viewed_any_q"]);
    expect(keys(5, viewed)).toEqual(["estimate_viewed_worth"]);
    expect(keys(14, viewed)).toEqual(["estimate_viewed_held"]);
  });
  it("a question, a decision or a conversation stops them", () => {
    for (const stage of ["question_asked", "accepted", "declined", "expired", "revised"]) expect(keys(2, facts({ stage }))).toEqual([]);
    expect(keys(5, facts({ stage: "estimate_viewed", conversationAt: at(3).toISOString() }))).toEqual([]);
  });
  it("every step ships off, is marketing, and has an 'after' in days", () => {
    for (const s of ESTIMATE_STEPS) {
      expect(automationByKey(s.key)).toMatchObject({ defaultOff: true, consent: "marketing", audience: "customer" });
      expect(automationByKey(s.key)!.timing?.find((t) => t.id === "after")).toMatchObject({ default: s.defaultAfter, unit: "days" });
    }
  });
  it("words the valid-until day as Appendix A does", () => {
    expect(expiryWords("2026-10-02")).toBe("Fri 2 Oct");
    expect(expiryWords(null)).toBe("the date on your quote");
  });
});

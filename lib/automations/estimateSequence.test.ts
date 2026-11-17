import { describe, expect, it } from "vitest";
import { ESTIMATE_STEPS, expiryWarningDue, expiryWords, type EstimateStepKey } from "./estimateSequence";
import { DECLINE_REASON_CODES, declineReasonMissing, isTimingReason, reasonLinks } from "@/lib/estimate/declineReason";
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
    const followUps = new Set(["estimate_unopened", "estimate_unopened_again", "estimate_viewed_any_q", "estimate_viewed_worth", "estimate_viewed_held"]);
    for (const stage of ["question_asked", "accepted", "declined", "expired", "revised"]) expect(keys(2, facts({ stage })).filter((k) => followUps.has(k))).toEqual([]);
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


describe("E9–E12", () => {
  it("E9: from 9 am Melbourne a week before valid-until, for a day, only while the quote is open", () => {
    // valid until Tue 25 Nov 2026 → due Tue 18 Nov 09:00 (+11) = 17 Nov 22:00Z
    expect(expiryWarningDue("2026-11-25", "estimate_viewed", new Date("2026-11-17T21:59:00Z"), 7)).toBe(false);
    expect(expiryWarningDue("2026-11-25", "estimate_viewed", new Date("2026-11-17T22:00:00Z"), 7)).toBe(true);
    expect(expiryWarningDue("2026-11-25", "estimate_sent", new Date("2026-11-18T21:59:00Z"), 7)).toBe(true);
    expect(expiryWarningDue("2026-11-25", "estimate_sent", new Date("2026-11-18T22:00:00Z"), 7)).toBe(false);
    for (const stage of ["accepted", "declined", "expired", null]) expect(expiryWarningDue("2026-11-25", stage, new Date("2026-11-17T23:00:00Z"), 7)).toBe(false);
    expect(expiryWarningDue(null, "estimate_sent", new Date("2026-11-17T23:00:00Z"), 7)).toBe(false);
  });
  it("E10 the day it lapses; E11 on a decline; E12 sixty days after it", () => {
    const at = (d: number) => new Date(Date.parse(sent) + d * 86_400_000);
    const allOn = new Map<EstimateStepKey, number>(ESTIMATE_STEPS.map((s) => [s.key, s.defaultAfter]));
    const due = (stage: string, d: number) => sequenceStepsDue(ESTIMATE_STEPS, facts({ stage }), at(d), allOn).map((s) => s.key);
    expect(due("expired", 0.5)).toEqual(["estimate_expired_chat"]);
    expect(due("expired", 3.5)).toEqual(["estimate_expired_chat"]);
    expect(due("expired", 4.1)).toEqual([]);
    expect(due("declined", 0.1)).toEqual(["estimate_declined_reason"]);
    expect(due("declined", 60.2)).toEqual(["estimate_declined_timing"]);
  });
  it("E11 asks only a decline with no reason; E12 follows only Postponing; a chip stores the panel's words", () => {
    expect(declineReasonMissing(null)).toBe(true);
    expect(declineReasonMissing("  ")).toBe(true);
    expect(declineReasonMissing("Price")).toBe(false);
    expect(isTimingReason("Postponing — next autumn")).toBe(true);
    expect(isTimingReason("Price")).toBe(false);
    expect(DECLINE_REASON_CODES.timing.stored).toBe("Postponing");
    expect(reasonLinks("https://x/e/t/reason").split("\n")).toEqual([
      "Price: https://x/e/t/reason?r=price", "Timing: https://x/e/t/reason?r=timing",
      "Went with someone else: https://x/e/t/reason?r=other_quote", "Not going ahead: https://x/e/t/reason?r=not_going",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { LEAD_STEPS, conversationAt, leadRangeWords, leadStepsDue, streetOf, type LeadStepKey } from "./leadSequence";
import { automationByKey } from "./registry";

const range = "2026-11-16T00:00:00Z"; // Mon 11:00 Melbourne
const at = (h: number) => new Date(Date.parse(range) + h * 3_600_000);
const all = new Map<LeadStepKey, number>([["lead_range_reminder", 2], ["lead_range_nudge", 1], ["lead_range_human", 3]]);
const lead = (over: Partial<Parameters<typeof leadStepsDue>[0]> = {}) => ({ stage: "range_no_action", since: range, claimed: new Set<string>(), conversationAt: null, ...over });
const keys = (h: number, facts = lead(), on = all) => leadStepsDue(facts, at(h), on).map((s) => s.key);

describe("the lead sequence L1–L3 and L5–L7 (what is due)", () => {
  it("L1 at 2 h, L2 at a day, L3 at three days — each in its own window", () => {
    expect(keys(1.9)).toEqual([]);
    expect(keys(2)).toEqual(["lead_range_reminder"]);
    expect(keys(24)).toEqual(["lead_range_nudge"]);
    expect(keys(72)).toEqual(["lead_range_human"]);
  });
  it("⚑5: never late — 2 h past L1's moment, or a day past a chat step's, nothing is sent", () => {
    expect(keys(4)).toEqual([]);
    expect(keys(48)).toEqual([]);
    expect(keys(96)).toEqual([]);
  });
  it("a claimed step is never due again", () => {
    expect(keys(2, lead({ claimed: new Set(["lead_range_reminder"]) }))).toEqual([]);
  });
  it("a switched-off step is never due, and its timing comes from Settings", () => {
    expect(keys(2, lead(), new Map([["lead_range_nudge", 1]]))).toEqual([]);
    expect(keys(5, lead(), new Map([["lead_range_reminder", 5]]))).toEqual(["lead_range_reminder"]);
  });
  it("exit on stage change: a lead who tightened, asked for help or booked gets nothing", () => {
    for (const stage of ["tightening", "needs_help", "visit_requested", "estimate_sent", null]) expect(keys(24, lead({ stage }))).toEqual([]);
  });
  it("a conversation stops the chat steps, not the text", () => {
    const talking = lead({ conversationAt: at(3).toISOString() });
    expect(keys(24, talking)).toEqual([]);
    expect(keys(72, talking)).toEqual([]);
  });
  it("the sequence's own chat message is not a conversation; a customer's or a person's is", () => {
    const l2Claim = at(24).toISOString();
    const l2Row = { direction: "staff", created_at: new Date(at(24).getTime() + 2_000).toISOString() };
    expect(conversationAt([l2Row], range, [l2Claim])).toBeNull();
    expect(conversationAt([l2Row], range, [])).toBe(l2Row.created_at);
    const customer = { direction: "customer", created_at: at(30).toISOString() };
    expect(conversationAt([l2Row, customer], range, [l2Claim])).toBe(customer.created_at);
    const before = { direction: "customer", created_at: at(-1).toISOString() };
    expect(conversationAt([before], range, [])).toBeNull();
  });
  it("L5 an hour into tightening, L6 a day in; L7 four hours after the closer range — each only in its own stage", () => {
    const on = new Map<LeadStepKey, number>([...all, ["lead_tighten_resume", 1], ["lead_tighten_help", 1], ["lead_tightened_close", 4]]);
    const tightening = lead({ stage: "tightening" });
    expect(keys(0.9, tightening, on)).toEqual([]);
    expect(keys(1, tightening, on)).toEqual(["lead_tighten_resume"]);
    expect(keys(3.5, tightening, on)).toEqual([]);
    expect(keys(24, tightening, on)).toEqual(["lead_tighten_help"]);
    const closer = lead({ stage: "tightened_no_action" });
    expect(keys(4, closer, on)).toEqual(["lead_tightened_close"]);
    expect(keys(8.5, closer, on)).toEqual([]);
    // the range-stage steps never fire in a tightening stage, nor the other way round
    expect(keys(2, tightening, on)).toEqual(["lead_tighten_resume"]);
    expect(keys(1, lead(), on)).toEqual([]);
    expect(keys(24, lead({ stage: "tightening", conversationAt: at(3).toISOString() }), on)).toEqual([]);
  });
  it("every step is a default-off key in the registry, with an 'after' timing; all but L10 are marketing", () => {
    for (const s of LEAD_STEPS) {
      const a = automationByKey(s.key)!;
      expect(a).toMatchObject({ defaultOff: true, audience: "customer" });
      // L10 answers a request the customer made — a service message, so STOP-for-marketing does not stop it.
      expect(a.consent).toBe(s.key === "lead_visit_request_ack" ? undefined : "marketing");
      expect(a.timing?.find((t) => t.id === "after")).toMatchObject({ default: s.defaultAfter, unit: s.unit === "working_days" ? "days" : s.unit });
    }
  });
  it("L10 a working day after an unanswered visit request: office days, weekends and Settings holidays skipped", () => {
    const on = new Map<LeadStepKey, number>([["lead_visit_request_ack", 1]]);
    // Tue 17 Nov 10:00 Melbourne (+11) → due Wed 18 Nov 10:00.
    const tue10 = "2026-11-16T23:00:00Z";
    const asked = lead({ stage: "visit_requested", since: tue10 });
    const due = (iso: string, facts = asked, hol: ReadonlySet<string> = new Set()) => leadStepsDue(facts, new Date(iso), on, hol).map((s) => s.key);
    expect(due("2026-11-17T22:59:00Z")).toEqual([]);
    expect(due("2026-11-17T23:00:00Z")).toEqual(["lead_visit_request_ack"]);
    expect(due("2026-11-18T23:00:00Z")).toEqual([]); // a day late: never
    // Wednesday a holiday → Thursday 10:00.
    const hol = new Set(["2026-11-18"]);
    expect(due("2026-11-17T23:00:00Z", asked, hol)).toEqual([]);
    expect(due("2026-11-18T23:00:00Z", asked, hol)).toEqual(["lead_visit_request_ack"]);
    // Asked Friday 4 pm → one office hour Friday, eight on Monday → Monday 4 pm (+11 → 05:00Z).
    const fri = lead({ stage: "visit_requested", since: "2026-11-20T05:00:00Z" });
    expect(due("2026-11-23T04:59:00Z", fri)).toEqual([]);
    expect(due("2026-11-23T05:00:00Z", fri)).toEqual(["lead_visit_request_ack"]);
    // Answered (the stage moved on), or a conversation started: nothing.
    expect(due("2026-11-17T23:00:00Z", lead({ stage: "visit_booked", since: tue10 }))).toEqual([]);
    expect(due("2026-11-17T23:00:00Z", lead({ stage: "visit_requested", since: tue10, conversationAt: "2026-11-17T01:00:00Z" }))).toEqual([]);
  });
  it("words the range and the address as Appendix A does", () => {
    expect(leadRangeWords(640_000, 790_000)).toBe("$6,400–$7,900 inc. GST");
    expect(streetOf("12 Acacia Street, Northcote VIC 3070")).toBe("12 Acacia Street");
  });
});

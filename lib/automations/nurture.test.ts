import { describe, expect, it } from "vitest";
import { pickShowcase, suburbOf, type PickableShowcase } from "./showcasePick";
import { coldPerCustomer, coldSince, nurtureHour, quarterKey, seasonalLine, type ColdCandidate } from "./coldNurture";
import { sequenceStepsDue, LEAD_STEPS, type LeadStepKey } from "./leadSequence";
import { DEFAULT_MESSAGING } from "@/lib/messaging/config";

/** L4 and R5 (17 Nov 2026): which finished job to show, who is cold, once a quarter. */
const job = (over: Partial<PickableShowcase>): PickableShowcase => ({
  slug: "x", suburb: "Fitzroy", job_type: "interior", property_type: "home", published: true,
  price_low_cents: 800_000, price_high_cents: 900_000, completed_on: "2026-10-01", ...over,
});

describe("the showcase pick", () => {
  it("same suburb and type first, then same type, then any — published and priced only", () => {
    const jobs = [job({ slug: "a", suburb: "Fitzroy", job_type: "exterior" }), job({ slug: "b", suburb: "Northcote" }), job({ slug: "c", suburb: "Fitzroy" }), job({ slug: "d", price_low_cents: null })];
    expect(pickShowcase(jobs, { suburb: "fitzroy", jobType: "interior", brand: "paintgroup", paintHomeCapCents: 2_500_000 })?.slug).toBe("c");
    expect(pickShowcase(jobs, { suburb: "Carlton", jobType: "interior", brand: "paintgroup", paintHomeCapCents: 2_500_000 })?.slug).toMatch(/^[bc]$/);
    expect(pickShowcase(jobs, { suburb: null, jobType: null, brand: "paintgroup", paintHomeCapCents: 2_500_000 })).not.toBeNull();
    expect(pickShowcase([job({ published: false })], { suburb: null, jobType: null, brand: "paintgroup", paintHomeCapCents: 1 })).toBeNull();
  });
  it("Paint Home sees home jobs under its ceiling only", () => {
    const jobs = [job({ slug: "big", price_high_cents: 3_000_000 }), job({ slug: "biz", property_type: "business" })];
    expect(pickShowcase(jobs, { suburb: null, jobType: "interior", brand: "painthome", paintHomeCapCents: 2_500_000 })).toBeNull();
  });
  it("reads the suburb from an address line", () => {
    expect(suburbOf("12 Acacia Street, Northcote VIC 3070")).toBe("Northcote");
    expect(suburbOf("12 Acacia Street")).toBeNull();
  });
});

describe("L4 — ten days on", () => {
  it("due at 10 days at range_no_action", () => {
    const on = new Map<LeadStepKey, number>([["lead_range_last", 10]]);
    const since = "2026-11-01T00:00:00Z";
    const at = (d: number) => new Date(Date.parse(since) + d * 86_400_000);
    const f = { stage: "range_no_action", since, claimed: new Set<string>(), conversationAt: null };
    expect(sequenceStepsDue(LEAD_STEPS, f, at(9.9), on)).toHaveLength(0);
    expect(sequenceStepsDue(LEAD_STEPS, f, at(10), on).map((s) => s.key)).toEqual(["lead_range_last"]);
  });
});

describe("R5 — cold, once a quarter", () => {
  const now = new Date("2026-11-18T01:00:00Z"); // Wed 12:00 Melbourne
  const c = (over: Partial<ColdCandidate>): ColdCandidate => ({ id: "e", status: "declined", account_id: "a", created_at: "2026-06-01T00:00:00Z", sent_at: "2026-06-01T00:00:00Z", declined_at: "2026-07-01T00:00:00Z", valid_until: null, accepted_at: null, lead: false, ...over });
  it("cold 90 days after a decline, an expiry or a lead; not before, not after two years", () => {
    expect(coldSince(c({}), now)).toBe("2026-07-01T00:00:00Z");
    expect(coldSince(c({ declined_at: "2026-10-01T00:00:00Z" }), now)).toBeNull();
    expect(coldSince(c({ status: "draft", lead: true, created_at: "2026-07-01T00:00:00Z" }), now)).toBe("2026-07-01T00:00:00Z");
    expect(coldSince(c({ status: "expired", valid_until: "2026-07-15" }), now)).toBe("2026-07-15T00:00:00Z");
    expect(coldSince(c({ declined_at: "2024-01-01T00:00:00Z" }), now)).toBeNull();
    expect(coldSince(c({ status: "accepted" }), now)).toBeNull();
  });
  it("one per customer; none for a customer who went ahead or has anything recent", () => {
    expect(coldPerCustomer([c({ id: "e1" }), c({ id: "e2", created_at: "2026-05-01T00:00:00Z" })], now).map((x) => x.estimate.id)).toEqual(["e1"]);
    expect(coldPerCustomer([c({ id: "e1" }), c({ id: "e2", status: "accepted", accepted_at: "2026-08-01T00:00:00Z" })], now)).toHaveLength(0);
    expect(coldPerCustomer([c({ id: "e1" }), c({ id: "e2", status: "sent", sent_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" })], now)).toHaveLength(0);
  });
  it("the quarter, the hours and the season", () => {
    expect(quarterKey(now)).toBe("2026-Q4");
    expect(nurtureHour(now)).toBe(true);
    expect(nurtureHour(new Date("2026-11-17T22:00:00Z"))).toBe(false); // Wed 9 am
    expect(nurtureHour(new Date("2026-11-22T01:00:00Z"))).toBe(false); // Sunday
    expect(seasonalLine(now, DEFAULT_MESSAGING)).toBe(DEFAULT_MESSAGING.seasonalLineSpring);
    expect(seasonalLine(new Date("2026-07-01T02:00:00Z"), DEFAULT_MESSAGING)).toBe(DEFAULT_MESSAGING.seasonalLineWinter);
  });
});

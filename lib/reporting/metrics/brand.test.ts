import { describe, expect, it } from "vitest";
import type { MetricInput, Range } from "../core";
import { buildFunnel, funnelRows, hasPaintHomeSessions } from "./funnel";
import { byBrand } from "./marketing";

/**
 * Paint Home brief §6 — the dashboard split by shopfront: the funnel per
 * brand and the "By shopfront" marketing row, over a hand-made slice (no
 * database). Sessions with no brand are Paint Group's.
 */
const range: Range = { from: "2026-10-01", to: "2026-10-31" } as Range;
const draft = (id: string, over: Record<string, unknown> = {}) => ({
  id, started_at: "2026-10-10T01:00:00Z", email: null, estimate_id: null, converted_at: null, last_seen_at: null, lead_source: null,
  gate_version: null, gate_shown_at: null, gate_completed_at: null, range_shown_at: null, range_option: null, ...over,
});
const input = {
  now: new Date("2026-10-24T00:00:00Z"),
  estimates: [],
  funnel: {
    drafts: [
      draft("g1", { email: "a@x", estimate_id: "e1" }),
      draft("g2"),
      draft("p1", { brand: "painthome", email: "b@x", estimate_id: "e2", range_option: "speak" }),
      draft("p2", { brand: "painthome", range_option: "visit" }),
      draft("old", { brand: "painthome", started_at: "2026-09-01T01:00:00Z" }),
    ],
    web: [
      { name: "address_typed", audience: "painthome", visitor_id: "v1", occurred_at: "2026-10-10T01:00:00Z" },
      { name: "see_price", audience: "painthome", visitor_id: "v1", occurred_at: "2026-10-10T01:01:00Z" },
      { name: "address_typed", audience: "painthome", visitor_id: "v2", occurred_at: "2026-10-11T01:00:00Z" },
      { name: "see_price", audience: "home", visitor_id: "v3", occurred_at: "2026-10-11T01:00:00Z" },
      { name: "see_price", audience: "painthome", visitor_id: "v9", occurred_at: "2026-09-11T01:00:00Z" },
    ],
    estimates: [
      { id: "e1", status: "sent", sent_at: "2026-10-11T00:00:00Z", viewed_at: null, accepted_at: null, declined_at: null, lead_source: null },
      { id: "e2", status: "accepted", sent_at: "2026-10-11T00:00:00Z", viewed_at: "2026-10-12T00:00:00Z", accepted_at: "2026-10-13T00:00:00Z", declined_at: null, lead_source: null },
    ],
  },
} as unknown as MetricInput;

describe("the dashboard by shopfront (paint-home brief §6)", () => {
  it("the funnel can be kept to one brand; unbranded sessions are Paint Group's", () => {
    expect(funnelRows(input, range).map((r) => r.brand)).toEqual(["paintgroup", "paintgroup", "painthome", "painthome"]);
    expect(buildFunnel(input, range).started).toBe(4);
    expect(buildFunnel(input, range, "paintgroup").started).toBe(2);
    const ph = buildFunnel(input, range, "painthome");
    expect(ph.started).toBe(2);
    expect(ph.steps.find((s) => s.key === "accepted")?.count).toBe(1);
    expect(hasPaintHomeSessions(input, range)).toBe(true);
    expect(hasPaintHomeSessions(input, { from: "2026-11-01", to: "2026-11-30" } as Range)).toBe(false);
  });
  it("By shopfront: visits, address typed, see price, started, saved, sent, accepted, calls requested, visits booked — per brand", () => {
    const rows = byBrand.select(input, range);
    expect(rows).toEqual([
      { brand: "Paint Group", visits: 1, address_typed: 0, see_price: 1, started: 2, saved: 1, sent: 1, accepted: 0, calls_requested: 0, visits_booked: 0 },
      { brand: "Paint Home", visits: 2, address_typed: 2, see_price: 1, started: 2, saved: 1, sent: 1, accepted: 1, calls_requested: 1, visits_booked: 1 },
    ]);
  });
});

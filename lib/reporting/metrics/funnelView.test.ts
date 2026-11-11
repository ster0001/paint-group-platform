import { describe, expect, it } from "vitest";
import type { MetricInput, Range } from "../core";
import { buildFunnel, buildFunnelView, funnelCameBack, funnelPriceBands, funnelStepConversion, parsePriceBandsText, priceBandsFromSettings, PRICE_BANDS_CENTS, type FunnelEventRow } from "./funnel";

/**
 * Estimates tab session 5 — the Funnel view on seeded data, every number
 * counted by hand below (the brief's "done when": numbers match a hand count).
 *
 *   s1 phone  interior PG   what → beds → gate $3–4k → visit request · gave email · estimate accepted · came back
 *   s2 phone  interior PG   what → stopped on beds                    · no email
 *   s3 desk   exterior PH   what → beds → gate $10–14k, did nothing   · gave email · came back
 *   s4 desk   interior PG   started LAST month — outside the range
 */
const range: Range = { from: "2026-11-01", to: "2026-11-30" };
const at = (h: number, m = 0) => `2026-11-05T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const ev = (type: string, session: string, when: string, over: Partial<FunnelEventRow> = {}): FunnelEventRow =>
  ({ type, session_id: session, step: null, range_low: null, range_high: null, occurred_at: when, breakpoint: null, ...over });
const step = (t: "wizard_step_viewed" | "wizard_step_completed", s: string, st: string, when: string, bp: string) => ev(t, s, when, { step: st, breakpoint: bp });

const funnelEvents: FunnelEventRow[] = [
  step("wizard_step_viewed", "s1", "what", at(1), "mobile"), step("wizard_step_completed", "s1", "what", at(1, 1), "mobile"),
  step("wizard_step_viewed", "s1", "beds", at(1, 1), "mobile"), step("wizard_step_completed", "s1", "beds", at(1, 3), "mobile"),
  ev("gate_viewed", "s1", at(1, 4), { range_low: 300_000, range_high: 400_000, breakpoint: "mobile" }), ev("visit_request_made", "s1", at(1, 6)),
  step("wizard_step_viewed", "s2", "what", at(2), "mobile"), step("wizard_step_completed", "s2", "what", at(2, 2), "mobile"),
  step("wizard_step_viewed", "s2", "beds", at(2, 2), "mobile"),
  step("wizard_step_viewed", "s3", "what", at(3), "desktop"), step("wizard_step_completed", "s3", "what", at(3, 0), "desktop"),
  step("wizard_step_viewed", "s3", "beds", at(3, 0), "desktop"), step("wizard_step_completed", "s3", "beds", at(3, 5), "desktop"),
  ev("gate_viewed", "s3", at(3, 6), { range_low: 1_000_000, range_high: 1_400_000, breakpoint: "desktop" }),
];
const draft = (id: string, over: Record<string, unknown>) => ({ id, started_at: at(0), email: null, estimate_id: null, converted_at: null, last_seen_at: at(4), lead_source: "google", brand: null, job_type: "interior", visits: 1, ...over });
const input = {
  now: new Date("2026-11-20T00:00:00Z"), estimates: [],
  funnel: {
    drafts: [
      draft("s1", { email: "a@example.com", estimate_id: "e1", visits: 2, range_shown_at: at(1, 4) }),
      draft("s2", {}),
      draft("s3", { email: "c@example.com", brand: "painthome", job_type: "exterior", visits: 3, lead_source: "facebook", range_shown_at: at(3, 6) }),
      draft("s4", { started_at: "2026-10-20T00:00:00Z" }),
    ],
    estimates: [{ id: "e1", status: "accepted", sent_at: at(5), viewed_at: at(6), accepted_at: at(7), declined_at: null, lead_source: "google" }],
    funnelEvents,
    priceBands: [...PRICE_BANDS_CENTS],
  },
} as unknown as MetricInput;

describe("the Funnel view, hand-counted", () => {
  it("tiles: 3 started in November, 2 gave details, 1 accepted — the home card's own steps", () => {
    const v = buildFunnelView(input, range);
    expect(v.tiles).toEqual({ started: 3, gave_details: 2, accepted: 1 });
    const home = buildFunnel(input, range);
    expect(home.started).toBe(v.tiles.started);
    expect(home.steps.find((s) => s.key === "email")!.count).toBe(v.tiles.gave_details);
    expect(home.steps.find((s) => s.key === "accepted")!.count).toBe(v.tiles.accepted);
  });
  it("where they stop: what 3 saw / 3 on; beds 3 saw / 2 on (s2 stopped), median 3 min", () => {
    const v = buildFunnelView(input, range);
    const what = v.steps.find((s) => s.step === "what")!; const beds = v.steps.find((s) => s.step === "beds")!;
    expect([what.viewed, what.completed, what.stopped]).toEqual([3, 3, 0]);
    expect([beds.viewed, beds.completed, beds.stopped, beds.completed_pct]).toEqual([3, 2, 1, 67]);
    expect(beds.median_seconds).toBe(210); // s1 120 s, s3 300 s → 210
    expect(beds.worst).toBe(true);
    expect(what.worst).toBe(false); // nobody stopped there
    expect(beds.mobile).toMatchObject({ viewed: 2, completed: 1 });
    expect(beds.desktop).toMatchObject({ viewed: 1, completed: 1 });
  });
  it("price bands: s1 in $2–4k and acted, s3 in $9–12k and did not; the worst band is $9–12k", () => {
    const v = buildFunnelView(input, range);
    const by = Object.fromEntries(v.bands.map((b) => [b.band, b]));
    expect(by["$2k–4k"]).toMatchObject({ saw_range: 1, took_action: 1, dropped_pct: 0, worst: false });
    expect(by["$12k–18k"].saw_range).toBe(1); // mid of $10–14k is $12k
    expect(by["$12k–18k"]).toMatchObject({ took_action: 0, dropped_pct: 100, worst: true });
  });
  it("came back: s1 and s3 came back (2), s2 did not (1); of those who came back 2 gave details, 1 asked, 1 accepted", () => {
    const [back, not] = buildFunnelView(input, range).cameBack;
    expect(back).toMatchObject({ group: "came_back", sessions: 2, gave_details: 2, saw_range: 2, asked: 1, accepted: 1 });
    expect(not).toMatchObject({ group: "did_not", sessions: 1, gave_details: 0, saw_range: 0, asked: 0, accepted: 0 });
  });
  it("filters narrow the sessions every chart counts", () => {
    expect(buildFunnelView(input, range, { brand: "painthome", device: null, jobType: null, leadSource: null }).tiles.started).toBe(1);
    expect(buildFunnelView(input, range, { brand: null, device: "mobile", jobType: null, leadSource: null }).steps.find((s) => s.step === "beds")!.viewed).toBe(2);
    expect(buildFunnelView(input, range, { brand: null, device: null, jobType: "exterior", leadSource: null }).cameBack[0].sessions).toBe(1);
    expect(buildFunnelView(input, range, { brand: null, device: null, jobType: null, leadSource: "google" }).tiles).toEqual({ started: 2, gave_details: 1, accepted: 1 });
  });
  it("the three CSVs export the screen's rows, filters included", () => {
    expect(funnelStepConversion.select(input, range).map((r) => r.step).sort()).toEqual(["beds", "what"]);
    expect(funnelPriceBands.select(input, range).reduce((s, r) => s + r.saw_range, 0)).toBe(2);
    const ph = { ...input, funnelFilter: { brand: "painthome" as const, device: null, jobType: null, leadSource: null } };
    expect(funnelCameBack.select(ph, range).map((r) => r.sessions)).toEqual([1, 0]);
  });
});

describe("price bands from Settings (⚑3)", () => {
  it("reads the saved edges, and falls back to the default on anything malformed", () => {
    expect(priceBandsFromSettings({ bands_cents: [300_000, 500_000] })).toEqual([300_000, 500_000]);
    for (const bad of [null, {}, { bands_cents: [] }, { bands_cents: [500_000, 300_000] }, { bands_cents: [-1] }, { bands_cents: [150] }]) {
      expect(priceBandsFromSettings(bad)).toEqual([...PRICE_BANDS_CENTS]);
    }
  });
  it("the Settings box takes dollars, k for thousands, and refuses an order that goes down", () => {
    expect(parsePriceBandsText("2000, 4000 6k")).toEqual({ ok: true, cents: [200_000, 400_000, 600_000] });
    expect(parsePriceBandsText("$3000, $5000")).toEqual({ ok: true, cents: [300_000, 500_000] });
    expect(parsePriceBandsText("4000, 2000").ok).toBe(false);
    expect(parsePriceBandsText("").ok).toBe(false);
    expect(parsePriceBandsText("two thousand").ok).toBe(false);
  });
  it("a Settings band list changes the chart's rows", () => {
    const custom = { ...input, funnel: { ...input.funnel!, priceBands: [500_000] } } as MetricInput;
    expect(buildFunnelView(custom, range).bands.map((b) => [b.band, b.saw_range])).toEqual([["Under $5k", 1], ["$5k+", 1]]);
  });
});

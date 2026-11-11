import { describe, expect, it } from "vitest";
import { buildPriceBandDropout, buildStepConversion, type FunnelEventRow } from "./funnel";
import type { Range } from "../core";

/** Estimates tab & funnel, session 2 — the Funnel view's two counts, on seeded events. */
const range: Range = { from: "2026-11-01", to: "2026-11-30" };
const row = (type: string, session: string | null, at: string, over: Partial<FunnelEventRow> = {}): FunnelEventRow =>
  ({ type, session_id: session, step: null, range_low: null, range_high: null, occurred_at: at, ...over });
const step = (type: "wizard_step_viewed" | "wizard_step_completed", session: string, s: string, at = "2026-11-05T01:00:00Z") => row(type, session, at, { step: s });
const range_ = (session: string, low: number, high: number, at = "2026-11-05T02:00:00Z") => row("gate_viewed", session, at, { range_low: low, range_high: high });

describe("step conversion, counted in sessions", () => {
  const rows = [
    step("wizard_step_viewed", "s1", "what"), step("wizard_step_completed", "s1", "what"), step("wizard_step_viewed", "s1", "beds"),
    step("wizard_step_viewed", "s2", "what"), step("wizard_step_completed", "s2", "what"), step("wizard_step_viewed", "s2", "beds"), step("wizard_step_completed", "s2", "beds"),
    step("wizard_step_viewed", "s3", "what"),
    step("wizard_step_viewed", "s3", "what"), // a second view of the same step is the same session
  ];
  it("each step: who saw it, who went on, who stopped there", () => {
    expect(buildStepConversion(rows, range)).toEqual([
      { step: "what", viewed: 3, completed: 2, completed_pct: 67, stopped: 1 },
      { step: "beds", viewed: 2, completed: 1, completed_pct: 50, stopped: 1 },
    ]);
  });
  it("a caller's order wins, and a step nobody saw is left out", () => {
    expect(buildStepConversion(rows, range, ["beds", "storeys", "what"]).map((s) => s.step)).toEqual(["beds", "what"]);
  });
  it("events outside the range, or with no session, are not counted", () => {
    const extra = [step("wizard_step_viewed", "s9", "what", "2026-10-31T01:00:00Z"), row("wizard_step_viewed", null, "2026-11-05T01:00:00Z", { step: "what" })];
    expect(buildStepConversion([...rows, ...extra], range)[0].viewed).toBe(3);
  });
});

describe("drop-out by price band (R7)", () => {
  it("bands by the middle of the first range seen, and counts who did anything with it", () => {
    const rows = [
      range_("a", 300_000, 400_000), row("gate_cta_clicked", "a", "2026-11-05T02:05:00Z"),   // mid $3.5k, acted
      range_("b", 320_000, 380_000),                                                        // mid $3.5k, left
      range_("c", 1_000_000, 1_400_000), row("visit_request_made", "c", "2026-11-05T03:00:00Z"), // mid $12k, acted
      range_("d", 2_000_000, 2_600_000),                                                    // $18k+, left
      range_("e", 100_000, 150_000),                                                        // under $2k
    ];
    const bands = buildPriceBandDropout(rows, range);
    const by = Object.fromEntries(bands.map((b) => [b.band, b]));
    expect(bands.map((b) => b.band)).toEqual(["Under $2k", "$2k–4k", "$4k–6k", "$6k–9k", "$9k–12k", "$12k–18k", "$18k+"]);
    expect(by["$2k–4k"]).toMatchObject({ saw_range: 2, took_action: 1, dropped_pct: 50 });
    expect(by["$12k–18k"]).toMatchObject({ saw_range: 1, took_action: 1, dropped_pct: 0 });
    expect(by["$18k+"]).toMatchObject({ saw_range: 1, took_action: 0, dropped_pct: 100 });
    expect(by["Under $2k"].saw_range).toBe(1);
    expect(by["$6k–9k"]).toMatchObject({ saw_range: 0, dropped_pct: null });
  });
  it("an action before the range is not an action on it, and a later tighter range does not re-band the session", () => {
    const rows = [
      row("customer_message_sent", "a", "2026-11-05T01:00:00Z"),
      range_("a", 300_000, 400_000, "2026-11-05T02:00:00Z"),
      range_("a", 900_000, 1_000_000, "2026-11-05T04:00:00Z"),
    ];
    const by = Object.fromEntries(buildPriceBandDropout(rows, range).map((b) => [b.band, b]));
    expect(by["$2k–4k"]).toMatchObject({ saw_range: 1, took_action: 0 });
    expect(by["$9k–12k"].saw_range).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { MetricInput, Range } from "../core";
import { buildWizardRates, WIZARD_RATE_EVENT_TYPES } from "./funnel";

/**
 * Wizard mobile v5 §8 — "Where estimates go" reads gate → exact and
 * contact → booked as SESSIONS over a hand-made slice (no database).
 */
const range: Range = { from: "2026-10-01", to: "2026-10-31" } as Range;
const at = "2026-10-10T01:00:00Z";
const ev = (type: string, session_id: string | null, over: Partial<{ cta: string; from: string; occurred_at: string }> = {}) =>
  ({ type, session_id, cta: over.cta ?? null, from: over.from ?? null, occurred_at: over.occurred_at ?? at });
const draft = (id: string, brand: string | null = null) => ({ id, started_at: at, email: null, estimate_id: null, converted_at: null, last_seen_at: null, lead_source: null, brand });
const input = {
  now: new Date("2026-10-24T00:00:00Z"),
  estimates: [],
  funnel: {
    drafts: [draft("g1"), draft("g2"), draft("p1", "painthome"), draft("p2", "painthome")],
    estimates: [],
    wizardEvents: [
      ev("gate_viewed", "g1"), ev("gate_cta_clicked", "g1", { cta: "exact" }), ev("gate_cta_clicked", "g1", { cta: "exact" }), // two taps, one session
      ev("gate_viewed", "g2"), ev("gate_cta_clicked", "g2", { cta: "visit" }),
      ev("gate_viewed", "p1"), ev("gate_cta_clicked", "p1", { cta: "exact" }),
      ev("gate_viewed", "p2"),
      ev("gate_viewed", "unknown-session"), // a draft outside the window: counted unsplit, unknown to a brand
      ev("gate_viewed", null), // no session is not a session
      ev("gate_viewed", "old", { occurred_at: "2026-09-01T00:00:00Z" }),
      ev("contact_opened", "g2"), ev("contact_opened", "p1"), ev("contact_opened", "p2"),
      ev("visit_booked", "p1", { from: "contact" }), ev("visit_booked", "g2", { from: "gate" }),
    ],
  },
} as unknown as MetricInput;

describe("gate → exact and contact → booked (wizard mobile v5 §8)", () => {
  it("counts sessions, never taps; leaves out events with no session or outside the window", () => {
    expect(buildWizardRates(input, range)).toEqual({
      gate_viewed: 5, gate_exact: 2, gate_exact_pct: 40,
      contact_opened: 3, contact_booked: 1, contact_booked_pct: 33,
    });
  });
  it("keeps one shopfront by the session's draft; a session with no draft in the window belongs to neither", () => {
    expect(buildWizardRates(input, range, "painthome")).toEqual({ gate_viewed: 2, gate_exact: 1, gate_exact_pct: 50, contact_opened: 2, contact_booked: 1, contact_booked_pct: 50 });
    expect(buildWizardRates(input, range, "paintgroup")).toEqual({ gate_viewed: 2, gate_exact: 1, gate_exact_pct: 50, contact_opened: 1, contact_booked: 0, contact_booked_pct: 0 });
  });
  it("says nothing rather than 0% when nobody reached the step", () => {
    const r = buildWizardRates({ ...input, funnel: { drafts: [], estimates: [], wizardEvents: [] } } as unknown as MetricInput, range);
    expect(r).toEqual({ gate_viewed: 0, gate_exact: 0, gate_exact_pct: null, contact_opened: 0, contact_booked: 0, contact_booked_pct: null });
    expect(WIZARD_RATE_EVENT_TYPES).toEqual(["gate_viewed", "gate_cta_clicked", "contact_opened", "visit_booked"]);
  });
});

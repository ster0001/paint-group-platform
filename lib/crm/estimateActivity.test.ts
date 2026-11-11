import { describe, expect, it } from "vitest";
import { activityGroup, buildEstimateActivity, dwellText, filterActivity, type ActivityEventRow } from "./estimateActivity";

const ev = (id: string, type: string, at: string, over: Partial<ActivityEventRow> = {}): ActivityEventRow =>
  ({ id, type, payload: {}, occurred_at: at, source: "system", ...over });

describe("the estimate Activity (R16, E‑L)", () => {
  it("is the log, newest first, in the timeline's words", () => {
    const { rows } = buildEstimateActivity({
      events: [ev("1", "estimate_sent", "2026-11-01T01:00:00Z"), ev("2", "estimate_accepted", "2026-11-03T01:00:00Z", { source: "customer" })],
      views: [], legacy: [],
    });
    expect(rows.map((r) => r.type)).toEqual(["estimate_accepted", "estimate_sent"]);
    expect(rows[0].label).not.toBe("estimate_accepted");
  });
  it("keeps one row when the accountless copy and the account copy share a moment", () => {
    const { rows } = buildEstimateActivity({ events: [ev("1", "estimate_sent", "2026-11-01T01:00:00Z"), ev("2", "estimate_sent", "2026-11-01T01:00:00Z")], views: [], legacy: [] });
    expect(rows).toHaveLength(1);
  });
  it("each open says how long the customer stayed (estimate_views.dwell_ms)", () => {
    const { rows } = buildEstimateActivity({
      events: [ev("1", "estimate_viewed", "2026-11-02T01:00:00Z", { payload: { viewNumber: 1 } }), ev("2", "estimate_viewed", "2026-11-02T05:00:00Z", { payload: { viewNumber: 2 } })],
      views: [{ created_at: "2026-11-02T01:00:00.000Z", dwell_ms: 200_000 }, { created_at: "2026-11-02T05:00:00Z", dwell_ms: 0 }],
      legacy: [],
    });
    expect(rows.find((r) => r.id === "1")!.detail).toContain("stayed 3 min 20 sec");
    expect(rows.find((r) => r.id === "2")!.detail).toContain("stayed under 15 sec");
  });
  it("older activity: the pre-log rows with no event on the log, and opens the log never recorded", () => {
    const { older } = buildEstimateActivity({
      events: [ev("1", "estimate_sent", "2026-11-01T01:02:00Z")],
      views: [{ created_at: "2026-10-01T01:00:00Z", dwell_ms: 40_000 }],
      legacy: [
        { type: "sent", created_at: "2026-11-01T01:00:00Z" },        // on the log within 10 min → not older
        { type: "email_sent", created_at: "2026-11-01T01:00:05Z" },  // never on the log
        { type: "accepted", created_at: "2026-11-05T00:00:00Z" },    // accountless before 20270312
        { type: "viewed", created_at: "2026-10-01T01:00:00Z" },      // the per-open row carries it
        { type: "something_else", created_at: "2026-11-01T00:00:00Z" },
      ],
    });
    expect(older.map((o) => o.label)).toEqual(["Accepted", "Emailed to customer", "Opened by customer"]);
    expect(older[2].detail).toBe("stayed 40 sec");
  });
  it("groups: messages, wizard, staff — and the filter keeps only that group", () => {
    expect(activityGroup("message_out", "staff")).toBe("messages");
    expect(activityGroup("wizard_step_viewed", "customer")).toBe("wizard");
    expect(activityGroup("gate_viewed", "customer")).toBe("wizard");
    expect(activityGroup("note_added", "staff")).toBe("staff");
    expect(activityGroup("estimate_sent", "system")).toBe("other");
    const { rows } = buildEstimateActivity({ events: [ev("1", "note_added", "2026-11-01T00:00:00Z", { source: "staff" }), ev("2", "wizard_step_viewed", "2026-11-01T00:01:00Z", { source: "customer" })], views: [], legacy: [] });
    expect(filterActivity(rows, "staff").map((r) => r.id)).toEqual(["1"]);
    expect(filterActivity(rows, "all")).toHaveLength(2);
  });
  it("dwell reads like the old panel", () => {
    expect(dwellText(null)).toBe("under 15 sec");
    expect(dwellText(45_000)).toBe("45 sec");
    expect(dwellText(120_000)).toBe("2 min");
  });
});

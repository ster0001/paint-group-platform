import { describe, expect, it } from "vitest";
import { buildWizardItems, type WizardQueueRow } from "./work-queue";

// Tom, 8 Sep: a visit booked from the wizard's help bar is already in the
// Diary — Today must not raise a second "book visit" card for it.
const row = (over: Partial<WizardQueueRow>): WizardQueueRow => ({
  id: "w1", account_id: "a1", estimate_id: null, name: "Ada", email: "ada@example.com", phone: "0400 000 000", address: "7 Wattle Ct", suburb: "Thornbury",
  job_type: "interior", bucket: "ready_visit", outcome: "visit_requested", outcome_at: "2026-09-08T09:00:00Z", outcome_note: null,
  dropped_at: null, furthest_page: 3, pages_total: 6, active_seconds: 120, last_seen_at: "2026-09-08T09:00:00Z", est_value_cents: null, entry_source: null,
  ...over,
});

describe("wizard work items — visits booked from the help bar", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  it("a plain visit request raises the 'Book visit' card", () => {
    const items = buildWizardItems([row({})], [], now);
    expect(items.map((i) => i.title)).toEqual(["Book visit — Ada"]);
  });
  it("a visit already booked ('Booked: …') raises nothing", () => {
    const items = buildWizardItems([row({ outcome_note: "Booked: Tue 9 Sep, 9:00 am with Sam (on Property)" })], [], now);
    expect(items).toEqual([]);
  });
  it("a call request is untouched by the rule", () => {
    const items = buildWizardItems([row({ bucket: "ready_call", outcome: "call_requested", outcome_note: "Booked: nonsense" })], [], now);
    expect(items.map((i) => i.kind)).toEqual(["wizard_ready"]);
  });
});

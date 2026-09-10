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

/**
 * ⚑ THE ANONYMOUS CALL REQUEST — the thing that tells somebody to ring.
 *
 * ⚑1 (estimator journey v2 phase 2) moved the email gate off the price, so a
 * customer who asks for a call back before keeping their estimate has NO email,
 * NO name and NO account. Every earlier test here has all three. This is the
 * shape the office now actually gets, and the question worth answering in a
 * test rather than by squinting at a queue of 800 items: does the card exist,
 * and can somebody act on it?
 */
describe("a call request from an anonymous quick look", () => {
  const now = new Date("2026-09-10T10:00:00Z");
  const anon = (over: Partial<WizardQueueRow> = {}) => row({
    account_id: null, email: null, name: null,
    estimate_id: "e-123", bucket: "ready_call", outcome: "call_requested",
    outcome_at: "2026-09-10T09:30:00Z", address: "14 Acacia Street, Northcote",
    phone: "0400 111 222", ...over,
  });

  it("raises the Call card with no account, no email and no name", () => {
    const items = buildWizardItems([anon()], [], now);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("wizard_ready");
    // Named by the ADDRESS, because that is all we were given — and it is what
    // tells the estimator which job it is.
    expect(items[0].title).toBe("Call 14 Acacia Street, Northcote — confirm price");
  });

  it("carries the phone they typed, so the card is actionable", () => {
    // Without this the card is a reminder to ring somebody whose number is in
    // another screen. It is the one field that makes it work.
    expect(buildWizardItems([anon()], [], now)[0].detail).toContain("0400 111 222");
  });

  it("links to the estimate, since there is no customer record to open", () => {
    expect(buildWizardItems([anon()], [], now)[0].action?.href).toBe("/quote?id=e-123");
  });

  it("is due in hours, not days", () => {
    const due = new Date(buildWizardItems([anon()], [], now)[0].dueAt!).getTime();
    expect(due).toBeGreaterThan(now.getTime());
    expect(due - now.getTime()).toBeLessThan(3 * 24 * 3600 * 1000);
  });

  it("is never suppressed by another customer's call attempt", () => {
    // The callback rule retires an item when a call is logged on ITS account.
    // An account-less row has no account to match, and a row that vanished
    // because somebody rang a different customer would be the worst bug here.
    const attempts = [{ account_id: "someone-else", occurred_at: "2026-09-10T09:45:00Z" }];
    expect(buildWizardItems([anon()], attempts, now)).toHaveLength(1);
  });

  it("still falls back to the suburb when even the address is missing", () => {
    const items = buildWizardItems([anon({ address: null, suburb: "Northcote" })], [], now);
    expect(items[0].title).toBe("Call Northcote — confirm price");
  });
});

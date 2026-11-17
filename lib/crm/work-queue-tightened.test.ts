import { describe, expect, it } from "vitest";
import { buildTightenedCallItems, buildWizardItems, phoneClosable, type TightenedLeadRow, type WizardQueueRow } from "./work-queue";
import { DEFAULT_POLICY } from "@/lib/wizard/policy";

/**
 * Lead L8 (17 Nov 2026): a lead who tightened their range and booked nothing
 * is a call for the estimator — Appendix A's line, due a day after the closer
 * range, phone-closable or not. It replaces that session's Follow up card.
 */
const since = "2026-11-17T01:00:00Z";
const now = new Date("2026-11-17T05:00:00Z");
const row = (over: Partial<TightenedLeadRow> = {}): TightenedLeadRow => ({
  draftId: "d1", estimateId: "e1", accountId: "a1", since, firstName: "Sarah", phone: "0412 345 678",
  address: "12 Elm Grove", loCents: 700_000, hiCents: 760_000, jobType: "interior", biggerJob: false, brand: "paintgroup", ...over,
});

describe("L8 tightened-call", () => {
  it("Appendix A's line, due a day after the closer range, on the estimate", () => {
    const [item] = buildTightenedCallItems([row()], [], DEFAULT_POLICY, now);
    expect(item).toMatchObject({
      kind: "lead_tightened_call",
      title: "Call Sarah (0412 345 678) — tightened 12 Elm Grove to $7,000–$7,600 inc. GST, no booking yet",
      detail: "Phone-closable: yes",
      dueAt: "2026-11-18T01:00:00.000Z",
      subjectRef: { type: "estimate", id: "e1" },
    });
  });
  it("a call logged after the closer range clears it; one before does not", () => {
    expect(buildTightenedCallItems([row()], [{ account_id: "a1", occurred_at: "2026-11-17T02:00:00Z" }], DEFAULT_POLICY, now)).toHaveLength(0);
    expect(buildTightenedCallItems([row()], [{ account_id: "a1", occurred_at: "2026-11-16T02:00:00Z" }], DEFAULT_POLICY, now)).toHaveLength(1);
  });
  it("phone-closable: interior under ⚑7's cap yes; exterior, over the cap or a bigger job no; Paint Home reads its own ceiling", () => {
    expect(phoneClosable(row(), DEFAULT_POLICY)).toBe(true);
    expect(phoneClosable(row({ jobType: "exterior" }), DEFAULT_POLICY)).toBe(false);
    expect(phoneClosable(row({ hiCents: DEFAULT_POLICY.remoteConfirmCapCents + 1 }), DEFAULT_POLICY)).toBe(false);
    expect(phoneClosable(row({ biggerJob: true }), DEFAULT_POLICY)).toBe(false);
    expect(phoneClosable(row({ brand: "painthome", jobType: "exterior", hiCents: 2_000_000 }), DEFAULT_POLICY)).toBe(true);
    expect(phoneClosable(row({ brand: "painthome", hiCents: DEFAULT_POLICY.paintHomeCapCents + 1 }), DEFAULT_POLICY)).toBe(false);
  });
  it("the tightened session's Follow up card is not raised as well", () => {
    const session: WizardQueueRow = {
      id: "d1", account_id: "a1", estimate_id: "e1", name: "Sarah Chen", email: null, phone: null, address: null, suburb: "Thornbury",
      job_type: "interior", bucket: "priced_no_request", outcome: "none", outcome_at: null, outcome_note: null, dropped_at: null,
      furthest_page: 5, pages_total: 8, active_seconds: 300, last_seen_at: since, est_value_cents: 730_000, entry_source: null,
    };
    expect(buildWizardItems([session], [], now).map((i) => i.kind)).toEqual(["wizard_priced"]);
    expect(buildWizardItems([session], [], now, new Map(), new Set(["d1"]))).toEqual([]);
  });
});

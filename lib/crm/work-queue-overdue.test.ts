import { describe, expect, it } from "vitest";
import { overdueAfterVisit, type AccountEstimateRow, type VisitDoneRow } from "./work-queue";
import { automationByKey } from "@/lib/automations/registry";
import { byHoursEvent } from "@/lib/staff/notifyEvents";

/**
 * E1 (17 Nov 2026): a visit done two days ago with no estimate sent since is
 * an alert — the Today card's rule, past its due time. E8: the chat alert is
 * routed by the office hours like L9.
 */
const visit = (over: Partial<VisitDoneRow> = {}): VisitDoneRow => ({
  id: "v1", account_id: "a1", estimate_id: "e1", starts_at: "2026-11-14T00:00:00Z", outcome_at: "2026-11-14T01:00:00Z",
  customer_name: "Sarah Chen", address: "12 Elm Grove, Thornbury VIC 3071", ...over,
});
const unsent: AccountEstimateRow = { id: "e1", account_id: "a1", sent_at: null, total_cents: 900_000 };

describe("E1 — estimate overdue after a visit", () => {
  it("due two days after the visit was marked done, with the days since the visit", () => {
    expect(overdueAfterVisit([visit()], [unsent], new Date("2026-11-16T00:59:00Z"))).toHaveLength(0);
    const [hit] = overdueAfterVisit([visit()], [unsent], new Date("2026-11-17T03:00:00Z"));
    expect(hit.visit.id).toBe("v1");
    expect(hit.days).toBe(3);
  });
  it("an estimate sent after the visit clears it", () => {
    expect(overdueAfterVisit([visit()], [{ ...unsent, sent_at: "2026-11-15T00:00:00Z" }], new Date("2026-11-17T03:00:00Z"))).toHaveLength(0);
  });
  it("ships off; E8's chat alert is now routed by the hours", () => {
    expect(automationByKey("office_estimate_overdue")).toMatchObject({ audience: "office", defaultOff: true });
    expect(byHoursEvent("office_estimate_chat")).toBe(true);
    expect(byHoursEvent("office_estimate_overdue")).toBe(false);
  });
});

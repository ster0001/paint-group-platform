import { describe, expect, it } from "vitest";
import { buildQaCheckItems, buildSiteVisitItems, homeOf, isCustomerVisible, type QaCheckQueueRow, type SiteVisitQueueRow } from "./work-queue";
import { melbourneInstant } from "@/lib/time/businessHours";

/**
 * Tom, 8 Oct 2026: quality checks and job check-ins appear in PC Command on
 * their day; a check whose final walkthrough was cancelled is flagged.
 * Derived from the check rows — recording the check is what clears it.
 */
const row = (over: Partial<QaCheckQueueRow> = {}): QaCheckQueueRow => ({
  id: "c1", workOrderId: "wo1", kind: "final", date: "2026-10-14", time: "09:00:00",
  stage: "in_progress", woRef: "WO-101", where: "12 Test St, Thornbury", painter: "Sam",
  finals: [{ status: "booked", date: "2026-10-15" }],
  ...over,
});

describe("quality checks on their day", () => {
  it("is not there the day before, appears that morning, due at its time, homed on PC Command", () => {
    expect(buildQaCheckItems([row()], melbourneInstant(2026, 10, 13, 9))).toEqual([]);
    const [item] = buildQaCheckItems([row()], melbourneInstant(2026, 10, 14, 7, 30));
    expect(item.kind).toBe("qa_check_due");
    expect(item.title).toBe("Quality check today at 09:00 — 12 Test St, Thornbury");
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 14, 9).toISOString());
    expect(item.action).toEqual({ label: "Record the check", href: "/pc/wo/wo1#qa" });
    expect(homeOf("qa_check_due")).toBe("pc");
    expect(isCustomerVisible("qa_check_due")).toBe(false);
  });

  it("a mid-job check has its own name; a missed one stays, overdue, until recorded", () => {
    const [item] = buildQaCheckItems([row({ kind: "mid", date: "2026-10-12", time: "13:30:00" })], melbourneInstant(2026, 10, 14, 9));
    expect(item.title).toBe("Mid-job check since 2026-10-12 at 13:30 — 12 Test St, Thornbury");
    expect(item.bucket).toBe("overdue");
  });

  it("leaves a job parked at Quality check to the console card, and a closed job alone", () => {
    expect(buildQaCheckItems([row({ stage: "qa" })], melbourneInstant(2026, 10, 14, 9))).toEqual([]);
    expect(buildQaCheckItems([row({ stage: "closed" })], melbourneInstant(2026, 10, 14, 9))).toEqual([]);
  });

  it("one card per check, keyed by the check", () => {
    const items = buildQaCheckItems([row(), row({ id: "c2", kind: "mid", time: "08:00:00" })], melbourneInstant(2026, 10, 14, 9));
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});

describe("a booked check whose final walkthrough was cancelled", () => {
  const cancelled = row({ finals: [{ status: "cancelled", date: "2026-10-15" }] });
  it("is flagged — before its day too — and the check is left where it was", () => {
    const [item] = buildQaCheckItems([cancelled], melbourneInstant(2026, 10, 9, 9));
    expect(item.kind).toBe("qa_check_final_cancelled");
    expect(item.title).toContain("final walkthrough was cancelled");
    expect(item.detail).toMatch(/Rebook the final/);
    expect(homeOf("qa_check_final_cancelled")).toBe("pc");
  });
  it("goes once the final is rebooked; a site check-in never raises it", () => {
    const rebooked = row({ finals: [{ status: "booked", date: "2026-10-20" }, { status: "cancelled", date: "2026-10-15" }] });
    expect(buildQaCheckItems([rebooked], melbourneInstant(2026, 10, 9, 9))).toEqual([]);
    expect(buildQaCheckItems([row({ kind: "mid", finals: cancelled.finals })], melbourneInstant(2026, 10, 9, 9))).toEqual([]);
    // A job that never had a final has nothing to flag.
    expect(buildQaCheckItems([row({ finals: [] })], melbourneInstant(2026, 10, 9, 9))).toEqual([]);
  });
});

/**
 * Tom, 9 Oct 2026: a site check-in is Felipe's own visit (wo_site_visits) —
 * its own card, cleared by Mark visited, never a check.
 */
describe("site check-ins on their day", () => {
  const visit = (over: Partial<SiteVisitQueueRow> = {}): SiteVisitQueueRow => ({
    id: "v1", workOrderId: "wo1", date: "2026-10-14", time: "13:30:00",
    stage: "in_progress", woRef: "WO-101", where: "12 Test St, Thornbury", painter: "Sam",
    ...over,
  });
  it("appears on its day, due at its time, opens the job's site check-ins, homed on PC Command, never the customer's", () => {
    expect(buildSiteVisitItems([visit()], melbourneInstant(2026, 10, 13, 9))).toEqual([]);
    const [item] = buildSiteVisitItems([visit()], melbourneInstant(2026, 10, 14, 8));
    expect(item.kind).toBe("site_visit_due");
    expect(item.title).toBe("Site check-in today at 13:30 — 12 Test St, Thornbury");
    expect(item.detail).toMatch(/no pass or fail/);
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 14, 13, 30).toISOString());
    expect(item.action).toEqual({ label: "Open the check-in", href: "/pc/wo/wo1#site-visits" });
    expect(homeOf("site_visit_due")).toBe("pc");
    expect(isCustomerVisible("site_visit_due")).toBe(false);
  });
  it("stays, overdue, until marked visited — even on a job parked at Quality check; a closed job drops it", () => {
    const [late] = buildSiteVisitItems([visit({ date: "2026-10-12", stage: "qa" })], melbourneInstant(2026, 10, 14, 9));
    expect(late.title).toBe("Site check-in since 2026-10-12 at 13:30 — 12 Test St, Thornbury");
    expect(late.bucket).toBe("overdue");
    expect(buildSiteVisitItems([visit({ stage: "closed" })], melbourneInstant(2026, 10, 14, 15))).toEqual([]);
  });
});

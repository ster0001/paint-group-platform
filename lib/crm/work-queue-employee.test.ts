import { describe, expect, it } from "vitest";
import {
  buildEmployeeReassignItems, GROUP_OF_KIND, KIND_WEIGHT, isCustomerVisible,
  type ActiveAssignmentRow, type CantMakeItEventRow, type DatesChangedEventRow,
} from "./work-queue";

/**
 * Employed painters S3 (ruling 11): "can't make it" raises the Reassign item
 * and changes nothing else. The item is DERIVED from wo_events + the live
 * assignment — never stored — and clears the moment the office moves the
 * painter's dates or takes them off.
 */
const now = new Date("2026-10-01T09:00:00+10:00");
const wo = { wo_ref: "WO-1042", wo_snapshot: { jobTitle: "12 Elm Grove" } };
const flag = (assignment_id: string, created_at: string, reason = "dentist"): CantMakeItEventRow => ({
  id: `f-${assignment_id}-${created_at}`, work_order_id: "wo-1", created_at,
  meta: { assignment_id, contractor_id: "c-1", reason }, work_orders: wo,
});
const active: ActiveAssignmentRow[] = [
  { id: "a-1", contractor_id: "c-1", start_date: "2026-10-05", end_date: "2026-10-07", status: "assigned" },
];
const names = new Map([["c-1", "Marco Rossi"]]);

describe("employee_reassign", () => {
  it("is registered as an internal follow-up that outranks every other internal kind", () => {
    expect(GROUP_OF_KIND.employee_reassign).toBe("followups");
    expect(isCustomerVisible("employee_reassign")).toBe(false);
    const internal = Object.entries(KIND_WEIGHT).filter(([k]) => !isCustomerVisible(k as never) && k !== "employee_reassign").map(([, w]) => w);
    expect(KIND_WEIGHT.employee_reassign).toBeGreaterThan(Math.max(...internal));
  });

  it("one flag → one item naming the painter, the job and the days, with Reassign as the action", () => {
    const items = buildEmployeeReassignItems([flag("a-1", "2026-09-30T08:00:00Z")], active, [], names, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Marco Rossi can't make 12 Elm Grove — 05/10–07/10");
    expect(items[0].detail).toContain("\"dentist\"");
    expect(items[0].action).toEqual({ label: "Reassign", href: "/pc/schedule?from=2026-10-05&days=14" });
    expect(items[0].subjectRef).toEqual({ type: "work_order", id: "wo-1" });
    expect(items[0].key).toContain("a-1");
  });

  it("a second flag on the same assignment does not make a second item, and keeps the same key", () => {
    const items = buildEmployeeReassignItems(
      [flag("a-1", "2026-09-29T08:00:00Z", "first"), flag("a-1", "2026-09-30T08:00:00Z", "second")], active, [], names, now);
    expect(items).toHaveLength(1);
    expect(items[0].detail).toContain("\"second\"");
  });

  it("clears once the office moves the dates after the flag, and stands if the flag came after the move", () => {
    const moves: DatesChangedEventRow[] = [{ created_at: "2026-09-30T10:00:00Z", meta: { assignment_id: "a-1" } }];
    expect(buildEmployeeReassignItems([flag("a-1", "2026-09-30T08:00:00Z")], active, moves, names, now)).toHaveLength(0);
    expect(buildEmployeeReassignItems([flag("a-1", "2026-09-30T12:00:00Z")], active, moves, names, now)).toHaveLength(1);
  });

  it("a released assignment raises nothing — taking them off answered it", () => {
    const released = [{ ...active[0], status: "released" }];
    expect(buildEmployeeReassignItems([flag("a-1", "2026-09-30T08:00:00Z")], released, [], names, now)).toHaveLength(0);
  });

  it("is due the day before their first day, so it lands in Overdue once that passes", () => {
    const item = buildEmployeeReassignItems([flag("a-1", "2026-09-30T08:00:00Z")], active, [], names, now)[0];
    expect(item.dueAt?.slice(0, 10)).toBe("2026-10-03");
    expect(item.bucket).toBe("waiting");
    const later = buildEmployeeReassignItems([flag("a-1", "2026-09-30T08:00:00Z")], active, [], names, new Date("2026-10-05T09:00:00+10:00"))[0];
    expect(later.bucket).toBe("overdue");
  });
});

// ---- Session 7 (brief §3.9): the three items that join Reassign ------------
import {
  buildEmployeeUnacceptedItems, buildLeaveRequestItems, buildTimesheetApprovalItems,
  type LeaveRequestRow, type TimesheetPendingRow,
} from "./work-queue";

describe("employee_unaccepted", () => {
  const withJob = (over: Partial<ActiveAssignmentRow>): ActiveAssignmentRow => ({
    id: "a-9", contractor_id: "c-1", start_date: "2026-10-02", end_date: "2026-10-03", status: "assigned",
    work_order_id: "wo-9", accepted_at: null, work_orders: { wo_ref: "WO-9", wo_snapshot: { jobTitle: "4 Oak St" } }, ...over,
  });
  it("is an internal follow-up below Reassign", () => {
    expect(GROUP_OF_KIND.employee_unaccepted).toBe("followups");
    expect(isCustomerVisible("employee_unaccepted")).toBe(false);
    expect(KIND_WEIGHT.employee_unaccepted).toBeLessThan(KIND_WEIGHT.employee_reassign);
  });
  it("raises when the first day starts within 24 hours and nobody has tapped Accept", () => {
    // now = 1 Oct 09:00 Melbourne; the job starts 2 Oct 00:00 Melbourne — 15 h away.
    const items = buildEmployeeUnacceptedItems([withJob({})], names, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Marco Rossi hasn't accepted 4 Oak St — 02/10–03/10");
    expect(items[0].action.label).toBe("Call painter");
    expect(items[0].dueAt).toBe("2026-10-01T14:00:00.000Z"); // 2 Oct 00:00 AEST (+10 — DST starts 4 Oct)
  });
  it("stays quiet for an accepted assignment, one starting later than a day out, or one already over", () => {
    expect(buildEmployeeUnacceptedItems([withJob({ accepted_at: "2026-09-30T00:00:00Z" })], names, now)).toHaveLength(0);
    expect(buildEmployeeUnacceptedItems([withJob({ start_date: "2026-10-04", end_date: "2026-10-05" })], names, now)).toHaveLength(0);
    expect(buildEmployeeUnacceptedItems([withJob({ start_date: "2026-09-28", end_date: "2026-09-29" })], names, now)).toHaveLength(0);
    expect(buildEmployeeUnacceptedItems([withJob({ status: "released" })], names, now)).toHaveLength(0);
  });
});

describe("leave_request", () => {
  const req: LeaveRequestRow = { id: "u-1", contractor_id: "c-1", kind: "rdo", start_date: "2026-10-09", end_date: "2026-10-09", reason: "long weekend", created_at: "2026-09-30T01:00:00Z" };
  it("is an approval, due the day before the leave starts, with Decide as the action", () => {
    expect(GROUP_OF_KIND.leave_request).toBe("approvals");
    const [item] = buildLeaveRequestItems([req], names, now);
    expect(item.title).toBe("Marco Rossi asked for an RDO — 09/10");
    expect(item.detail).toBe("\"long weekend\"");
    expect(item.dueAt).toBe("2026-10-07T13:00:00.000Z"); // 8 Oct 00:00 AEDT (+11)
    expect(item.action).toEqual({ label: "Decide", href: "/pc/timesheets#time-off" });
    expect(item.subjectRef).toEqual({ type: "event", id: "u-1" });
  });
});

describe("timesheet_approval", () => {
  const entry = (id: string, finished_at: string | null, contractor_id = "c-1"): TimesheetPendingRow =>
    ({ id, contractor_id, work_order_id: "wo-1", work_date: (finished_at ?? "2026-09-30").slice(0, 10), finished_at });
  it("counts a painter's days once they have waited a day, one item per painter", () => {
    const items = buildTimesheetApprovalItems([
      entry("t-1", "2026-09-29T06:00:00Z"), entry("t-2", "2026-09-28T06:00:00Z"),
      entry("t-3", "2026-09-30T22:30:00Z"), // 30 min ago — not yet
      entry("t-4", "2026-09-29T06:00:00Z", "c-2"),
    ], new Map([["c-1", "Marco Rossi"]]), now);
    expect(items).toHaveLength(2);
    const marco = items.find((i) => i.title.includes("Marco"))!;
    expect(marco.title).toBe("2 clocked days from Marco Rossi waiting on approval");
    expect(marco.detail).toContain("Oldest is 28/09");
    expect(marco.action).toEqual({ label: "Approve", href: "/pc/timesheets" });
    expect(GROUP_OF_KIND.timesheet_approval).toBe("approvals");
    expect(items.find((i) => i.title.includes("A painter"))!.title).toMatch(/^1 clocked day from/);
  });
  it("an open day (no finish) is not waiting on anyone", () => {
    expect(buildTimesheetApprovalItems([entry("t-1", null)], names, now)).toHaveLength(0);
  });
});

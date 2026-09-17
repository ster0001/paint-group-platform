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

import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import {
  buildMovementWorkItems, GROUP_OF_KIND, homeOf, isCustomerVisible, KIND_WEIGHT, pcItems, type MovementQueueRow, type StrandedItemRow,
} from "./work-queue";

/**
 * Movements brief §6: nine registry entries, derived from the movements and the register —
 * never stored. Each card has one action. Built on Tue 20 Oct 2026, 11:00 Melbourne.
 */
const now = melbourneInstant(2026, 10, 20, 11);
const settings = { planningHorizonDays: 7, deliveryConfirmBy: "10:00" };
const row = (over: Partial<MovementQueueRow> & { id: string }): MovementQueueRow => ({
  workOrderId: "wo1", woRef: "WO-101", jobRef: "PG-0101", where: "12 Test St, Thornbury", jobStage: "pre_start", jobStartDate: "2026-10-26",
  kind: "paint", sourceKey: "paint:Dulux", title: "Dulux · 3 lines · 5 cans", detail: null, status: "tray", assigneeKind: null, assigneeId: null, assigneeName: null,
  fromKind: "branch", toKind: "site", fromBranch: "Dulux Preston", dueDate: null, half: null, time: null, orderedAt: null, plannedForStart: null, sourceChangedAt: null,
  problemNote: "", updatedAt: "2026-10-19T22:00:00.000Z", ...over,
});
const build = (rows: MovementQueueRow[], stranded: StrandedItemRow[] = [], at = now) => buildMovementWorkItems(rows, stranded, settings, at);
const only = (rows: MovementQueueRow[], kind: string, stranded: StrandedItemRow[] = [], at = now) => build(rows, stranded, at).filter((i) => i.kind === kind);

describe("the nine kinds are PC-homed, internal, weighted and grouped", () => {
  const kinds = ["movements_unplanned", "order_unplaced", "delivery_unconfirmed", "movement_overdue", "movement_problem", "equipment_stranded", "hire_off_due", "job_moved", "materials_changed_after_order"] as const;
  it.each(kinds)("%s", (k) => {
    expect(homeOf(k)).toBe("pc");
    expect(isCustomerVisible(k)).toBe(false);
    expect(KIND_WEIGHT[k]).toBeGreaterThan(0);
    expect(GROUP_OF_KIND[k]).toBeTruthy();
  });
  it("stranded gear, a problem and an unconfirmed delivery top the internal band (under employee_reassign), above material_request 28", () => {
    expect(KIND_WEIGHT.equipment_stranded).toBe(31);
    expect(KIND_WEIGHT.movement_problem).toBe(31);
    expect(KIND_WEIGHT.delivery_unconfirmed).toBe(31);
    expect(KIND_WEIGHT.material_request).toBe(28);
    expect(KIND_WEIGHT.employee_reassign).toBeGreaterThan(KIND_WEIGHT.equipment_stranded);
  });
});

describe("movements_unplanned — a job starting within the horizon still has tray chips", () => {
  it("one card per job, due three days before the start, Plan it → the week board on that job", () => {
    const items = only([row({ id: "a" }), row({ id: "b", kind: "materials", sourceKey: "matline:1", title: "Caulk × 6" }), row({ id: "c", workOrderId: "wo2", jobStartDate: "2026-11-30" })], "movements_unplanned");
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("movements_unplanned:work_order:wo1:tray");
    expect(items[0].title).toBe("2 chips still in the tray — PG-0101, 12 Test St, Thornbury");
    expect(items[0].detail).toContain("Starts 2026-10-26. Dulux · 3 lines · 5 cans · Caulk × 6.");
    expect(items[0].dueAt).toBe(melbourneInstant(2026, 10, 23, 17).toISOString());
    expect(items[0].bucket).toBe("waiting");
    expect(items[0].action).toEqual({ label: "Plan it", href: "/pc/movements?view=week&job=wo1" });
    expect(pcItems(items)).toHaveLength(1);
  });
  it("a job with no start date, a closed job, or a warehouse chip raises nothing; a placed chip is not 'in the tray'", () => {
    expect(only([row({ id: "a", jobStartDate: null })], "movements_unplanned")).toEqual([]);
    expect(only([row({ id: "a", jobStage: "closed" })], "movements_unplanned")).toEqual([]);
    expect(only([row({ id: "a", workOrderId: null })], "movements_unplanned")).toEqual([]);
    expect(only([row({ id: "a", status: "planned", assigneeKind: "supplier", dueDate: "2026-10-25" })], "movements_unplanned")).toEqual([]);
  });
  it("a job already started with chips still in the tray is overdue, not hidden", () => {
    const [item] = only([row({ id: "a", jobStartDate: "2026-10-19" })], "movements_unplanned");
    expect(item.bucket).toBe("overdue");
  });
});

describe("order_unplaced — a needsOrder movement due within 2 days", () => {
  const planned = row({ id: "p", status: "planned", assigneeKind: "supplier", dueDate: "2026-10-22", half: "AM" });
  it("supplier lane, not ordered, due Thursday: due Wednesday 5 pm, Ordered ✓ inline on the chip", () => {
    const [item] = only([planned], "order_unplaced");
    expect(item.key).toBe("order_unplaced:work_order:wo1:p");
    expect(item.title).toBe("Order not placed — Paint delivery · Dulux · 3 lines · 5 cans");
    expect(item.detail).toBe("PG-0101 · 12 Test St, Thornbury · Dulux Preston · the supplier delivers 2026-10-22 AM. Place the order, then tick Ordered — that is what texts the painter.");
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 21, 17).toISOString());
    expect(item.action).toEqual({ label: "Ordered ✓", href: "/pc/movements?view=week&job=wo1&movement=p" });
  });
  it("a painter picking up from a branch owes an order too; a staff drop-off from the warehouse does not; ordered = gone; three days out = not yet", () => {
    expect(only([{ ...planned, assigneeKind: "person", assigneeId: "c1", assigneeName: "Josef Kovac", fromKind: "branch" }], "order_unplaced")[0].detail).toContain("Josef Kovac picks up");
    expect(only([{ ...planned, assigneeKind: "person", assigneeId: "s1", fromKind: "warehouse", status: "booked" }], "order_unplaced")).toEqual([]);
    expect(only([{ ...planned, status: "booked", orderedAt: "2026-10-20T00:00:00Z" }], "order_unplaced")).toEqual([]);
    expect(only([{ ...planned, dueDate: "2026-10-23" }], "order_unplaced")).toEqual([]);
    expect(only([{ ...planned, dueDate: "2026-10-19" }], "order_unplaced")).toHaveLength(1);  // overdue AND unordered — both cards
  });
});

describe("delivery_unconfirmed — a supplier delivery due today, still booked at deliveryConfirmBy", () => {
  const booked = row({ id: "d", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-20", half: "AM", orderedAt: "2026-10-18T00:00:00Z" });
  it("at 11:00 the 10:00 card is up: Ring the shop → that day", () => {
    const [item] = only([booked], "delivery_unconfirmed");
    expect(item.key).toBe("delivery_unconfirmed:work_order:wo1:d-2026-10-20");
    expect(item.title).toBe("Delivery today not confirmed — Paint delivery · Dulux · 3 lines · 5 cans");
    expect(item.dueAt).toBe(melbourneInstant(2026, 10, 20, 10).toISOString());
    expect(item.bucket).toBe("today");
    expect(item.action).toEqual({ label: "Ring the shop", href: "/pc/movements?view=day&day=2026-10-20&movement=d" });
  });
  it("before 10:00 nothing; a painter pickup never; done never; tomorrow's never", () => {
    expect(only([booked], "delivery_unconfirmed", [], melbourneInstant(2026, 10, 20, 9, 30))).toEqual([]);
    expect(only([{ ...booked, assigneeKind: "person", assigneeId: "c1" }], "delivery_unconfirmed")).toEqual([]);
    expect(only([{ ...booked, status: "done" }], "delivery_unconfirmed")).toEqual([]);
    expect(only([{ ...booked, dueDate: "2026-10-21" }], "delivery_unconfirmed")).toEqual([]);
  });
});

describe("movement_overdue, movement_problem, hire_off_due", () => {
  it("overdue: past its day, live, not a problem — Open on Day with the lane", () => {
    const [item] = only([row({ id: "o", status: "booked", assigneeKind: "person", assigneeId: "s1", assigneeName: "Felipe", dueDate: "2026-10-19", kind: "equipment_out", fromKind: "warehouse", title: "Gear · E-001 · Step ladder", orderedAt: null })], "movement_overdue");
    expect(item.title).toBe("Not done — Gear drop-off · Gear · E-001 · Step ladder was due 2026-10-19");
    expect(item.detail).toContain("Felipe");
    expect(item.bucket).toBe("overdue");
    expect(item.action).toEqual({ label: "Open on Day", href: "/pc/movements?view=day&day=2026-10-19&who=s1&movement=o" });
    expect(only([row({ id: "o", status: "done", dueDate: "2026-10-19" })], "movement_overdue")).toEqual([]);
    expect(only([row({ id: "o", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-20" })], "movement_overdue")).toEqual([]);
  });
  it("problem: the note on the card, no deadline, Open", () => {
    const [item] = only([row({ id: "x", status: "problem", assigneeKind: "supplier", dueDate: "2026-10-22", problemNote: "shop closed" })], "movement_problem");
    expect(item.title).toBe("Problem — Paint delivery · Dulux · 3 lines · 5 cans");
    expect(item.detail).toBe("PG-0101 · 12 Test St, Thornbury · the supplier · 2026-10-22. shop closed");
    expect(item.dueAt).toBeNull();
    expect(item.action).toEqual({ label: "Open", href: "/pc/movements?view=week&job=wo1&movement=x" });
    // A problem that is also past its day is one card, not two.
    expect(build([row({ id: "x", status: "problem", assigneeKind: "supplier", dueDate: "2026-10-19" })]).map((i) => i.kind)).toEqual(["movement_problem"]);
  });
  it("hire_off_due: today or tomorrow, not done", () => {
    const off = row({ id: "h", kind: "hire_off", sourceKey: "hire_off:1", title: "Off-hire Scissor lift", status: "booked", assigneeKind: "supplier", fromBranch: "Alya Access", dueDate: "2026-10-21", orderedAt: "x" });
    const [item] = only([off], "hire_off_due");
    expect(item.title).toBe("Off-hire tomorrow — Off-hire Scissor lift");
    expect(item.detail).toBe("PG-0101 · 12 Test St, Thornbury · back to Alya Access. Every extra day is billed.");
    expect(only([{ ...off, dueDate: "2026-10-20" }], "hire_off_due")[0].title).toMatch(/^Off-hire today/);
    expect(only([{ ...off, dueDate: "2026-10-22" }], "hire_off_due")).toEqual([]);
    expect(only([{ ...off, status: "done" }], "hire_off_due")).toEqual([]);
  });
});

describe("job_moved and materials_changed_after_order", () => {
  it("job_moved: planned_for_start ≠ the job's start, on a live chip — Re-date; keyed by the new start so a second move is a new card", () => {
    const moved = row({ id: "m", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-25", plannedForStart: "2026-10-26", jobStartDate: "2026-11-02" });
    const [item] = only([moved], "job_moved");
    expect(item.key).toBe("job_moved:work_order:wo1:m-2026-11-02");
    expect(item.title).toBe("Job moved — Paint delivery · Dulux · 3 lines · 5 cans is still on 2026-10-25");
    expect(item.detail).toBe("PG-0101 · 12 Test St, Thornbury now starts 2026-11-02 (was 2026-10-26). The movement did not move with it — re-date it or leave it.");
    expect(item.action).toEqual({ label: "Re-date", href: "/pc/movements?view=week&job=wo1&movement=m" });
    expect(only([{ ...moved, jobStartDate: "2026-10-26" }], "job_moved")).toEqual([]);
    expect(only([{ ...moved, status: "tray", assigneeKind: null, dueDate: null }], "job_moved")).toEqual([]);
  });
  it("materials_changed_after_order: source_changed_at on an ordered chip — Review the order", () => {
    const changed = row({ id: "c", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-25", orderedAt: "2026-10-19T03:00:00Z", sourceChangedAt: "2026-10-20T00:30:00Z" });
    const [item] = only([changed], "materials_changed_after_order");
    expect(item.key).toBe("materials_changed_after_order:work_order:wo1:c-20261020T003000Z");
    expect(item.detail).toBe("PG-0101 · 12 Test St, Thornbury · ordered 2026-10-19. The Materials rows changed since — check the order matches.");
    expect(item.action).toEqual({ label: "Review the order", href: "/pc/movements?view=week&job=wo1&movement=c" });
    expect(only([{ ...changed, kind: "materials" }], "materials_changed_after_order")[0].detail).toContain("The line changed");
    expect(only([{ ...changed, orderedAt: null }], "materials_changed_after_order")).toEqual([]);
  });
});

describe("equipment_stranded — an item's location is stranded", () => {
  it("one card per item, due the day the job closed, Find it in the tray → that closed job", () => {
    const s: StrandedItemRow = { itemId: "i1", tag: "E-004", name: "Platform ladder", workOrderId: "wo9", woRef: "WO-81", where: "19 Beach Rd, Hampton", closedOn: "2026-10-02", returnMovementId: "r1", returnStatus: "tray" };
    const [item] = only([], "equipment_stranded", [s]);
    expect(item.key).toBe("equipment_stranded:work_order:wo9:i1");
    expect(item.title).toBe("E-004 Platform ladder is still at a closed job — 19 Beach Rd, Hampton");
    expect(item.detail).toBe("WO-81 closed 2026-10-02. Its return chip is in the tray — drop it on whoever collects.");
    expect(item.bucket).toBe("overdue");
    expect(item.action).toEqual({ label: "Find it in the tray", href: "/pc/movements?view=week&job=wo9" });
    expect(only([], "equipment_stranded", [{ ...s, returnMovementId: null, returnStatus: null }])[0].detail).toContain("The sweep will make its return chip");
    expect(only([], "equipment_stranded", [{ ...s, returnStatus: "booked" }])[0].detail).toContain("Its return is booked.");
  });
});

describe("keys are dismissable (crm_dismiss_work_item's four-part shape)", () => {
  it("every card's key has exactly four colon-separated parts", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "p", status: "planned", assigneeKind: "supplier", dueDate: "2026-10-21" }),
      row({ id: "d", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-20", orderedAt: "x" }),
      row({ id: "o", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-19", orderedAt: "x" }),
      row({ id: "x", status: "problem", assigneeKind: "supplier", dueDate: "2026-10-22" }),
      row({ id: "h", kind: "hire_off", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-21", orderedAt: "x" }),
      row({ id: "m", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-25", plannedForStart: "2026-10-26", jobStartDate: "2026-11-02", orderedAt: "x" }),
      row({ id: "c", status: "booked", assigneeKind: "supplier", dueDate: "2026-10-25", orderedAt: "x", sourceChangedAt: "2026-10-20T00:30:00.000Z" }),
      row({ id: "w", workOrderId: null, status: "planned", assigneeKind: "supplier", dueDate: "2026-10-21" }),
    ];
    const items = build(rows, [{ itemId: "i1", tag: "E-1", name: "x", workOrderId: "wo9", woRef: "", where: "", closedOn: null, returnMovementId: null, returnStatus: null }]);
    expect(new Set(items.map((i) => i.kind)).size).toBe(9);
    for (const i of items) expect(i.key.split(":"), i.key).toHaveLength(4);
    expect(items.find((i) => i.key.includes("warehouse"))?.subjectRef).toEqual({ type: "event", id: "w" });
  });
});

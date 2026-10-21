import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/scheduling/board";
import {
  blockedReason, chipState, chipWindow, context, contextBlocks, counts, gates, hotCells, inWindow, itemLocation, jobMoved, jobNeeds, kindLabel,
  knownSuburbIn, laneColour, lanes, locations, mapPins, methodLabel, methodOf, nearby, needsOrder, onMap, orderedStops, pointKey, reorder, runPlan, suburbOf, whileYouAreThere,
  type Job, type World,
} from "./evaluate";
import { DEFAULT_MOVEMENTS_SETTINGS, type EquipmentItemRow, type MovementRow, type MovementsSettings } from "./types";

/**
 * Golden tests for the evaluator — the cases brief §3.3 lists, on the mockup's week:
 *   two identical ladders · out-back-out · a stranded item whose WO closed yesterday · a paint
 *   chip on a colours-TBC job · a chip dropped on a supplier lane whose branch doesn't deliver
 *   (refused — the RPC's rule, stated here as the reason) · a painter lane receiving a
 *   staff-style drop-off (allowed, ruling 8) · Nearby excluding undecided rubbish and
 *   out-of-window chips (a Saturday return never suggested for Monday) · a merged line
 *   producing one chip (sync.test.ts) · a moved job flagging but not shifting.
 * Week of Mon 19 Oct 2026. Points are the mockup's suburbs.
 */
const SUB: Record<string, { lat: number; lng: number }> = {
  "northcote": { lat: -37.77, lng: 145.0 }, "carnegie": { lat: -37.89, lng: 145.06 }, "fairfield": { lat: -37.78, lng: 145.02 },
  "preston": { lat: -37.74, lng: 145.0 }, "sandringham": { lat: -37.95, lng: 145.01 }, "oakleigh south": { lat: -37.92, lng: 145.1 },
  "thornbury": { lat: -37.76, lng: 145.0 }, "brighton": { lat: -37.91, lng: 144.99 }, "hampton": { lat: -37.94, lng: 145.0 },
  "caulfield north": { lat: -37.87, lng: 145.03 }, "dandenong": { lat: -37.99, lng: 145.21 },
};
const MON = "2026-10-19", TUE = "2026-10-20", WED = "2026-10-21", THU = "2026-10-22", FRI = "2026-10-23", SAT = "2026-10-24";
const FELIPE = "felipe-profile", TOM = "tom-profile", SAUL_P = "saul-profile", SAUL_C = "saul-contractor", JOSEF = "josef-contractor", MIRA = "mira-contractor";

const settings: MovementsSettings = {
  ...DEFAULT_MOVEMENTS_SETTINGS,
  warehouse: { label: "Warehouse", address: "25-27 Bunney Rd", suburb: "Oakleigh South", postcode: "3166", lat: -37.92, lng: 145.1 },
  boardPeople: [{ id: FELIPE, slots: "hour", colour: "#0E8C9C" }, { id: TOM, slots: "hour", colour: "#5B4FD6" }, { id: SAUL_P, slots: "half", colour: "#1F7A4A" }],
};

const job = (over: Partial<Job> & { id: string }): Job => ({
  woRef: `WO-${over.id}`, jobRef: `PG-${over.id}`, title: "Job", address: "1 Test St, Northcote VIC 3070", suburb: "Northcote", stage: "pre_start",
  startDate: WED, endDate: FRI, contractorId: JOSEF, coloursConfirmed: true, point: null, paidOn: null, ...over,
});
const JOBS: Job[] = [
  job({ id: "0092", address: "22 Clarke St, Northcote VIC 3070", stage: "in_progress", startDate: MON, endDate: FRI, contractorId: JOSEF }),
  job({ id: "0093", address: "7 Mimosa Rd, Carnegie VIC 3163", suburb: "Carnegie", startDate: TUE, endDate: THU, contractorId: MIRA }),
  job({ id: "0094", address: "Bay Rd, Sandringham VIC 3191", suburb: "Sandringham", startDate: WED, endDate: FRI, contractorId: SAUL_C, coloursConfirmed: false }),
  job({ id: "0081", address: "19 Beach Rd, Hampton VIC 3188", suburb: "Hampton", stage: "closed", startDate: "2026-09-24", endDate: "2026-10-02", contractorId: null }),
  job({ id: "0090", address: "88 Station St, Fairfield VIC 3078", suburb: "Fairfield", stage: "in_progress", startDate: MON, endDate: TUE, contractorId: SAUL_C }),
];
const block = (over: Partial<Block> & { id: string; contractorId: string; start: string; end: string }): Block => ({
  kind: "accepted", estimateId: null, title: "Job", woRef: "", workOrderId: null, offerId: null, paymentCents: null, finishCode: null, expiresAt: null, source: null, reason: "", ...over,
});
const BLOCKS: Block[] = [
  block({ id: "wo-0092", contractorId: JOSEF, start: MON, end: FRI, kind: "in_progress", workOrderId: "0092", title: "Clarke St", address: "22 Clarke St, Northcote VIC 3070" }),
  block({ id: "wo-0093", contractorId: MIRA, start: TUE, end: THU, workOrderId: "0093", title: "Mimosa Rd", address: "7 Mimosa Rd, Carnegie VIC 3163" }),
  block({ id: "asg-0090", contractorId: SAUL_C, start: MON, end: TUE, kind: "assigned", workOrderId: "0090", title: "Station St", address: "88 Station St, Fairfield VIC 3078" }),
  block({ id: "unav-1", contractorId: SAUL_C, start: WED, end: WED, kind: "unavailable", title: "Leave" }),
  block({ id: "hold-1", contractorId: MIRA, start: FRI, end: FRI, kind: "hold", title: "Hold" }),
];
const mv = (over: Partial<MovementRow> & { id: string; kind: MovementRow["kind"] }): MovementRow => ({
  work_order_id: null, source_key: null, title: over.id, detail: null, assignee_kind: null, assignee_table: null, assignee_id: null, due_date: null, half: null, time: null,
  sequence: null, from_kind: null, from_branch_id: null, from_text: "", to_kind: null, to_branch_id: null, to_text: "", status: "tray", ordered_at: null, method_pref: null,
  client_notice: false, order_ref: "", lines: null, planned_for_start: null, return_due: null, blocked_by_movement_id: null, expected_cost_cents: null,
  note: "", problem_note: "", painter_confirmed_at: null, source_changed_at: null, booked_at: null, done_at: null, created_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z", items: [], ...over,
});
const placed = (over: Partial<MovementRow> & { id: string; kind: MovementRow["kind"]; assignee_id: string | null; due_date: string }): MovementRow =>
  mv({ status: "booked", assignee_kind: over.assignee_id ? "person" : "supplier", assignee_table: over.assignee_id ? (over.assignee_id.endsWith("profile") ? "profiles" : "contractors") : null, ...over });

const ITEMS: EquipmentItemRow[] = [
  { id: "E-001", tag: "E-001", name: "Step ladder 1.8 m", category: "step_ladder", serial_or_model: "", status: "active" },
  { id: "E-002", tag: "E-002", name: "Extension ladder 7 m", category: "ext_ladder_7", serial_or_model: "", status: "active" },
  { id: "E-011", tag: "E-011", name: "Extension ladder 7 m", category: "ext_ladder_7", serial_or_model: "", status: "active" },
  { id: "E-004", tag: "E-004", name: "Platform ladder", category: "platform_ladder", serial_or_model: "", status: "active" },
  { id: "E-006", tag: "E-006", name: "Spray gun — Wagner", category: "spray_gun", serial_or_model: "", status: "active" },
];
const BRANCHES = [
  { id: "dlx-preston", brand: "Dulux", branch: "Preston", kind: "paint" as const, address: "1 High St", suburb: "Preston", phone: "", lat: -37.74, lng: 145.0, delivers_to_site: true, opens_weekday: "06:30", favourite: true, active: true },
  { id: "tb-counter", brand: "Taubmans", branch: "Oakleigh", kind: "paint" as const, address: "", suburb: "Oakleigh South", phone: "", lat: -37.92, lng: 145.1, delivers_to_site: false, opens_weekday: null, favourite: false, active: true },
];

function world(over: Partial<World> = {}): World {
  return {
    from: MON, to: SAT, settings, jobs: JOBS, blocks: BLOCKS, unscheduledCheckins: [],
    painters: [
      { contractorId: JOSEF, profileId: "josef-profile", name: "Josef Kovac", employmentType: "contractor" },
      { contractorId: MIRA, profileId: "mira-profile", name: "Mira Delaney", employmentType: "contractor" },
      { contractorId: SAUL_C, profileId: SAUL_P, name: "Saul", employmentType: "employee" },
      { contractorId: "idle-contractor", profileId: null, name: "Nobody This Week", employmentType: "contractor" },
    ],
    staff: [{ profileId: FELIPE, name: "Felipe" }, { profileId: TOM, name: "Tom Roman" }, { profileId: SAUL_P, name: "Saul" }],
    googleBusy: [
      { staffId: TOM, startsAt: "2026-10-20T03:30:00.000Z", endsAt: "2026-10-20T04:30:00.000Z", label: "Estimate visit · Thornbury", calendar: "info@", allDay: false }, // Tue 14:30 Melbourne
      { staffId: TOM, startsAt: "2026-10-21T13:00:00.000Z", endsAt: "2026-10-22T13:00:00.000Z", label: "Busy", calendar: "info@", allDay: true },               // all-day Thu
    ],
    googleReads: { [TOM]: "ok", [FELIPE]: "not_connected" },
    appointments: [
      { id: "qa1", kind: "qa", workOrderId: "0090", date: MON, time: "09:30" },
      { id: "ci1", kind: "checkin", workOrderId: "0093", date: WED, time: "13:30" },
      { id: "wt1", kind: "walkthrough", workOrderId: "0092", date: FRI, time: "15:30", sub: "final" },
    ],
    movements: [], items: ITEMS, branches: BRANCHES, decisions: [], suburbs: new Map(Object.entries(SUB)), ...over,
  };
}

describe("lanes(window)", () => {
  it("supplier first, painters with work in the window by first job start (contractors and employees alike), staff in Settings order; an idle painter has no lane", () => {
    const ls = lanes(world());
    expect(ls.map((l) => l.id)).toEqual(["supplier", JOSEF, SAUL_C, MIRA, FELIPE, TOM]);
    expect(ls.map((l) => l.kind)).toEqual(["supplier", "painter", "painter", "painter", "staff", "staff"]);
  });
  it("an employee in boardPeople is ONE lane — their painter lane with Settings' slots and colour (⚑5)", () => {
    const saul = lanes(world()).find((l) => l.id === SAUL_C)!;
    expect(saul.kind).toBe("painter");
    expect(saul.colour).toBe("#1F7A4A");
    expect(saul.employmentType).toBe("employee");
    expect(lanes(world()).some((l) => l.id === SAUL_P)).toBe(false);
  });
  it("a painter with no booking but a movement on their lane in the window gets a lane (ruling 8)", () => {
    const w = world({ movements: [placed({ id: "x", kind: "materials", assignee_id: "idle-contractor", due_date: THU })] });
    expect(lanes(w).map((l) => l.id)).toContain("idle-contractor");
  });
  it("hourly slots come from Settings; the Google read's kind is a line on the lane when it is not ok (⚑6)", () => {
    const ls = lanes(world());
    expect(ls.find((l) => l.id === FELIPE)).toMatchObject({ slots: "hour", calendarNote: "Calendar not connected", colour: "#0E8C9C" });
    expect(ls.find((l) => l.id === TOM)).toMatchObject({ slots: "hour", calendarNote: null });
  });
  it("laneColour: Settings for staff, a stable palette colour for painters, grey for the supplier", () => {
    expect(laneColour({ id: "supplier", kind: "supplier" }, settings)).toBe("#9AA3AB");
    expect(laneColour({ id: FELIPE, kind: "staff" }, settings)).toBe("#0E8C9C");
    const a = laneColour({ id: JOSEF, kind: "painter" }, settings);
    expect(a).toMatch(/^#[0-9A-F]{6}$/);
    expect(laneColour({ id: JOSEF, kind: "painter" }, settings)).toBe(a);
  });
});

describe("context(lane, day)", () => {
  const w = world();
  const blocks = contextBlocks(w);
  it("job blocks from the board: one per day, first day carries the street, last says finishes, every day carries the suburb point", () => {
    expect(context(w, JOSEF, MON, blocks).map((b) => [b.kind, b.label, b.suburb])).toEqual([["job", "On site · 22 Clarke St", "Northcote"]]);
    expect(context(w, JOSEF, FRI, blocks)[0].label).toBe("On site · finishes");
    expect(context(w, JOSEF, TUE, blocks)[0].point).toEqual(SUB.northcote);
  });
  it("leave is grey context with no point; a hold is not context", () => {
    expect(context(w, SAUL_C, WED, blocks).map((b) => b.kind)).toEqual(["leave"]);
    expect(context(w, MIRA, FRI, blocks)).toEqual([]);
  });
  it("Google busy on a staff lane: the title in Melbourne time, with a suburb when the title has one; an all-day event spans its days", () => {
    const tue = context(w, TOM, TUE, blocks);
    expect(tue.map((b) => [b.kind, b.label, b.time, b.half, b.suburb])).toEqual([["calendar", "Estimate visit · Thornbury", "14:30", "PM", "Thornbury"]]);
    expect(tue[0].kindLabel).toBe("Estimate visit");
    expect(context(w, TOM, THU, blocks).map((b) => [b.label, b.half])).toEqual([["Busy", "ALL"]]);
    expect(context(w, TOM, FRI, blocks).map((b) => b.kind)).toEqual(["walkthrough"]);   // no calendar entry Friday; the walkthrough is a check-lane block
  });
  it("checks and check-ins land on the hourly staff lanes (none is flagged with checks); the walkthrough on the painter's lane too", () => {
    expect(context(w, FELIPE, MON, blocks).map((b) => [b.kindLabel, b.label, b.time])).toEqual([["Quality check", "Quality check · 88 Station St, Fairfield", "09:30"]]);
    expect(context(w, TOM, MON, blocks)[0].kind).toBe("qa");
    expect(context(w, FELIPE, WED, blocks)[0].kindLabel).toBe("Job check-in");
    expect(context(w, JOSEF, FRI, blocks).map((b) => b.kind)).toEqual(["job", "walkthrough"]);
    expect(context(w, SAUL_C, MON, blocks).map((b) => b.kind)).toEqual(["job"]);
  });
  it("boardPeople[].checks picks the lanes that carry checks", () => {
    const w2 = world({ settings: { ...settings, boardPeople: [{ id: FELIPE, slots: "hour", checks: true }, { id: TOM, slots: "hour" }] } });
    expect(context(w2, TOM, MON).map((b) => b.kind)).toEqual([]);
    expect(context(w2, FELIPE, MON).map((b) => b.kind)).toEqual(["qa"]);
  });
  it("suburbOf reads the suburb out of an address; knownSuburbIn finds one in a calendar title by lookup", () => {
    expect(suburbOf("22 Clarke St, Northcote VIC 3070")).toBe("Northcote");
    expect(suburbOf("")).toBe("");
    const subs = w.suburbs;
    expect(knownSuburbIn("Estimate visit · Thornbury", subs)).toBe("Thornbury");
    expect(knownSuburbIn("Dentist, Preston VIC 3072", subs)).toBe("Preston");
    expect(knownSuburbIn("Office", subs)).toBe("");
  });
});

describe("labels, methods, needsOrder", () => {
  it("kindLabel per kind and lane", () => {
    expect(kindLabel(mv({ id: "a", kind: "paint", assignee_kind: "supplier" }))).toBe("Paint delivery");
    expect(kindLabel(mv({ id: "a", kind: "paint", assignee_kind: "person" }))).toBe("Paint pickup");
    expect(kindLabel(mv({ id: "a", kind: "materials", assignee_kind: null }))).toBe("Materials pickup");
    expect(kindLabel(mv({ id: "a", kind: "equipment_out" }))).toBe("Gear drop-off");
    expect(kindLabel(mv({ id: "a", kind: "equipment_return" }))).toBe("Gear collection");
    expect(kindLabel(mv({ id: "a", kind: "hire_on" }))).toBe("Hire delivery");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_in" }))).toBe("Skip in");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "hire_off:x" }))).toBe("Skip out");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "rubbish", detail: "undecided" }))).toBe("Rubbish — how?");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "rubbish", detail: "painter disposes of it", to_kind: "tip" }))).toBe("Rubbish disposed");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "rubbish", to_kind: "warehouse" }))).toBe("Rubbish to warehouse");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "rubbish", to_kind: "tip", assignee_kind: "person" }))).toBe("Rubbish to tip");
    expect(kindLabel(mv({ id: "a", kind: "rubbish_out", source_key: "rubbish", to_kind: "tip" }))).toBe("Rubbish collection");
  });
  it("methodOf: supplier delivers (hire delivers for hires and skips); a person picks up from a branch, collects a return, takes rubbish to the tip, else drops off", () => {
    expect(methodOf(mv({ id: "a", kind: "paint", assignee_kind: "supplier" }))).toBe("supplier_delivers");
    expect(methodOf(mv({ id: "a", kind: "hire_on", assignee_kind: "supplier" }))).toBe("hire_delivers");
    expect(methodOf(mv({ id: "a", kind: "rubbish_in", assignee_kind: "supplier" }))).toBe("hire_delivers");
    expect(methodOf(mv({ id: "a", kind: "paint", assignee_kind: "person", from_kind: "branch" }))).toBe("pickup");
    expect(methodOf(mv({ id: "a", kind: "equipment_out", assignee_kind: "person", from_kind: "warehouse" }))).toBe("drop_off");
    expect(methodOf(mv({ id: "a", kind: "equipment_return", assignee_kind: "person", from_kind: "site" }))).toBe("collect");
    expect(methodOf(mv({ id: "a", kind: "rubbish_out", assignee_kind: "person", to_kind: "tip" }))).toBe("takes_to_tip");
    expect(methodOf(mv({ id: "a", kind: "rubbish_out", assignee_kind: "person", detail: "painter disposes of it", to_kind: "tip" }))).toBe("painter_disposes");
    expect(methodOf(mv({ id: "a", kind: "paint" }))).toBe("unplaced");
    expect(methodLabel(mv({ id: "a", kind: "paint", assignee_kind: "person", from_kind: "branch" }), "Josef Kovac")).toBe("Josef picks up");
    expect(methodLabel(mv({ id: "a", kind: "equipment_out", assignee_kind: "person", from_kind: "warehouse" }), "Felipe")).toBe("Felipe drops off");
    expect(methodLabel(mv({ id: "a", kind: "equipment_return", assignee_kind: "person" }), "Saul")).toBe("Saul collects");
    expect(methodLabel(mv({ id: "a", kind: "paint", assignee_kind: "supplier" }), null)).toBe("delivered to site");
  });
  it("needsOrder: supplier lane or a pickup from a branch, not yet ordered, and live", () => {
    expect(needsOrder(placed({ id: "a", kind: "paint", assignee_id: null, due_date: MON, status: "planned" }))).toBe(true);
    expect(needsOrder(placed({ id: "a", kind: "paint", assignee_id: JOSEF, due_date: MON, status: "planned", from_kind: "branch" }))).toBe(true);
    expect(needsOrder(placed({ id: "a", kind: "paint", assignee_id: JOSEF, due_date: MON, from_kind: "branch", ordered_at: "2026-10-18T00:00:00Z" }))).toBe(false);
    expect(needsOrder(placed({ id: "a", kind: "equipment_out", assignee_id: FELIPE, due_date: MON, from_kind: "warehouse" }))).toBe(false);
    expect(needsOrder(placed({ id: "a", kind: "paint", assignee_id: null, due_date: MON, status: "done" }))).toBe(false);
    expect(chipState(placed({ id: "a", kind: "paint", assignee_id: null, due_date: MON, status: "planned" }))).toBe("needs-order");
    expect(chipState(mv({ id: "a", kind: "paint" }))).toBe("tray");
  });
});

describe("the brief's golden cases", () => {
  it("two identical ladders are two rows with two locations — one on site, one at the warehouse", () => {
    const out = placed({ id: "out", kind: "equipment_out", work_order_id: "0090", assignee_id: FELIPE, due_date: MON, status: "done", done_at: "2026-10-19T00:00:00Z", to_kind: "site", items: [{ movement_id: "out", equipment_item_id: "E-011", label: "E-011 · Extension ladder 7 m" }] });
    const w = world({ movements: [out] });
    const locs = locations(w);
    expect(locs.find((l) => l.item.id === "E-011")).toMatchObject({ state: "site", detail: "On site · 88 Station St, Fairfield VIC 3078" });
    expect(locs.find((l) => l.item.id === "E-002")).toMatchObject({ state: "warehouse", detail: "Warehouse", movement: null });
  });
  it("out-back-out: the latest DONE movement decides; a planned return is 'next', not a location", () => {
    const out1 = placed({ id: "o1", kind: "equipment_out", work_order_id: "0092", assignee_id: FELIPE, due_date: "2026-10-05", status: "done", done_at: "2026-10-05T00:00:00Z", to_kind: "site", items: [{ movement_id: "o1", equipment_item_id: "E-001", label: "E-001 · Step ladder" }] });
    const back = placed({ id: "r1", kind: "equipment_return", work_order_id: "0092", assignee_id: FELIPE, due_date: "2026-10-09", status: "done", done_at: "2026-10-09T00:00:00Z", to_kind: "warehouse", items: [{ movement_id: "r1", equipment_item_id: "E-001", label: "E-001 · Step ladder" }] });
    const out2 = placed({ id: "o2", kind: "equipment_out", work_order_id: "0093", assignee_id: FELIPE, due_date: WED, status: "booked", to_kind: "site", items: [{ movement_id: "o2", equipment_item_id: "E-001", label: "E-001 · Step ladder" }] });
    const w = world({ movements: [out1, back, out2] });
    const loc = locations(w).find((l) => l.item.id === "E-001")!;
    expect(loc.state).toBe("warehouse");
    expect(loc.movement?.id).toBe("r1");
    expect(loc.next?.id).toBe("o2");
    expect(loc.detail).toBe(`Warehouse · out ${WED}`);
    // After the second out is ticked, it is on site at Mimosa Rd.
    const done2 = { ...out2, status: "done" as const, done_at: "2026-10-21T00:00:00Z" };
    expect(itemLocation("E-001", { movements: [out1, back, done2], jobs: JOBS })).toMatchObject({ state: "site", movement: done2 });
  });
  it("a stranded item whose WO closed yesterday: location stranded, its out chip blocked with the reason, counted as blocked", () => {
    const out = placed({ id: "o81", kind: "equipment_out", work_order_id: "0081", assignee_id: FELIPE, due_date: "2026-09-24", status: "done", done_at: "2026-09-24T00:00:00Z", to_kind: "site", title: "Gear · E-004 · Platform ladder", items: [{ movement_id: "o81", equipment_item_id: "E-004", label: "E-004 · Platform ladder" }] });
    const ret = mv({ id: "ret81", kind: "equipment_return", work_order_id: "0081", source_key: "return:o81", title: "Collect Gear · E-004 · Platform ladder", due_date: "2026-10-02", items: out.items });
    const next = mv({ id: "n93", kind: "equipment_out", work_order_id: "0093", blocked_by_movement_id: "ret81", items: [{ movement_id: "n93", equipment_item_id: "E-004", label: "E-004 · Platform ladder" }] });
    const w = world({ movements: [out, ret, next] });
    const loc = locations(w).find((l) => l.item.id === "E-004")!;
    expect(loc.state).toBe("stranded");
    expect(loc.detail).toBe("On site · job closed · 19 Beach Rd, Hampton VIC 3188 · return in the tray");
    expect(blockedReason(next, w)).toBe('E-004 is still at 19 Beach Rd, Hampton VIC 3188 — job closed. Drop "Collect Gear · E-004 · Platform ladder" on someone first.');
    expect(counts(w).blocked).toBe(1);
    // The closed-job return may land any day; booked, the out reads "available after".
    expect(chipWindow(ret, JOBS[3])).toEqual({ from: null, to: null });
    const booked = { ...ret, status: "booked" as const, assignee_kind: "person" as const, assignee_id: FELIPE, due_date: TUE };
    expect(blockedReason(next, world({ movements: [out, booked, next] }))).toBe(`return booked ${TUE} · available after`);
    expect(blockedReason(next, world({ movements: [out, { ...booked, status: "done" }, next] }))).toBeNull();
  });
  it("a paint chip on a colours-TBC job: counts as needing an order, the job says so, and the gate is shut", () => {
    const paint = placed({ id: "p94", kind: "paint", work_order_id: "0094", source_key: "paint:Dulux", assignee_id: null, due_date: WED, status: "planned" });
    const w = world({ movements: [paint] });
    expect(JOBS[2].coloursConfirmed).toBe(false);
    expect(needsOrder(paint)).toBe(true);
    expect(jobNeeds(w, "0094").map((m) => m.id)).toEqual(["p94"]);
    expect(gates(w, "0094")).toMatchObject({ paint: false, paintOrdered: 0, paintTotal: 1, paintBlocker: paint, gear: true, gearTotal: 0 });
    expect(counts(w).ordersToPlace).toBe(1);
  });
  it("a supplier lane whose branch does not deliver: the drop is the RPC's refusal; the evaluator says why the branch is wrong for that lane", () => {
    const paint = mv({ id: "p", kind: "paint", work_order_id: "0092", from_kind: "branch", from_branch_id: "tb-counter" });
    const branch = BRANCHES.find((b) => b.id === paint.from_branch_id)!;
    expect(branch.delivers_to_site).toBe(false);
    // The engine's drop check (Session 4) asks these two facts; the RPC answers error:branch_does_not_deliver.
    expect(methodOf({ ...paint, assignee_kind: "supplier" })).toBe("supplier_delivers");
  });
  it("a painter lane receiving a staff-style drop-off is allowed (ruling 8): booked on placing, no order step, a lane appears", () => {
    const drop = placed({ id: "d", kind: "equipment_out", work_order_id: "0094", assignee_id: JOSEF, due_date: TUE, from_kind: "warehouse", to_kind: "site" });
    const w = world({ movements: [drop] });
    expect(needsOrder(drop)).toBe(false);
    expect(methodLabel(drop, "Josef Kovac")).toBe("Josef drops off");
    expect(orderedStops(w, JOSEF, TUE).filter((s) => !s.fixed).map((s) => (s as { movement: MovementRow }).movement.id)).toEqual(["d"]);
  });
  it("Nearby excludes undecided rubbish, blocked chips and out-of-window chips — a Saturday return is never suggested for Monday", () => {
    const paintNorthcote = mv({ id: "near", kind: "paint", work_order_id: "0092", source_key: "paint:Dulux" });                       // Northcote, job starts MON → window to MON
    const rubbish = mv({ id: "rub", kind: "rubbish_out", work_order_id: "0090", source_key: "rubbish", detail: "undecided" });        // Fairfield, undecided
    const ret = mv({ id: "ret", kind: "equipment_return", work_order_id: "0092", source_key: "return:x", due_date: FRI });            // back not before Fri
    const blocked = mv({ id: "blk", kind: "equipment_out", work_order_id: "0090", blocked_by_movement_id: "missing" });
    const far = mv({ id: "far", kind: "materials", work_order_id: "0094" });                                                           // Sandringham, 18 km away
    const materialsFairfield = mv({ id: "mat", kind: "materials", work_order_id: "0090", source_key: "matline:1" });                  // Fairfield, job starts MON → window to MON
    const w = world({ movements: [paintNorthcote, rubbish, ret, blocked, far, materialsFairfield] });
    const mon = nearby(w, FELIPE, MON);          // Felipe is at the Fairfield QA check Monday 09:30
    // The Fairfield materials chip (0 km) and the Northcote paint chip (2 km, job started Monday: still in window) — nearest first.
    expect(mon.map((n) => n.chip.id)).toEqual(["mat", "near"]);
    expect(mon[0].from.kindLabel).toBe("Quality check");
    expect(mon[0].km).toBe(0);
    expect(mon[1].km).toBeCloseTo(2, 0);
    // Friday: the return is in its window now; the Fairfield materials chip is past its job's start.
    const fri = nearby(world({ ...w, googleBusy: [{ staffId: FELIPE, startsAt: "2026-10-22T23:00:00.000Z", endsAt: "2026-10-23T00:00:00.000Z", label: "Office · Northcote", calendar: "x", allDay: false }] }), FELIPE, FRI);
    expect(fri.map((n) => n.chip.id)).toEqual(["ret"]);
    // Painter lanes never get Nearby; the supplier neither.
    expect(nearby(w, JOSEF, MON)).toEqual([]);
    expect(nearby(w, "supplier", MON)).toEqual([]);
  });
  it("hotCells lights every non-supplier lane-day with context within nearKm, inside the chip's window", () => {
    const ret = mv({ id: "ret", kind: "equipment_return", work_order_id: "0092", source_key: "return:x" });  // Northcote; job ends FRI
    const cells = hotCells(world(), ret);
    // Josef on site Friday, and the Friday walkthrough at Clarke St puts Felipe and Tom there too; Felipe's Monday check is before the window.
    expect(cells).toEqual([{ laneId: JOSEF, day: FRI }, { laneId: FELIPE, day: FRI }, { laneId: TOM, day: FRI }]);
    const mat = mv({ id: "mat", kind: "materials", work_order_id: "0090" });                                  // Fairfield; job starts MON → only Monday
    // Monday only: Saul on site there, Josef 2 km away at Clarke St, Felipe and Tom at the check.
    expect(hotCells(world(), mat)).toEqual([{ laneId: JOSEF, day: MON }, { laneId: SAUL_C, day: MON }, { laneId: FELIPE, day: MON }, { laneId: TOM, day: MON }]);
  });
  it("whileYouAreThere: one ghost per calendar / check block, the nearest tray chip, never a job block", () => {
    const w = world({ movements: [mv({ id: "mat", kind: "materials", work_order_id: "0090" }), mv({ id: "p93", kind: "materials", work_order_id: "0093" })] });
    const blocks = contextBlocks(w);
    const qa = context(w, FELIPE, MON, blocks)[0];
    expect(whileYouAreThere(w, qa)?.chip.id).toBe("mat");
    const onSite = context(w, JOSEF, MON, blocks)[0];
    expect(whileYouAreThere(w, onSite)).toBeNull();
    const checkin = context(w, FELIPE, WED, blocks)[0];   // Carnegie Wed: the 0093 chip (window to TUE) is out, 0090 is out → nothing
    expect(whileYouAreThere(w, checkin)).toBeNull();
  });
  it("a moved job flags but never shifts: planned_for_start ≠ start_date", () => {
    const m = placed({ id: "m", kind: "paint", work_order_id: "0093", assignee_id: null, due_date: MON, planned_for_start: TUE });
    expect(jobMoved(m, JOBS[1])).toBe(false);
    expect(jobMoved(m, { startDate: WED })).toBe(true);
    expect(jobMoved({ ...m, status: "done" }, { startDate: WED })).toBe(false);
    expect(jobMoved({ ...m, planned_for_start: null }, { startDate: WED })).toBe(false);
    expect(m.due_date).toBe(MON);
  });
});

describe("chipWindow", () => {
  it("a delivery not after the start; a return not before the end; closed job or no job: any day", () => {
    expect(chipWindow(mv({ id: "a", kind: "paint" }), JOBS[1])).toEqual({ from: null, to: TUE });
    expect(chipWindow(mv({ id: "a", kind: "equipment_return" }), JOBS[1])).toEqual({ from: THU, to: null });
    expect(chipWindow(mv({ id: "a", kind: "equipment_return" }), JOBS[3])).toEqual({ from: null, to: null });
    expect(chipWindow(mv({ id: "a", kind: "restock" }), null)).toEqual({ from: null, to: null });
    expect(inWindow({ from: THU, to: null }, WED)).toBe(false);
    expect(inWindow({ from: THU, to: null }, SAT)).toBe(true);
  });
});

describe("the run plan (ruling 22)", () => {
  const stops = () => [
    placed({ id: "a", kind: "equipment_out", work_order_id: "0092", assignee_id: FELIPE, due_date: MON, time: "08:30", sequence: 1, from_kind: "warehouse", to_kind: "site" }),
    placed({ id: "b", kind: "materials", work_order_id: "0093", assignee_id: FELIPE, due_date: MON, half: "PM", sequence: 2, from_kind: "branch", from_branch_id: "dlx-preston", ordered_at: "x" }),
    placed({ id: "c", kind: "restock", work_order_id: null, assignee_id: FELIPE, due_date: MON, time: "07:30", sequence: 3, from_kind: "branch", from_branch_id: "dlx-preston", to_kind: "warehouse", ordered_at: "x" }),
  ];
  it("orderedStops: movements by sequence then time, fixed context at its time, merged by time", () => {
    const w = world({ movements: stops() });
    const ids = orderedStops(w, FELIPE, MON).map((s) => (s.fixed ? `ctx:${s.block.kindLabel}` : s.movement.id));
    // 07:30 restock (seq 3 but earliest time) … the sort is by time first: fixed at 09:30 between.
    expect(ids).toEqual(["c", "a", "ctx:Quality check", "b"]);
  });
  it("runPlan: km from the warehouse out and back, movements numbered, context unnumbered", () => {
    const plan = runPlan(world({ movements: stops() }), FELIPE, MON);
    expect(plan.stopCount).toBe(3);
    expect(plan.stops.map((s) => s.n)).toEqual([1, 2, null, 3]);
    expect(plan.stops[0].kmFromPrevious).toBeCloseTo(22, 0);        // warehouse → Preston
    expect(plan.stops[2].kmFromPrevious).toBeCloseTo(2, 0);         // Northcote → Fairfield
    expect(plan.totalKm).toBeGreaterThan(40);
    expect(runPlan(world(), TOM, SAT).stops).toEqual([]);
  });
  it("reorder hands the same set of times out in the new order; ids off that day are ignored, the rest keep their place after", () => {
    const w = world({ movements: stops() });
    expect(reorder(w, FELIPE, MON, ["b", "a", "c"])).toEqual([
      { id: "b", sequence: 1, time: "07:30", half: "AM" },
      { id: "a", sequence: 2, time: "08:30", half: "AM" },
      { id: "c", sequence: 3, time: "13:00", half: "PM" },
    ]);
    expect(reorder(w, FELIPE, MON, ["zzz", "c"]).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(reorder(w, FELIPE, TUE, ["a"])).toEqual([]);
  });
});

describe("gates and counts", () => {
  it("gates: every paint chip ordered or done, every gear chip booked or done; a decision opens a gate with no chips; vacuous = open", () => {
    const paint = placed({ id: "p", kind: "paint", work_order_id: "0092", assignee_id: null, due_date: MON, status: "planned" });
    const gear = mv({ id: "g", kind: "equipment_out", work_order_id: "0092" });
    const w = world({ movements: [paint, gear] });
    expect(gates(w, "0092")).toMatchObject({ paint: false, gear: false, paintBlocker: paint, gearBlocker: gear });
    const ordered = world({ movements: [{ ...paint, ordered_at: "x", status: "booked" }, { ...gear, status: "booked", assignee_kind: "person", assignee_id: FELIPE, due_date: TUE }] });
    expect(gates(ordered, "0092")).toMatchObject({ paint: true, gear: true, paintOrdered: 1, gearBooked: 1 });
    const decided = world({ movements: [paint], decisions: [{ work_order_id: "0092", line: "paint", decision: "painter_supplies" }] });
    expect(gates(decided, "0092")).toMatchObject({ paint: true, paintBlocker: null });
    expect(gates(world(), "0093")).toMatchObject({ paint: true, gear: true, paintTotal: 0 });
    expect(gates(world({ movements: [{ ...paint, status: "cancelled" }] }), "0092").paint).toBe(true);
  });
  it("counts: tray, placed in the window, orders to place", () => {
    const w = world({ movements: [
      mv({ id: "t1", kind: "paint", work_order_id: "0092" }),
      placed({ id: "o1", kind: "paint", work_order_id: "0093", assignee_id: null, due_date: TUE, status: "planned" }),
      placed({ id: "o2", kind: "paint", work_order_id: "0093", assignee_id: MIRA, due_date: TUE, from_kind: "branch", ordered_at: "x" }),
      placed({ id: "old", kind: "paint", work_order_id: "0093", assignee_id: null, due_date: "2026-10-01", status: "planned" }),
      placed({ id: "done", kind: "paint", work_order_id: "0093", assignee_id: null, due_date: TUE, status: "done" }),
    ] });
    expect(counts(w)).toEqual({ tray: 1, blocked: 0, placed: 2, ordersToPlace: 1 });
  });
  it("jobNeeds: tray chips and unordered placed chips, never a painter-disposed rubbish, a done or a cancelled chip", () => {
    const w = world({ movements: [
      mv({ id: "t", kind: "paint", work_order_id: "0092" }),
      placed({ id: "o", kind: "materials", work_order_id: "0092", assignee_id: null, due_date: MON, status: "planned" }),
      placed({ id: "r", kind: "rubbish_out", work_order_id: "0092", assignee_id: JOSEF, due_date: FRI, status: "done", detail: "painter disposes of it" }),
      mv({ id: "x", kind: "paint", work_order_id: "0092", status: "cancelled" }),
    ] });
    expect(jobNeeds(w, "0092").map((m) => m.id)).toEqual(["t", "o"]);
    expect(jobNeeds(w, "0093")).toEqual([]);
  });
});

describe("the map (rulings 21 and 22)", () => {
  // The fixture's booked jobs (pre_start) are off the map since 21 Oct; these cases are about the pins, so put them on site.
  const ON_SITE = JOBS.map((j) => (j.stage === "pre_start" ? { ...j, stage: "in_progress" } : j));
  const felipeMonday = () => [
    placed({ id: "a", kind: "equipment_out", work_order_id: "0092", assignee_id: FELIPE, due_date: MON, time: "08:30", sequence: 1, from_kind: "warehouse", to_kind: "site" }),
    placed({ id: "b", kind: "materials", work_order_id: "0093", assignee_id: FELIPE, due_date: MON, half: "PM", sequence: 2, from_kind: "branch", from_branch_id: "dlx-preston", ordered_at: "x" }),
  ];
  it("one icon per job: teal when nothing is outstanding, amber with the first need's kind, grey for a closed job", () => {
    const w = world({ jobs: ON_SITE, movements: [
      ...felipeMonday(),
      mv({ id: "t", kind: "paint", work_order_id: "0094" }),                                    // Sandringham: a paint chip in the tray
      mv({ id: "g", kind: "equipment_out", work_order_id: "0094" }),                            // and a gear chip after it
      mv({ id: "ret", kind: "equipment_return", work_order_id: "0081", status: "done", assignee_kind: "person", assignee_id: FELIPE, due_date: "2026-10-05" }), // Hampton: closed, nothing left
    ] });
    const pins = mapPins(w, null, MON);
    const by = Object.fromEntries(pins.jobs.map((p) => [p.job.id, p]));
    expect(by["0092"]).toMatchObject({ fill: "teal", need: null, line: "on track", label: "22 Clarke St" });
    expect(by["0094"]).toMatchObject({ fill: "amber", need: "paint", line: "paint to plan · gear to plan" });
    expect(by["0094"].needs.map((m) => m.id)).toEqual(["t", "g"]);
    expect(by["0081"]).toMatchObject({ fill: "grey", need: null, line: "closed · gear still here" });
    // 0093 has a placed, ordered materials chip: nothing outstanding.
    expect(by["0093"].fill).toBe("teal");
    // Nobody selected: no numbers, no route; every point is the job's own or its suburb's centroid.
    expect(pins.jobs.every((p) => p.badges.length === 0)).toBe(true);
    expect(pins.route).toEqual([]);
    expect(by["0092"].point).toEqual(SUB["northcote"]);
  });
  it("the selected person's order numbers sit on the icon of each stop; a fixed appointment is ◌; the route runs warehouse → stops → warehouse", () => {
    const w = world({ jobs: ON_SITE, movements: felipeMonday() });
    const pins = mapPins(w, FELIPE, MON);
    const by = Object.fromEntries(pins.jobs.map((p) => [p.job.id, p]));
    // Felipe's Monday: the QA check at Station St (Fairfield) at 09:30 is fixed; the gear drop at Clarke St (08:30) is 1; the Preston pickup (PM) is 2 — at the SHOP, not the job.
    expect(by["0090"].badges).toEqual([{ n: "◌", fixed: true, label: "Quality check" }]);
    expect(mapPins(world({ jobs: ON_SITE, movements: [placed({ id: "u", kind: "paint", work_order_id: "0093", assignee_id: null, due_date: MON, status: "planned" })] }), null, MON).jobs.find((p) => p.job.id === "0093")!.line).toBe("paint delivery · not ordered");
    expect(by["0092"].badges).toEqual([{ n: 1, fixed: false, label: "Gear drop-off" }]);
    expect(by["0093"].badges).toEqual([]);
    const preston = pins.shops.find((s) => s.branch.id === "dlx-preston")!;
    expect(preston.stopToday).toBe(true);
    expect(preston.badges).toEqual([{ n: 2, fixed: false, label: "Materials pickup" }]);
    expect(pins.shops.find((s) => s.branch.id === "tb-counter")!.stopToday).toBe(false);
    expect(pins.warehouse).toMatchObject({ label: "Warehouse", badges: [] });
    expect(pins.route[0]).toEqual(SUB["oakleigh south"]);
    expect(pins.route[pins.route.length - 1]).toEqual(SUB["oakleigh south"]);
    expect(pins.route.length).toBe(5);
    // Ruling 22: after a reorder the numbers follow — the same evaluator, the same stops.
    const patches = reorder(w, FELIPE, MON, ["b", "a"]);
    const after = world({ jobs: ON_SITE, movements: felipeMonday().map((m) => { const p = patches.find((x) => x.id === m.id)!; return { ...m, sequence: p.sequence, time: p.time, half: p.half }; }) });
    const again = mapPins(after, FELIPE, MON);
    expect(again.jobs.find((p) => p.job.id === "0092")!.badges[0].n).toBe(2);
    expect(again.shops.find((s) => s.branch.id === "dlx-preston")!.badges[0].n).toBe(1);
  });
  it("a shop on the same point as the warehouse stacks the numbers; a job with no point is left off the map", () => {
    const w = world({ movements: [placed({ id: "r", kind: "restock", assignee_id: FELIPE, due_date: MON, time: "07:30", from_kind: "branch", from_branch_id: "tb-counter", to_kind: "warehouse", ordered_at: "x" })],
      jobs: [...JOBS, job({ id: "nowhere", address: "Somewhere, Narnia", suburb: "Narnia" })] });
    const pins = mapPins(w, FELIPE, MON);
    expect(pins.jobs.some((p) => p.job.id === "nowhere")).toBe(false);
    expect(pins.shops.find((s) => s.branch.id === "tb-counter")!.badges.map((b) => b.n)).toEqual([1]);
    expect(pins.warehouse!.badges.map((b) => b.n)).toEqual([1]);
    expect(pointKey({ lat: -37.92, lng: 145.1 })).toBe("-37.92000,145.10000");
  });
});

describe("the map shows only the active jobs (Tom, 21 Oct 2026)", () => {
  const TODAY = "2026-10-21";
  it("onMap: on-site stages yes; an offer or a booking confirmed no; a closed job until a week after it was paid", () => {
    for (const stage of ["in_progress", "qa", "completion_prep", "walkthrough"]) expect(onMap({ stage, paidOn: null }, TODAY)).toBe(true);
    expect(onMap({ stage: "offered", paidOn: null }, TODAY)).toBe(false);
    expect(onMap({ stage: "pre_start", paidOn: null }, TODAY)).toBe(false);
    expect(onMap({ stage: "closed", paidOn: null }, TODAY)).toBe(true);           // closed, never paid: gear may still be there
    expect(onMap({ stage: "closed", paidOn: "2026-10-14" }, TODAY)).toBe(true);   // paid 7 days ago: last day on the map
    expect(onMap({ stage: "closed", paidOn: "2026-10-13" }, TODAY)).toBe(false);  // paid 8 days ago: gone
    expect(onMap({ stage: "closed", paidOn: "2025-01-01" }, TODAY)).toBe(false);
  });
  it("mapPins leaves the offers and bookings off and keeps a recently paid closed job", () => {
    const w = world({ jobs: [
      job({ id: "live", stage: "in_progress" }),
      job({ id: "booked", stage: "pre_start", suburb: "Carnegie", address: "7 Mimosa Rd, Carnegie VIC 3163" }),
      job({ id: "offer", stage: "offered", suburb: "Preston", address: "1 High St, Preston VIC 3072" }),
      job({ id: "paid-old", stage: "closed", paidOn: "2026-10-01", suburb: "Hampton", address: "19 Beach Rd, Hampton VIC 3188" }),
      job({ id: "paid-new", stage: "closed", paidOn: "2026-10-18", suburb: "Brighton", address: "2 Bay St, Brighton VIC 3186" }),
    ] });
    expect(mapPins(w, null, MON, [], TODAY).jobs.map((p) => p.job.id)).toEqual(["live", "paid-new"]);
    // No today given: the selected day stands in (the week board's day), so a reader of last week sees last week's map.
    expect(mapPins(w, null, "2026-10-26", []).jobs.map((p) => p.job.id)).toEqual(["live"]);
  });
});

import { describe, expect, it } from "vitest";
import type { WOMaterial } from "@/lib/workorder/snapshot";
import {
  autoReturnFor, brandIndex, cansOf, jobPoint, jobRef, km, linesEqual, nearestBranch, paintGroups, paintTitle, syncForWo, type SyncInput,
} from "./sync";
import type { BranchRow, MaterialLineRow, MovementRow } from "./types";

/**
 * The sync mirror, pinned to the RPC by a GOLDEN: every expected value below is one
 * `e2e/movements-rpc.spec.ts` asserted against `movements_sync_for_wo` on the C1 test
 * project (7/7, Session 1) — the titles, the branch picks, the counts, the flag. The same
 * fixture is run through the real RPC again by `e2e/movements-sync-mirror.spec.ts`, which
 * compares the two chip sets column for column. A change to the SQL that this file does
 * not know about shows up there; a change here that the SQL does not make shows up as a
 * failing golden.
 */
const WO = "11111111-1111-1111-1111-111111111111";
const CLOSED = "22222222-2222-2222-2222-222222222222";
const BRAND_A = "E2E Brand A", BRAND_B = "E2E Brand B", HARDWARE = "E2E Hardware";
const PRODUCT_A = "E2E Paint A", PRODUCT_B = "E2E Paint B";

const branch = (over: Partial<BranchRow> & { id: string; brand: string; branch: string }): BranchRow => ({
  kind: "paint", address: "", suburb: "", phone: "", lat: null, lng: null, delivers_to_site: false, opens_weekday: null, favourite: false, active: true, ...over,
});
const BRANCHES: BranchRow[] = [
  branch({ id: "b-deliver", brand: BRAND_A, branch: "Delivers", suburb: "Oakleigh South", lat: -37.92, lng: 145.1, delivers_to_site: true, opens_weekday: "06:30" }),
  branch({ id: "b-counter", brand: BRAND_A, branch: "Counter only", suburb: "Carnegie", lat: -37.89, lng: 145.06 }),
  branch({ id: "b-hardware", brand: HARDWARE, branch: "Store", kind: "hardware", suburb: "Moorabbin", lat: -37.94, lng: 145.05, delivers_to_site: true, favourite: true }),
];
const PRODUCTS = [
  { name: PRODUCT_A, brand: BRAND_A, effective_from: null },
  { name: PRODUCT_B, brand: BRAND_B, effective_from: null },
];
const material = (product: string, litres: number, colourName = ""): WOMaterial => ({
  product, colourKey: `${product}||${colourName}`, photoUrl: "", litres, coverageMissing: false, colourName, colourHex: colourName ? "#EEEEEE" : "", colourStatus: "tbc",
});
const MATERIALS = [material(PRODUCT_A, 13), material(PRODUCT_A, 4, "Mist"), material(PRODUCT_B, 20)];
const SUBURBS = new Map([["oakleigh south", { lat: -37.92, lng: 145.1 }]]);

const row = (over: Partial<MovementRow> & { id: string; kind: MovementRow["kind"] }): MovementRow => ({
  work_order_id: WO, source_key: null, title: "", detail: null, assignee_kind: null, assignee_table: null, assignee_id: null, due_date: null, half: null, time: null,
  sequence: null, from_kind: null, from_branch_id: null, from_text: "", to_kind: null, to_branch_id: null, to_text: "", status: "tray", ordered_at: null, method_pref: null, duration_min: 60,
  client_notice: false, order_ref: "PG-0001", lines: null, planned_for_start: null, return_due: null, blocked_by_movement_id: null, expected_cost_cents: null,
  note: "", problem_note: "", painter_confirmed_at: null, source_changed_at: null, booked_at: null, done_at: null, created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z", items: [], ...over,
});

function input(over: Partial<SyncInput> = {}): SyncInput {
  return {
    workOrder: { id: WO, stage: "pre_start", wo_snapshot: { materials: MATERIALS, jobAddress: "1 Test St, Oakleigh South VIC 3167" }, job_no: 1, wo_ref: "WO-1", end_date: "2026-10-29" },
    products: PRODUCTS, movements: [], materialLines: [], decisions: [], branches: BRANCHES,
    jobPoint: jobPoint("1 Test St, Oakleigh South VIC 3167", SUBURBS), itemLocations: new Map(), now: "2026-10-20T01:00:00Z", ...over,
  };
}
/** The chips a first sync creates, as rows a second sync would read back. */
function afterFirstSync(): MovementRow[] {
  return syncForWo(input()).create.map((c, i) => row({
    id: `m${i}`, kind: c.kind, source_key: c.source_key, title: c.title, detail: c.detail, from_kind: c.from_kind, from_branch_id: c.from_branch_id,
    from_text: c.from_text, to_kind: c.to_kind, to_text: c.to_text, order_ref: c.order_ref,
  }));
}
const byKey = (plan: ReturnType<typeof syncForWo>, key: string) => plan.create.find((c) => c.source_key === key);

describe("the SQL twins", () => {
  it("cansOf matches movements_cans: 13 L = 10 + 2 + 1, 20 L = 10 + 10, null = 0", () => {
    expect(cansOf(13)).toBe(3);
    expect(cansOf(20)).toBe(2);
    expect(cansOf(4)).toBe(1);
    expect(cansOf(null)).toBe(0);
    expect(cansOf(15.9)).toBe(1); // floor first, as the SQL does
  });
  it("jobRef is PG-#### when numbered, else the WO ref", () => {
    expect(jobRef({ job_no: 92, wo_ref: "WO-92" })).toBe("PG-0092");
    expect(jobRef({ job_no: null, wo_ref: "WO-92" })).toBe("WO-92");
  });
  it("jobPoint parses the address like movements_job_point: strips 'VIC 3167', first known suburb wins", () => {
    expect(jobPoint("1 Test St, Oakleigh South VIC 3167", SUBURBS)).toEqual({ lat: -37.92, lng: 145.1 });
    expect(jobPoint("1 Test St, Nowhere VIC 3000", SUBURBS)).toBeNull();
    expect(jobPoint("", SUBURBS)).toBeNull();
  });
  it("km is the great-circle distance", () => {
    expect(km({ lat: -37.92, lng: 145.1 }, { lat: -37.92, lng: 145.1 })).toBe(0);
    expect(km({ lat: -37.92, lng: 145.1 }, { lat: -37.89, lng: 145.06 })).toBeCloseTo(4.8, 0);
    expect(km(null, { lat: 0, lng: 0 })).toBeNull();
  });
  it("nearestBranch: favourites first, then km, then name; brand by prefix; delivering only when asked", () => {
    const at = { lat: -37.92, lng: 145.1 };
    expect(nearestBranch(BRANCHES, "paint", BRAND_A, at, true)?.id).toBe("b-deliver");
    expect(nearestBranch(BRANCHES, "paint", BRAND_A, at, false)?.id).toBe("b-deliver");       // nearer than the counter
    expect(nearestBranch(BRANCHES, "paint", BRAND_A, { lat: -37.89, lng: 145.06 }, false)?.id).toBe("b-counter");
    expect(nearestBranch(BRANCHES, "paint", BRAND_B, at, true)).toBeNull();
    expect(nearestBranch(BRANCHES, "hardware", null, null, false)?.id).toBe("b-hardware");
    expect(nearestBranch(BRANCHES, "paint", "e2e brand a", at, true)?.id).toBe("b-deliver");  // case-insensitive prefix
  });
  it("brandIndex takes the latest effective_from for a duplicated name and blanks a null brand", () => {
    const idx = brandIndex([
      { name: "Gloss", brand: "Old", effective_from: "2025-01-01" },
      { name: "gloss ", brand: "New", effective_from: "2026-01-01" },
      { name: "Nameless", brand: null, effective_from: null },
    ]);
    expect(idx.get("gloss")).toBe("New");
    expect(idx.get("nameless")).toBe("");
  });
});

describe("paint rows grouped by brand", () => {
  it("one group per brand, titled like the RPC: 'E2E Brand A · 2 lines · 4 cans', 'E2E Brand B · 1 line · 2 cans'", () => {
    const groups = paintGroups(MATERIALS, brandIndex(PRODUCTS));
    expect(groups.map((g) => [g.key, paintTitle(g)])).toEqual([
      [`paint:${BRAND_A}`, `${BRAND_A} · 2 lines · 4 cans`],
      [`paint:${BRAND_B}`, `${BRAND_B} · 1 line · 2 cans`],
    ]);
    expect(groups[0].rows.map((r) => r.rowKey)).toEqual([`${PRODUCT_A}||`, `${PRODUCT_A}||Mist`]);
    expect(groups[0].rows[1]).toEqual({ rowKey: `${PRODUCT_A}||Mist`, product: PRODUCT_A, colourName: "Mist", colourHex: "#EEEEEE", colourStatus: "tbc", litres: 4, cans: 1 });
  });
  it("a product with no brand groups under Paint (brand?) with key paint:brand? (Session 0 item 6)", () => {
    const groups = paintGroups([material("Mystery Gloss", 10)], brandIndex([{ name: "Mystery Gloss", brand: "", effective_from: null }]));
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("paint:brand?");
    expect(paintTitle(groups[0])).toBe("Paint (brand?) · 1 line · 1 can");
    expect(paintGroups([material("Unknown", 1)], new Map())[0].key).toBe("paint:brand?");
  });
  it("a row with no product is skipped", () => {
    expect(paintGroups([material("", 10)], new Map())).toEqual([]);
  });
});

describe("syncForWo — chips come from the jobs", () => {
  it("a job with no snapshot: ok:not_issued and nothing planned", () => {
    const plan = syncForWo(input({ workOrder: { id: WO, stage: "offered", wo_snapshot: null, job_no: 1, wo_ref: "WO-1", end_date: null } }));
    expect(plan.result).toBe("ok:not_issued");
    expect(plan.create).toEqual([]);
  });

  it("first sync: one paint chip per brand (nearest DELIVERING branch of the brand; no branch → no shop), one rubbish question; ok:3:0:0", () => {
    const plan = syncForWo(input());
    expect(plan.result).toBe("ok:3:0:0");
    const a = byKey(plan, `paint:${BRAND_A}`)!, b = byKey(plan, `paint:${BRAND_B}`)!, r = byKey(plan, "rubbish")!;
    expect(a).toMatchObject({
      kind: "paint", title: `${BRAND_A} · 2 lines · 4 cans`, detail: "from the Materials card", from_kind: "branch", from_branch_id: "b-deliver",
      from_text: `${BRAND_A} Delivers`, to_kind: "site", to_text: "1 Test St, Oakleigh South VIC 3167", status: "tray", order_ref: "PG-0001",
    });
    expect(b).toMatchObject({ title: `${BRAND_B} · 1 line · 2 cans`, from_branch_id: null, from_text: "" });
    expect(r).toMatchObject({ kind: "rubbish_out", title: "Rubbish — how?", detail: "undecided", from_kind: "site", from_text: "1 Test St, Oakleigh South VIC 3167", to_kind: null });
    expect(plan.after.size).toBe(3);
  });

  it("second sync converges: nothing created, the two paint tray chips counted as refreshed with no column changed (ok:0:2:0)", () => {
    const plan = syncForWo(input({ movements: afterFirstSync() }));
    expect(plan.result).toBe("ok:0:2:0");
    expect(plan.create).toEqual([]);
    expect(plan.refresh.every((p) => !p.changed)).toBe(true);
    expect(plan.remove).toEqual([]);
    expect(plan.flag).toEqual([]);
  });

  it("litres change on the Materials card → the tray chip is re-titled in place (20 L → 15 L = 1 can), same row", () => {
    const existing = afterFirstSync();
    const materials = MATERIALS.map((m) => (m.product === PRODUCT_B ? { ...m, litres: 15 } : m));
    const plan = syncForWo(input({ movements: existing, workOrder: { ...input().workOrder, wo_snapshot: { materials, jobAddress: "1 Test St, Oakleigh South VIC 3167" } } }));
    const b = existing.find((m) => m.source_key === `paint:${BRAND_B}`)!;
    const patch = plan.refresh.find((p) => p.id === b.id)!;
    expect(patch.title).toBe(`${BRAND_B} · 1 line · 1 can`);
    expect(patch.changed).toBe(true);
    expect(plan.create).toEqual([]);
  });

  it("a tray chip keeps the branch the office picked; one with no branch takes the nearest when one appears", () => {
    const existing = afterFirstSync().map((m) => (m.source_key === `paint:${BRAND_A}` ? { ...m, from_branch_id: "b-counter", from_text: `${BRAND_A} Counter only` } : m));
    const plan = syncForWo(input({ movements: existing, branches: [...BRANCHES, branch({ id: "b-new", brand: BRAND_B, branch: "Depot", delivers_to_site: true })] }));
    expect(plan.refresh.find((p) => p.id === existing[0].id)).toMatchObject({ from_branch_id: "b-counter", from_text: `${BRAND_A} Counter only`, changed: false });
    expect(plan.refresh.find((p) => p.id === existing[1].id)).toMatchObject({ from_branch_id: "b-new", from_text: `${BRAND_B} Depot`, changed: true });
  });

  it("a Materials change AFTER ordering flags the chip (source_changed_at) and never re-titles it", () => {
    const existing = afterFirstSync().map((m) => (m.source_key === `paint:${BRAND_A}`
      ? { ...m, status: "booked" as const, assignee_kind: "supplier" as const, due_date: "2026-10-25", ordered_at: "2026-10-20T00:00:00Z", lines: paintGroups(MATERIALS, brandIndex(PRODUCTS))[0].rows }
      : m));
    const same = syncForWo(input({ movements: existing }));
    expect(same.flag).toEqual([]);
    const materials = MATERIALS.map((m) => (m.product === PRODUCT_A && m.colourName === "Mist" ? { ...m, litres: 10 } : m));
    const plan = syncForWo(input({ movements: existing, workOrder: { ...input().workOrder, wo_snapshot: { materials, jobAddress: "1 Test St, Oakleigh South VIC 3167" } } }));
    expect(plan.flag).toEqual([existing[0].id]);
    expect(plan.refresh.find((p) => p.id === existing[0].id)).toBeUndefined();
    expect((plan.after.get(`paint:${BRAND_A}`) as MovementRow).source_changed_at).toBe("2026-10-20T01:00:00Z");
    expect((plan.after.get(`paint:${BRAND_A}`) as MovementRow).title).toBe(existing[0].title);
  });

  it("a planned chip that is NOT ordered yet is left alone — neither refreshed nor flagged", () => {
    const existing = afterFirstSync().map((m) => (m.source_key === `paint:${BRAND_B}` ? { ...m, status: "planned" as const, assignee_kind: "person" as const, due_date: "2026-10-25" } : m));
    const materials = MATERIALS.map((m) => (m.product === PRODUCT_B ? { ...m, litres: 1 } : m));
    const plan = syncForWo(input({ movements: existing, workOrder: { ...input().workOrder, wo_snapshot: { materials, jobAddress: "1 Test St, Oakleigh South VIC 3167" } } }));
    expect(plan.flag).toEqual([]);
    expect(plan.refresh.map((p) => p.id)).toEqual([existing[0].id]);
  });

  it("material lines: one chip per unmerged line with NO default shop (Tom, 21 Oct), detail by source; a merged line's chip is removed", () => {
    const lines: MaterialLineRow[] = [
      { id: "l1", work_order_id: WO, text: "Caulk × 6", source: "estimate", sort: 0, merged_into: null, created_at: "2026-10-19T00:00:01Z" },
      { id: "l2", work_order_id: WO, text: "Drop sheets", source: "pc", sort: 0, merged_into: null, created_at: "2026-10-19T00:00:02Z" },
      { id: "l3", work_order_id: WO, text: "Masking tape × 4 rolls", source: "painter_request", sort: 0, merged_into: null, created_at: "2026-10-19T00:00:03Z" },
    ];
    const plan = syncForWo(input({ materialLines: lines }));
    expect(plan.result).toBe("ok:6:0:0");
    expect(byKey(plan, "matline:l1")).toMatchObject({ kind: "materials", title: "Caulk × 6", detail: "from the estimate", from_kind: null, from_branch_id: null, from_text: "", to_text: "1 Test St, Oakleigh South VIC 3167" });
    expect(byKey(plan, "matline:l2")!.detail).toBe("from the job page");
    expect(byKey(plan, "matline:l3")!.detail).toBe("asked for by the painter");
    // Merge l2 into l1 → its tray chip goes.
    const existing = plan.create.map((c, i) => row({ id: `m${i}`, kind: c.kind, source_key: c.source_key, title: c.title, detail: c.detail, from_branch_id: c.from_branch_id, from_text: c.from_text, to_text: c.to_text, from_kind: c.from_kind, to_kind: c.to_kind }));
    const merged = lines.map((l) => (l.id === "l2" ? { ...l, merged_into: "l1" } : l));
    const again = syncForWo(input({ materialLines: merged, movements: existing }));
    expect(again.result).toBe("ok:0:4:1");
    expect(again.remove).toEqual([existing.find((m) => m.source_key === "matline:l2")!.id]);
    expect(again.after.has("matline:l2")).toBe(false);
  });

  it("an ordered materials chip whose line text changed is flagged; one whose line was removed is flagged too", () => {
    const l1: MaterialLineRow = { id: "l1", work_order_id: WO, text: "Caulk × 6", source: "estimate", sort: 0, merged_into: null, created_at: "2026-10-19T00:00:01Z" };
    const ordered = row({ id: "mc", kind: "materials", source_key: "matline:l1", title: "Caulk × 6", status: "booked", assignee_kind: "person", from_kind: "branch", due_date: "2026-10-25", ordered_at: "2026-10-20T00:00:00Z" });
    const retitled = syncForWo(input({ materialLines: [{ ...l1, text: "Caulk × 8" }], movements: [ordered] }));
    expect(retitled.flag).toEqual(["mc"]);
    const removedLine = syncForWo(input({ materialLines: [], movements: [ordered] }));
    expect(removedLine.flag).toEqual(["mc"]);
    expect(removedLine.remove).toEqual([]);
  });

  it("a decision on paint empties the paint tray chips and leaves a done chip untouched (the e2e's painter_supplies case)", () => {
    const existing = afterFirstSync().map((m) => (m.source_key === `paint:${BRAND_B}` ? { ...m, status: "done" as const, assignee_kind: "person" as const, due_date: "2026-10-25", ordered_at: "2026-10-20T00:00:00Z" } : m));
    const plan = syncForWo(input({ movements: existing, decisions: [{ work_order_id: WO, line: "paint", decision: "painter_supplies" }] }));
    expect(plan.remove).toEqual([existing[0].id]);                 // the tray chip
    expect(plan.flag).toEqual([]);                                 // done is never touched
    expect(plan.after.get(`paint:${BRAND_B}`)).toBe(existing[1]);
    expect(plan.result).toBe("ok:0:0:1");
    // Cleared → the chip is back.
    const back = syncForWo(input({ movements: existing.filter((m) => m.source_key !== `paint:${BRAND_A}`) }));
    expect(byKey(back, `paint:${BRAND_A}`)).toBeTruthy();
  });

  it("the rubbish question is made once and never re-made while the job holds one in any status; a rubbish decision stops it", () => {
    const existing = afterFirstSync().map((m) => (m.source_key === "rubbish" ? { ...m, status: "cancelled" as const } : m));
    expect(byKey(syncForWo(input({ movements: existing })), "rubbish")).toBeUndefined();
    const decided = syncForWo(input({ decisions: [{ work_order_id: WO, line: "rubbish", decision: "not_needed" }] }));
    expect(byKey(decided, "rubbish")).toBeUndefined();
    expect(decided.result).toBe("ok:2:0:0");
  });

  it("closed job: a done out whose gear is still on this site gets its return chip, once (ok:1:0:0 then ok:0:0:0)", () => {
    const out = row({
      id: "out1", work_order_id: CLOSED, kind: "equipment_out", title: "Gear · E-002 · Spray gun — Graco 395", status: "done", assignee_kind: "person",
      assignee_table: "profiles", assignee_id: "staff", due_date: "2026-10-10", done_at: "2026-10-10T05:00:00Z", order_ref: "PG-0002",
      items: [{ movement_id: "out1", equipment_item_id: "sprayer", label: "E-002 · Spray gun — Graco 395" }],
    });
    const wo = { id: CLOSED, stage: "closed", wo_snapshot: { materials: [], jobAddress: "9 Back St, Oakleigh South VIC 3167" }, job_no: 2, wo_ref: "WO-2", end_date: "2026-10-12" };
    const loc = new Map([["sprayer", { state: "stranded", movement_id: "out1", work_order_id: CLOSED }]]);
    const plan = syncForWo(input({ workOrder: wo, movements: [out], itemLocations: loc }));
    expect(plan.result).toBe("ok:1:0:0");
    expect(plan.create[0]).toMatchObject({
      work_order_id: CLOSED, kind: "equipment_return", source_key: "return:out1", title: "Collect Gear · E-002 · Spray gun — Graco 395",
      detail: "auto return for Gear · E-002 · Spray gun — Graco 395", from_kind: "site", from_text: "9 Back St, Oakleigh South VIC 3167",
      to_kind: "warehouse", to_text: "Warehouse", due_date: "2026-10-12", order_ref: "PG-0002", items: [{ equipment_item_id: "sprayer", label: "E-002 · Spray gun — Graco 395" }],
    });
    // The return exists → nothing more; the item back at the warehouse → nothing either.
    const ret = row({ id: "ret1", work_order_id: CLOSED, kind: "equipment_return", source_key: "return:out1" });
    expect(syncForWo(input({ workOrder: wo, movements: [out, ret], itemLocations: loc })).result).toBe("ok:0:0:0");
    expect(syncForWo(input({ workOrder: wo, movements: [out], itemLocations: new Map([["sprayer", { state: "warehouse", movement_id: null, work_order_id: null }]]) })).result).toBe("ok:0:0:0");
    // A closed job makes no paint or rubbish chips, whatever its snapshot says.
    expect(syncForWo(input({ workOrder: { ...wo, wo_snapshot: { materials: MATERIALS, jobAddress: "x" } }, movements: [] })).create).toEqual([]);
  });

  it("autoReturnFor mirrors movements_after_booked: return:<id> for an out, hire_off:<id> for a hire (to its branch) and a skip (as rubbish_out)", () => {
    const wo = { end_date: "2026-10-29", wo_snapshot: { jobAddress: "1 Test St, Oakleigh South VIC 3167" } };
    const out = row({ id: "o", kind: "equipment_out", title: "Gear · E-001 · Step ladder", status: "booked", items: [{ movement_id: "o", equipment_item_id: "i1", label: "E-001 · Step ladder" }] });
    expect(autoReturnFor(out, wo, [], BRANCHES)).toMatchObject({ source_key: "return:o", kind: "equipment_return", title: "Collect Gear · E-001 · Step ladder", due_date: "2026-10-29", to_text: "Warehouse", items: [{ equipment_item_id: "i1", label: "E-001 · Step ladder" }] });
    const hire = row({ id: "h", kind: "hire_on", title: "Scissor lift", from_kind: "branch", from_branch_id: "b-hardware", return_due: "2026-10-27" });
    expect(autoReturnFor(hire, wo, [], BRANCHES)).toMatchObject({ source_key: "hire_off:h", kind: "hire_off", title: "Off-hire Scissor lift", due_date: "2026-10-27", to_kind: "branch", to_branch_id: "b-hardware", to_text: `${HARDWARE} Store` });
    const skip = row({ id: "s", kind: "rubbish_in", title: "Skip in", from_kind: "branch", from_branch_id: "b-hardware", return_due: "2026-10-30" });
    expect(autoReturnFor(skip, wo, [], BRANCHES)).toMatchObject({ source_key: "hire_off:s", kind: "rubbish_out", title: "Skip out", due_date: "2026-10-30" });
    expect(autoReturnFor(row({ id: "p", kind: "paint" }), wo, [], BRANCHES)).toBeNull();
    expect(autoReturnFor(out, wo, [row({ id: "r", kind: "equipment_return", source_key: "return:o" })], BRANCHES)).toBeNull();
    // A warehouse chip (no job) returns from where it went.
    const restock = row({ id: "w", work_order_id: null, kind: "equipment_out", title: "Ladder to Tom", to_text: "Tom's ute", items: [] });
    expect(autoReturnFor(restock, null, [], BRANCHES)).toMatchObject({ work_order_id: null, from_text: "Tom's ute", due_date: null });
  });

  it("linesEqual compares rows field for field, regardless of order", () => {
    const a = paintGroups(MATERIALS, brandIndex(PRODUCTS))[0].rows;
    expect(linesEqual(a, [...a].reverse())).toBe(true);
    expect(linesEqual(a, a.map((r) => ({ ...r, litres: 1 })))).toBe(false);
    expect(linesEqual(null, null)).toBe(true);
    expect(linesEqual(null, a)).toBe(false);
  });
});

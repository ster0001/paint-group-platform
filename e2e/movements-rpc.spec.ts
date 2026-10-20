import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, test, userIdFor } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, customerIdForEmail, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Movements — Session 1 of the build plan: every transition and every refusal of the
 * RPCs in migration 20270279, asserted THROUGH EACH ROLE'S OWN SESSION. The service key
 * builds the fixtures (two jobs, two products, three branches, two register items) and
 * tears them down; it never reads back on behalf of a role.
 *
 *   staff      — sync, place, order, status, lines, decisions, register, suppliers
 *   contractor — reads only through movements_for_painter (never a cost, never an
 *                office note), ticks their own pickup, is refused every staff RPC
 *   customer   — reads movements and supplier_branches: [] with no error
 *
 * Refusals the brief names (§5, Session 1 prompt): colours_first on paint → ordered;
 * a stranded item blocking its out chip; the supplier lane refusing our own gear and a
 * branch that does not deliver; a painter calling a staff RPC → not_staff; a line on
 * someone's day refusing removal.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND_A = `E2E Brand A ${RUN}`;
const BRAND_B = `E2E Brand B ${RUN}`;
const HARDWARE = `E2E Hardware ${RUN}`;
const PRODUCT_A = `E2E Paint A ${RUN}`;
const PRODUCT_B = `E2E Paint B ${RUN}`;

type Row = Record<string, unknown>;

async function readAs(who: { email: string; password: string }, path: string): Promise<{ rows: Row[] | null; error: { code?: string; message?: string } | null }> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return Array.isArray(body) ? { rows: body as Row[], error: null } : { rows: null, error: body as { code?: string; message?: string } };
}

async function rpcRows(who: { email: string; password: string }, fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args),
  }).then((r) => r.json());
  if (!Array.isArray(body)) throw new Error(`${fn}: ${JSON.stringify(body)}`);
  return body as Row[];
}

const okId = (s: string) => { expect(s, s).toMatch(/^ok:/); return s.slice(3); };

async function chipsOf(workOrderId: string): Promise<Row[]> {
  const { rows, error } = await readAs(staff!, `movements?work_order_id=eq.${workOrderId}&select=id,kind,source_key,title,status,from_branch_id,ordered_at,lines,due_date,assignee_kind,assignee_id,sequence,run_plan_sent_at,blocked_by_movement_id,source_changed_at&order=created_at`);
  expect(error, "staff reading movements").toBeNull();
  return rows!;
}
const chip = (rows: Row[], key: string) => rows.find((r) => r.source_key === key);

let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;        // live, the contractor's
let closedJob: LoopFixture | null = null;  // closed, with a sprayer still on site
const productIds: string[] = [];
const branch = { delivering: "", noDelivery: "", hardware: "" };
const item = { ladder: "", sprayer: "" };
// Calendar days in Melbourne, never the UTC date (CLAUDE.md, Dates).
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return melbourne.format(d); };

test.describe.configure({ mode: "serial" });

test.describe("Movements RPCs through each role's own session", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId, "the E2E contractor and staff logins exist").toBeTruthy();
    const customerId = await customerIdForEmail(db!, customer!.email);

    for (const [name, brand] of [[PRODUCT_A, BRAND_A], [PRODUCT_B, BRAND_B]]) {
      const { data, error } = await db!.from("products").insert({ name, brand, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
      if (error) throw new Error(`product: ${error.message}`);
      productIds.push((data as { id: string }).id);
    }

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }], customerId);
    closedJob = await createLoopFixture(db!, contractorId, [{ heading: "Back", labels: ["Walls"] }]);
    const materials = [
      { product: PRODUCT_A, colourKey: `${PRODUCT_A}||`, photoUrl: "", litres: 13, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
      { product: PRODUCT_A, colourKey: `${PRODUCT_A}||Mist`, photoUrl: "", litres: 4, coverageMissing: false, colourName: "Mist", colourHex: "#EEEEEE", colourStatus: "tbc" },
      { product: PRODUCT_B, colourKey: `${PRODUCT_B}||`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
    ];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167" };
    // The Materials-card hook: this update is what fires movements_sync_for_wo.
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: day(7), end_date: day(9),
      colours: { [PRODUCT_A]: { status: "tbc", name: "" }, [PRODUCT_B]: { status: "tbc", name: "" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(`fixture update: ${uErr.message}`);
    const { error: cErr } = await db!.from("work_orders").update({ stage: "closed", start_date: day(-10), end_date: day(-8) }).eq("id", closedJob.workOrderId);
    if (cErr) throw new Error(`closed fixture: ${cErr.message}`);
  });

  test.afterAll(async () => {
    // Movements, items on them, lines and decisions cascade from the work order; the
    // work order cascades from the estimate.
    await destroyLoopFixture(db!, job);
    await destroyLoopFixture(db!, closedJob);
    for (const id of Object.values(item).filter(Boolean)) {
      const r = await db!.from("equipment_items").delete().eq("id", id);
      expect(r.error?.message ?? "", "equipment cleanup").toBe("");
    }
    for (const id of Object.values(branch).filter(Boolean)) {
      const r = await db!.from("supplier_branches").delete().eq("id", id);
      expect(r.error?.message ?? "", "branch cleanup").toBe("");
    }
    await db!.from("vendors").delete().in("name", [BRAND_A, BRAND_B, HARDWARE]);
    if (productIds.length) await db!.from("products").delete().in("id", productIds);
  });

  test("staff seed the branches and the register; a painter is refused every staff RPC", async () => {
    branch.delivering = okId(await rpcAs(staff!, "supplier_branch_upsert", { p: { brand: BRAND_A, branch: "Delivers", kind: "paint", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1, delivers_to_site: true, opens_weekday: "06:30" } }));
    branch.noDelivery = okId(await rpcAs(staff!, "supplier_branch_upsert", { p: { brand: BRAND_A, branch: "Counter only", kind: "paint", suburb: "Carnegie", postcode: "3163", lat: -37.89, lng: 145.06, delivers_to_site: false } }));
    branch.hardware = okId(await rpcAs(staff!, "supplier_branch_upsert", { p: { brand: HARDWARE, branch: "Store", kind: "hardware", suburb: "Moorabbin", postcode: "3189", lat: -37.94, lng: 145.05, delivers_to_site: true, favourite: true } }));
    // Same (brand, branch) again → the same row, not a second one.
    expect(await rpcAs(staff!, "supplier_branch_upsert", { p: { brand: BRAND_A, branch: "delivers", email: "orders@example.com" } })).toBe(`ok:${branch.delivering}`);
    expect(await rpcAs(staff!, "supplier_branch_set_account", { p_branch_id: branch.delivering, p_account_ref: "PG-TRADE-1", p_account_name: "Paint Group" })).toBe("ok:set");

    item.ladder = okId(await rpcAs(staff!, "equipment_item_create", { p_name: "Extension ladder 7 m", p_category: "ext_ladder_7" }));
    item.sprayer = okId(await rpcAs(staff!, "equipment_item_create", { p_name: "Spray gun — Graco 395", p_category: "spray_gun", p_serial_or_model: "Graco 395" }));
    const { rows: items } = await readAs(staff!, `equipment_items?id=in.(${item.ladder},${item.sprayer})&select=tag,category`);
    expect(items!.map((r) => String(r.tag))).toEqual(expect.arrayContaining([expect.stringMatching(/^E-\d{3}$/)]));
    expect(await rpcAs(staff!, "equipment_item_create", { p_name: "", p_category: "other" })).toBe("error:empty");

    for (const [fn, args] of [
      ["supplier_branch_upsert", { p: { brand: "X", branch: "Y" } }],
      ["supplier_branch_set_account", { p_branch_id: branch.delivering, p_account_ref: "steal" }],
      ["equipment_item_create", { p_name: "Mine", p_category: "other" }],
      ["movements_sync_now", { p_work_order_id: job!.workOrderId }],
      ["movement_create", { p: { kind: "other", title: "x" } }],
      ["movement_place", { p_id: job!.workOrderId, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: day(1) }],
      ["movement_mark_ordered", { p_id: job!.workOrderId }],
      ["movement_set_status", { p_id: job!.workOrderId, p_status: "done" }],
      ["material_line_add", { p_work_order_id: job!.workOrderId, p_text: "tape" }],
      ["wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: "not_needed" }],
    ] as const) {
      expect(await rpcAs(contractor!, fn, args as Record<string, unknown>), fn).toBe("error:not_staff");
    }
  });

  test("the sync makes one paint chip per brand, one rubbish question, and refreshes without touching a placed chip", async () => {
    // The fixture's snapshot update already fired the trigger; a staff re-sync converges.
    expect(await rpcAs(staff!, "movements_sync_now", { p_work_order_id: job!.workOrderId })).toMatch(/^ok:0:/);
    let rows = await chipsOf(job!.workOrderId);
    const a = chip(rows, `paint:${BRAND_A}`)!;
    const b = chip(rows, `paint:${BRAND_B}`)!;
    expect(a, "brand A chip").toBeTruthy();
    expect(b, "brand B chip").toBeTruthy();
    expect(String(a.title)).toBe(`${BRAND_A} · 2 lines · 4 cans`);     // 13 L = 10+2+1, 4 L = 4
    expect(String(b.title)).toBe(`${BRAND_B} · 1 line · 2 cans`);      // 20 L = 10+10
    expect(a.from_branch_id, "nearest DELIVERING branch of the brand").toBe(branch.delivering);
    expect(b.from_branch_id, "a brand with no branch gets a chip with no shop").toBeNull();
    expect(chip(rows, "rubbish")!.title).toBe("Rubbish — how?");
    expect(rows.filter((r) => r.status === "tray")).toHaveLength(3);

    // Customer: nothing, and no error. Contractor: nothing on the base table (no policy),
    // their job through the painter read.
    const asCustomer = await readAs(customer!, `movements?select=id&limit=5`);
    expect(asCustomer.error).toBeNull();
    expect(asCustomer.rows).toEqual([]);
    const branchesAsCustomer = await readAs(customer!, `supplier_branches?select=id&limit=5`);
    expect(branchesAsCustomer.error).toBeNull();
    expect(branchesAsCustomer.rows).toEqual([]);
    const asContractor = await readAs(contractor!, `movements?work_order_id=eq.${job!.workOrderId}&select=id`);
    expect(asContractor.error).toBeNull();
    expect(asContractor.rows).toEqual([]);
    const mine = await rpcRows(contractor!, "movements_for_painter", { p_work_order_id: job!.workOrderId });
    expect(mine.map((r) => r.source_key).sort()).toEqual([`paint:${BRAND_A}`, `paint:${BRAND_B}`, "rubbish"].sort());
    for (const r of mine) {
      expect(Object.keys(r)).not.toContain("expected_cost_cents");
      expect(Object.keys(r)).not.toContain("problem_note");
    }
    const painterBranches = await rpcRows(contractor!, "supplier_branches_for_painter", {});
    const seen = painterBranches.find((r) => r.id === branch.delivering)!;
    expect(seen).toBeTruthy();
    expect(Object.keys(seen).sort()).toEqual(["address", "branch", "brand", "id", "map_place_id", "opens_weekday", "phone", "suburb"]);
    const accounts = await readAs(contractor!, `supplier_branch_accounts?select=account_ref`);
    expect(accounts.error).toBeNull();
    expect(accounts.rows).toEqual([]);

    // Litres change on the Materials card → the tray chip is re-rendered.
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job!.workOrderId).single();
    const snap = (w as { wo_snapshot: Row & { materials: Row[] } }).wo_snapshot;
    snap.materials = snap.materials.map((m) => (m.product === PRODUCT_B ? { ...m, litres: 15 } : m));
    await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", job!.workOrderId);
    rows = await chipsOf(job!.workOrderId);
    expect(String(chip(rows, `paint:${BRAND_B}`)!.title)).toBe(`${BRAND_B} · 1 line · 1 can`);
    expect(chip(rows, `paint:${BRAND_B}`)!.id).toBe(b.id);
  });

  test("the supplier lane refuses a non-delivering branch and our own gear; paint waits for its colours", async () => {
    const rows = await chipsOf(job!.workOrderId);
    const a = chip(rows, `paint:${BRAND_A}`)!;
    expect(await rpcAs(staff!, "movement_update", { p_id: a.id, p: { from_branch_id: branch.noDelivery } })).toBe(`ok:${a.id}`);
    expect(await rpcAs(staff!, "movement_place", { p_id: a.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: day(5), p_half: "AM" })).toBe("error:branch_does_not_deliver");
    expect(await rpcAs(staff!, "movement_update", { p_id: a.id, p: { from_branch_id: branch.delivering, client_notice: true, note: "ring first", painter_visible: false } })).toBe(`ok:${a.id}`);
    expect(await rpcAs(staff!, "movement_place", { p_id: a.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: day(5), p_half: "AM" })).toBe("ok:planned");

    // Colours TBC → cannot order.
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: a.id })).toBe("error:colours_first");
    await db!.from("work_orders").update({ colours: { [PRODUCT_A]: { status: "confirmed", name: "Mist", hex: "#EEEEEE" }, [PRODUCT_B]: { status: "confirmed", name: "Snow", hex: "#FFFFFF" } } }).eq("id", job!.workOrderId);
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: a.id })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: a.id })).toBe("ok:already");
    const after = chip(await chipsOf(job!.workOrderId), `paint:${BRAND_A}`)!;
    expect(after.status).toBe("booked");
    expect(after.ordered_at).toBeTruthy();
    expect(Array.isArray(after.lines) && (after.lines as Row[]).length).toBe(2);
    // The office note is not painter-visible → the painter read carries an empty note.
    const mine = await rpcRows(contractor!, "movements_for_painter", { p_work_order_id: job!.workOrderId });
    expect(mine.find((r) => r.id === a.id)!.note).toBe("");

    // A Materials change AFTER ordering flags the chip, never re-renders it.
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job!.workOrderId).single();
    const snap = (w as { wo_snapshot: Row & { materials: Row[] } }).wo_snapshot;
    snap.materials = snap.materials.map((m) => (m.product === PRODUCT_A && m.colourName === "Mist" ? { ...m, litres: 10 } : m));
    await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", job!.workOrderId);
    const flagged = chip(await chipsOf(job!.workOrderId), `paint:${BRAND_A}`)!;
    expect(flagged.source_changed_at, "source_changed_at set").toBeTruthy();
    expect(flagged.title).toBe(after.title);

    // Our own gear on the supplier lane → refused.
    const gear = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, items: [item.ladder] } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: gear, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: day(5) })).toBe("error:supplier_own_gear");
    // The same item on a second gear chip → refused by tag.
    expect(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, items: [item.ladder] } })).toMatch(/^error:item_already_planned:E-\d{3}$/);
    // A staff-style drop-off: no order step, booked on placing, auto return in the tray.
    expect(await rpcAs(staff!, "movement_place", { p_id: gear, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(6), p_half: "AM" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: gear })).toBe("error:no_order_step");
    const ret = chip(await chipsOf(job!.workOrderId), `return:${gear}`)!;
    expect(ret, "auto return chip").toBeTruthy();
    expect(ret.status).toBe("tray");
    expect(ret.due_date).toBe(day(9));
    expect(await rpcAs(staff!, "equipment_item_set_status", { p_id: item.ladder, p_status: "retired" })).toBe("error:in_a_movement");
  });

  test("a stranded item blocks its next out until the return is done; location follows the ticks", async () => {
    // The sprayer went out to the (now closed) job and was ticked done; nothing brought it back.
    const out = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: closedJob!.workOrderId, items: [item.sprayer] } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: out, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(-10) })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: out, p_status: "done" })).toBe("ok:done");
    // The auto return it made is not what makes it stranded — cancel it to prove the sweep remakes one.
    const autoReturn = chip(await chipsOf(closedJob!.workOrderId), `return:${out}`)!;
    await db!.from("movements").delete().eq("id", autoReturn.id);
    expect(await rpcAs(staff!, "movements_sync_now", { p_work_order_id: closedJob!.workOrderId })).toBe("ok:1:0:0");
    const remade = chip(await chipsOf(closedJob!.workOrderId), `return:${out}`)!;
    expect(remade.status).toBe("tray");

    // Felipe wants the sprayer on the live job: the chip is made, blocked by that return.
    const next = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, items: [item.sprayer] } }));
    const nextRow = (await chipsOf(job!.workOrderId)).find((r) => r.id === next)!;
    expect(nextRow.blocked_by_movement_id).toBe(remade.id);
    expect(await rpcAs(staff!, "movement_place", { p_id: next, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(6) })).toBe(`error:blocked:${remade.id}`);
    // Collect it, tick it, and the out can go.
    expect(await rpcAs(staff!, "movement_place", { p_id: remade.id, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(2), p_half: "PM" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: remade.id, p_status: "done" })).toBe("ok:done");
    expect(await rpcAs(staff!, "movement_place", { p_id: next, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(6) })).toBe("ok:booked");
  });

  test("a painter's pickup: placed on their lane, ordered, ticked by the painter; the transitions and their refusals", async () => {
    const rows = await chipsOf(job!.workOrderId);
    const b = chip(rows, `paint:${BRAND_B}`)!;
    expect(await rpcAs(staff!, "movement_update", { p_id: b.id, p: { from_branch_id: branch.noDelivery } })).toBe(`ok:${b.id}`);
    // A person picking up from a branch owes the order step → planned.
    expect(await rpcAs(staff!, "movement_place", { p_id: b.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: day(6), p_half: "AM" })).toBe("ok:planned");
    expect(await rpcAs(contractor!, "movement_painter_done", { p_id: b.id })).toBe("error:not_booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: b.id, p_status: "done" })).toBe("error:not_booked");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: b.id })).toBe("ok:booked");
    // The painter sees it as theirs, with the branch and the order ref; ticks it.
    const mine = await rpcRows(contractor!, "movements_for_painter", { p_day: day(6) });
    const pickup = mine.find((r) => r.id === b.id)!;
    expect(pickup.mine).toBe(true);
    expect(String(pickup.from_text)).toContain("Counter only");
    expect(await rpcAs(contractor!, "movement_painter_done", { p_id: b.id })).toBe("ok:done");
    expect(await rpcAs(contractor!, "movement_painter_done", { p_id: b.id })).toBe("ok:already");
    expect(await rpcAs(staff!, "movement_unplace", { p_id: b.id })).toBe("error:done");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: b.id, p_status: "cancelled" })).toBe("error:done");

    // Problem and back; unplace clears the order step; redate / time / sequence.
    const a = chip(rows, `paint:${BRAND_A}`)!;
    expect(await rpcAs(staff!, "movement_set_status", { p_id: a.id, p_status: "problem", p_note: "shop closed" })).toBe("ok:problem");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: a.id, p_status: "done" })).toBe("error:not_booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: a.id, p_status: "booked" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: a.id, p_status: "tray" })).toBe("error:bad_transition");
    expect(await rpcAs(staff!, "movement_redate", { p_id: a.id, p_due_date: day(4), p_half: "PM" })).toBe(`ok:${day(4)}`);
    expect(await rpcAs(staff!, "movement_set_time", { p_id: a.id, p_time: "09:30" })).toBe("ok:09:30:00");
    expect(await rpcAs(staff!, "movement_set_sequence", { p_assignee_kind: "supplier", p_assignee_id: null, p_day: day(5), p_ids: [a.id] })).toBe("error:not_that_day");
    expect(await rpcAs(staff!, "movement_set_sequence", { p_assignee_kind: "supplier", p_assignee_id: null, p_day: day(4), p_ids: [a.id] })).toBe("ok:1");
    expect(await rpcAs(staff!, "movement_unplace", { p_id: a.id })).toBe("ok:tray");
    const back = chip(await chipsOf(job!.workOrderId), `paint:${BRAND_A}`)!;
    expect(back.status).toBe("tray");
    expect(back.ordered_at).toBeNull();
    expect(back.assignee_kind).toBeNull();

    // Send to phone: the stub logs on every movement of that person-day.
    expect(await rpcAs(staff!, "movement_send_run_plan", { p_person_kind: "profiles", p_person_id: staffProfileId, p_day: day(6) })).toMatch(/^ok:[1-9]/);
    const sent = (await chipsOf(job!.workOrderId)).filter((r) => r.run_plan_sent_at);
    expect(sent.length).toBeGreaterThan(0);
  });

  test("material lines: one list, three doors — add, merge, a placed line refuses removal, a painter request becomes a line", async () => {
    const l1 = okId(await rpcAs(staff!, "material_line_add", { p_work_order_id: job!.workOrderId, p_text: "Caulk × 6", p_source: "estimate" }));
    const l2 = okId(await rpcAs(staff!, "material_line_add", { p_work_order_id: job!.workOrderId, p_text: "Drop sheets" }));
    expect(await rpcAs(staff!, "material_line_add", { p_work_order_id: job!.workOrderId, p_text: "   " })).toBe("error:empty");
    let rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `matline:${l1}`)!.title).toBe("Caulk × 6");
    expect(chip(rows, `matline:${l1}`)!.from_branch_id, "nearest hardware branch (favourites first)").toBe(branch.hardware);
    expect(chip(rows, `matline:${l2}`)).toBeTruthy();

    // Merge two into one chip; un-merge brings the second back.
    expect(await rpcAs(staff!, "material_line_merge", { p_ids: [l2], p_into: l1 })).toBe(`ok:${l1}`);
    rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `matline:${l2}`)).toBeUndefined();
    expect(await rpcAs(staff!, "material_line_merge", { p_ids: [], p_into: l1 })).toBe("ok:unmerged");
    rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `matline:${l2}`)).toBeTruthy();

    // A placed line cannot be removed until it is back in the tray.
    const c1 = chip(rows, `matline:${l1}`)!;
    expect(await rpcAs(staff!, "movement_place", { p_id: c1.id, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: day(6), p_half: "PM" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "material_line_remove", { p_id: l1 })).toBe("error:placed");
    expect(await rpcAs(staff!, "material_line_merge", { p_ids: [l1], p_into: l2 })).toBe("error:placed");
    // Editing the chip edits the line (one list).
    expect(await rpcAs(staff!, "movement_update", { p_id: c1.id, p: { title: "Caulk × 8" } })).toBe(`ok:${c1.id}`);
    const { rows: lines } = await readAs(staff!, `wo_material_lines?id=eq.${l1}&select=text`);
    expect(lines![0].text).toBe("Caulk × 8");
    expect(await rpcAs(staff!, "movement_unplace", { p_id: c1.id })).toBe("ok:tray");
    expect(await rpcAs(staff!, "material_line_remove", { p_id: l1 })).toBe("ok:removed");
    expect(chip(await chipsOf(job!.workOrderId), `matline:${l1}`)).toBeUndefined();

    // A painter request accepted as a line.
    const { data: rq, error } = await db!.from("wo_material_requests").insert({ work_order_id: job!.workOrderId, contractor_id: contractorId, item: "Masking tape", quantity: "4 rolls" }).select("id").single();
    expect(error).toBeNull();
    const requestId = (rq as { id: string }).id;
    const l3 = okId(await rpcAs(staff!, "material_request_accept", { p_request_id: requestId }));
    expect(await rpcAs(staff!, "material_request_accept", { p_request_id: requestId })).toBe("error:already_ordered");
    rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `matline:${l3}`)!.title).toBe("Masking tape × 4 rolls");
    const { rows: req } = await readAs(staff!, `wo_material_requests?id=eq.${requestId}&select=status,reply`);
    expect(req![0].status).toBe("ordered");
  });

  test("decisions and the rubbish question: not needed empties the tray, a placed chip stays; rubbish how", async () => {
    let rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `paint:${BRAND_A}`)!.status).toBe("tray");
    expect(await rpcAs(staff!, "wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: "painter_supplies" })).toBe("ok:painter_supplies");
    rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `paint:${BRAND_A}`), "tray paint chip removed by the decision").toBeUndefined();
    expect(chip(rows, `paint:${BRAND_B}`)!.status, "a done chip is never touched").toBe("done");
    expect(await rpcAs(staff!, "wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: null })).toBe("ok:cleared");
    rows = await chipsOf(job!.workOrderId);
    expect(chip(rows, `paint:${BRAND_A}`)!.status, "cleared → the chip is back").toBe("tray");
    expect(await rpcAs(staff!, "wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: "maybe" })).toBe("error:bad_decision");

    // The undecided rubbish chip cannot land; answered, it can.
    const rubbish = chip(rows, "rubbish")!;
    expect(await rpcAs(staff!, "movement_place", { p_id: rubbish.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: day(9) })).toBe("error:rubbish_undecided");
    expect(await rpcAs(staff!, "movement_update", { p_id: rubbish.id, p: { rubbish_how: "sideways" } })).toBe("error:bad_rubbish_how");
    expect(await rpcAs(staff!, "movement_create", { p: { kind: "rubbish_out", work_order_id: job!.workOrderId, title: "second" } })).toBe("error:rubbish_exists");
    expect(await rpcAs(staff!, "movement_update", { p_id: rubbish.id, p: { rubbish_how: "painter_warehouse" } })).toBe(`ok:${rubbish.id}`);
    let r = (await chipsOf(job!.workOrderId)).find((x) => x.id === rubbish.id)!;
    expect(r.status, "a drop-off on the painter on the last day: booked").toBe("booked");
    expect(r.assignee_id).toBe(contractorId);
    expect(r.due_date).toBe(day(9));
    // The office changes its mind: back to the tray and None → recorded, chip cancelled.
    expect(await rpcAs(staff!, "movement_unplace", { p_id: rubbish.id })).toBe("ok:tray");
    expect(await rpcAs(staff!, "movement_update", { p_id: rubbish.id, p: { rubbish_how: "none" } })).toBe(`ok:${rubbish.id}`);
    r = (await chipsOf(job!.workOrderId)).find((x) => x.id === rubbish.id)!;
    expect(r.status).toBe("cancelled");
    const { rows: dec } = await readAs(staff!, `wo_logistics_decisions?work_order_id=eq.${job!.workOrderId}&line=eq.rubbish&select=decision`);
    expect(dec![0].decision).toBe("not_needed");
    // Customers still read nothing.
    const asCustomer = await readAs(customer!, `wo_logistics_decisions?select=line`);
    expect(asCustomer.error).toBeNull();
    expect(asCustomer.rows).toEqual([]);
  });
});

import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 7 of the build plan: the crossings (brief §3.5, rulings 12, 17, 20,
 * flags ⚑9 ⚑10). Migration 20270282.
 *
 *   API-level, adversarial (the gates are real — acceptance 6):
 *     1. "Materials ordered" refuses with paint_not_ordered while a paint chip is unordered;
 *        ticks once every paint chip is ordered; "painter supplies" unlocks it too (⚑10);
 *     2. "Equipment movements booked" refuses with equipment_not_booked while a gear chip
 *        is in the tray; ticks once it is placed (booked) — or marked not needed;
 *     3. the estimate's internal Materials & sundries list becomes lines (source estimate)
 *        on the job when the job syncs, once — and NEVER reaches the customer's estimate
 *        page or the painter's job sheet HTML (ruling 12);
 *     4. the painter's completion-prep yeses: Equipment for collection → the gear return is
 *        confirmed (a tray one made when the office never booked an out); Rubbish → the
 *        rubbish chip is confirmed, left on site when the office had not answered;
 *     5. a hire_off ticked done with an expected cost writes a job_costs row (⚑9); a
 *        material_costs row with the order ref links itself to the movement;
 *     6. Accept as a line on a painter's materials request makes a line and a chip.
 *   In the browser as the PC: the job page's pre-start shows the chips and the lines under
 *   the two gate items, Add a line → a chip in the tray, and the tick refusal reads in words.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `E2E Dulux ${RUN}`;
const PRODUCT = `E2E Weathershield ${RUN}`;
const SECRET_LINE = `E2E sundries secret ${RUN} caulk × 6`;
const ITEM_NAME = `E2E ladder ${RUN}`;

type Row = Record<string, unknown>;
let contractorId = "";
let job: LoopFixture | null = null;
let productId = "";
let branchId = "";
let itemId = "";
let estimateToken = "";
let shareToken = "";
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const TODAY = melbourne.format(new Date());
const START = addDays(TODAY, 10);
const END = addDays(START, 2);

async function chips(): Promise<Row[]> {
  const { data, error } = await db!.from("movements").select("id, kind, source_key, title, status, ordered_at, due_date, to_kind, detail, painter_confirmed_at, expected_cost_cents, order_ref, from_branch_id").eq("work_order_id", job!.workOrderId).order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}
async function items(): Promise<Map<string, { id: string; done: boolean }>> {
  const { data, error } = await db!.from("wo_checklist_items").select("id, phase, label, item_key, done_at").eq("work_order_id", job!.workOrderId);
  expect(error).toBeNull();
  return new Map(((data ?? []) as { id: string; phase: string; label: string; item_key: string | null; done_at: string | null }[]).map((r) => [`${r.phase}:${r.item_key ?? r.label}`, { id: r.id, done: r.done_at !== null }]));
}
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };

test.describe.configure({ mode: "serial" });

test.describe("Movements crossings (Session 7)", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId).toBeTruthy();
    const { data: pr, error: pErr } = await db!.from("products").insert({ name: PRODUCT, brand: BRAND, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
    if (pErr) throw new Error(pErr.message);
    productId = (pr as { id: string }).id;
    const { data: b, error: bErr } = await db!.from("supplier_branches").insert({
      brand: BRAND, branch: "Delivers", kind: "hire", suburb: "Oakleigh South", address: "1 Paint Rd", postcode: "3167", lat: -37.92, lng: 145.1, delivers_to_site: true, opens_weekday: "06:30", active: true,
    }).select("id").single();
    if (bErr) throw new Error(bErr.message);
    branchId = (b as { id: string }).id;
    itemId = okId(await rpcAs(staff!, "equipment_item_create", { p_name: ITEM_NAME, p_category: "step_ladder" }));

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    estimateToken = `${RUN}e2${"t".repeat(26)}`.slice(0, 32);
    const { error: eErr } = await db!.from("estimates").update({ share_token: estimateToken, builder_state: { internalMaterials: [SECRET_LINE, "   "] } }).eq("id", job.estimateId);
    if (eErr) throw new Error(`estimate: ${eErr.message}`);
    const { data: w } = await db!.from("work_orders").select("wo_snapshot, share_token").eq("id", job.workOrderId).single();
    shareToken = String((w as { share_token: string }).share_token);
    const materials = [{ product: PRODUCT, colourKey: `${PRODUCT}||Lexicon`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" }];
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E Crossings ${RUN}` };
    // The Materials hook: this update copies the estimate's lines AND syncs the chips (20270282).
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: START, end_date: END,
      colours: { [PRODUCT]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(uErr.message);
    expect(await rpcAs(staff!, "wo_seed_checklists", { p_work_order_id: job.workOrderId })).toMatch(/^ok:/);
  });

  test.afterAll(async () => {
    if (job) await db!.from("job_costs").delete().eq("work_order_id", job.workOrderId);
    if (job) await db!.from("material_costs").delete().eq("work_order_id", job.workOrderId);
    await destroyLoopFixture(db!, job);
    if (itemId) await db!.from("equipment_items").delete().eq("id", itemId);
    if (branchId) await db!.from("supplier_branches").delete().eq("id", branchId);
    await db!.from("vendors").delete().eq("name", BRAND);
    if (productId) await db!.from("products").delete().eq("id", productId);
  });

  test("the estimate's internal list is a line (once) and a chip; the gate items carry keys", async () => {
    const { data: lines } = await db!.from("wo_material_lines").select("text, source").eq("work_order_id", job!.workOrderId);
    expect((lines ?? []) as Row[]).toEqual([{ text: SECRET_LINE, source: "estimate" }]);
    // A second sync adds nothing.
    expect(await rpcAs(staff!, "movements_sync_now", { p_work_order_id: job!.workOrderId })).toMatch(/^ok/);
    const { data: again } = await db!.from("wo_material_lines").select("id").eq("work_order_id", job!.workOrderId);
    expect((again ?? []).length).toBe(1);
    const rows = await chips();
    expect(rows.some((r) => String(r.source_key).startsWith("matline:")), "the line is a chip").toBe(true);
    expect(rows.find((r) => r.source_key === `paint:${BRAND}`), "the paint chip").toBeTruthy();
    const it = await items();
    expect(it.get("pre_start:materials"), "Materials ordered keyed").toBeTruthy();
    expect(it.get("pre_start:equipment"), "Equipment movements booked keyed").toBeTruthy();
  });

  test("ruling 12: the list never reaches the customer's estimate page or the painter's job sheet", async ({ request }) => {
    for (const path of [`/e/${estimateToken}`, `/w/${shareToken}`]) {
      const res = await request.get(path);
      const html = await res.text();
      expect(html, `${path} leaked the internal materials list`).not.toContain(`sundries secret ${RUN}`);
    }
  });

  // Tom, 24 Oct 2026 (6 Fleet St, 43 Keith St): a chip OFF the tray is enough — planned on the
  // Supplier lane counts, Ordered ✓ is the painter's text — and the item ticks ITSELF the moment
  // the gate opens (migration 20270298). A chip back in the tray blocks a hand tick again but
  // never unticks what was ticked.
  test("Materials ordered refuses while a paint chip is in the tray; placing it ticks the item by itself; painter supplies too", async () => {
    const it = await items();
    const colours = it.get("pre_start:colours")!;
    const materials = it.get("pre_start:materials")!;
    expect(await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: colours.id, p_answer: "yes", p_note: "" })).toBe("ok:yes");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true })).toBe("error:paint_not_ordered");
    expect((await items()).get("pre_start:materials")!.done).toBe(false);

    const paint = (await chips()).find((r) => r.source_key === `paint:${BRAND}`)!;
    expect(await rpcAs(staff!, "movement_update", { p_id: paint.id, p: { from_branch_id: branchId } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: START, p_half: "AM" })).toBe("ok:planned");
    expect((await items()).get("pre_start:materials")!.done, "ticked itself when the chip left the tray").toBe(true);
    const { data: ev } = await db!.from("wo_events").select("actor_kind, meta").eq("work_order_id", job!.workOrderId).eq("type", "checklist_ticked");
    expect(((ev ?? []) as { actor_kind: string; meta: { auto?: boolean; label?: string } }[]).some((e) => e.actor_kind === "system" && e.meta.auto === true && e.meta.label === "Materials ordered")).toBe(true);
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: paint.id })).toBe("ok:booked");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: false })).toBe("ok:undone");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true })).toBe("ok:done");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: false })).toBe("ok:undone");

    // ⚑10: the painter buying the paint themselves is an answer — and it ticks the item too.
    expect(await rpcAs(staff!, "movement_unplace", { p_id: paint.id })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true })).toBe("error:paint_not_ordered");
    expect(await rpcAs(staff!, "wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: "painter_supplies" })).toMatch(/^ok/);
    expect((await items()).get("pre_start:materials")!.done, "ticked itself on the decision").toBe(true);
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: false })).toBe("ok:undone");
    expect(await rpcAs(staff!, "wo_logistics_decide", { p_work_order_id: job!.workOrderId, p_line: "paint", p_decision: null })).toMatch(/^ok/);
  });

  test("Equipment movements booked refuses while a gear chip is in the tray; placing it books it", async () => {
    const equipment = (await items()).get("pre_start:equipment")!;
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: equipment.id, p_done: true }), "no gear chips = open").toBe("ok:done");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: equipment.id, p_done: false })).toBe("ok:undone");
    const out = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, items: [itemId] } }));
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: equipment.id, p_done: true })).toBe("error:equipment_not_booked");
    expect(await rpcAs(staff!, "movement_place", { p_id: out, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: START, p_half: "AM" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: equipment.id, p_done: true })).toBe("ok:done");
    // The auto return chip exists for the prep answer below.
    expect((await chips()).find((r) => r.source_key === `return:${out}`), "return chip").toBeTruthy();
  });

  test("the painter's completion-prep yeses confirm the return and the rubbish chips", async () => {
    expect(await rpcAs(contractor!, "wo_seed_prep_checklist", { p_work_order_id: job!.workOrderId })).toMatch(/^ok:/);
    const it = await items();
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: it.get("completion_prep:equipment")!.id, p_answer: "yes", p_note: "the ladder" })).toBe("ok:yes");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: it.get("completion_prep:rubbish")!.id, p_answer: "yes", p_note: "" })).toBe("ok:yes");
    const rows = await chips();
    const ret = rows.find((r) => r.kind === "equipment_return")!;
    expect(ret.painter_confirmed_at, "gear return confirmed by the painter").toBeTruthy();
    expect(ret.detail).toBe("the ladder");
    const rubbish = rows.find((r) => r.source_key === "rubbish")!;
    expect(rubbish.painter_confirmed_at, "rubbish chip confirmed").toBeTruthy();
    expect(rubbish.detail).not.toBe("undecided");
    expect(rubbish.to_kind).toBe("tip");
    expect(String(rubbish.title)).toMatch(/collect from site/);
  });

  test("off-hire done writes the hire cost; a matched invoice links to its order", async () => {
    const hire = okId(await rpcAs(staff!, "movement_create", { p: { kind: "hire_on", work_order_id: job!.workOrderId, title: `E2E plank hire ${RUN}`, from: { kind: "branch", branch_id: branchId }, expected_cost_cents: 22000 } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: hire, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: START, p_half: "AM" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: hire })).toBe("ok:booked");
    const off = (await chips()).find((r) => r.source_key === `hire_off:${hire}`)!;
    expect(off, "auto hire_off chip").toBeTruthy();
    expect(await rpcAs(staff!, "movement_update", { p_id: off.id, p: { expected_cost_cents: 22000 } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: off.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: END, p_half: "PM" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: off.id })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: off.id, p_status: "done" })).toBe("ok:done");
    const { data: costs } = await db!.from("job_costs").select("category, amount_ex_cents, gst_cents, status, description").eq("work_order_id", job!.workOrderId);
    const cost = ((costs ?? []) as Row[]).find((c) => c.category === "equipment_hire");
    expect(cost, "job_costs row").toBeTruthy();
    expect(Number(cost!.amount_ex_cents) + Number(cost!.gst_cents)).toBe(22000);
    expect(cost!.status).toBe("recorded");
    // Done twice never writes twice.
    expect(await rpcAs(staff!, "movement_set_status", { p_id: off.id, p_status: "done" })).toBe("error:not_booked");

    const { data: mc, error: mcErr } = await db!.from("material_costs").insert({ work_order_id: job!.workOrderId, supplier: BRAND, brand: BRAND, order_ref: String(off.order_ref), amount_cents: 22000, source: "manual", matched_by: "manual", matched_at: new Date().toISOString() }).select("movement_id").single();
    expect(mcErr).toBeNull();
    expect((mc as { movement_id: string | null }).movement_id, "the invoice found its order").toBeTruthy();
  });

  test("Accept as a line on a painter's request makes a line and a chip", async () => {
    const req = okId(await rpcAs(contractor!, "wo_request_material", { p_work_order_id: job!.workOrderId, p_item: `E2E sugar soap ${RUN}`, p_quantity: "2" }));
    expect(await rpcAs(staff!, "material_request_accept", { p_request_id: req })).toMatch(/^ok:/);
    const { data: lines } = await db!.from("wo_material_lines").select("text, source").eq("work_order_id", job!.workOrderId).eq("source", "painter_request");
    expect((lines ?? []) as Row[]).toEqual([{ text: `E2E sugar soap ${RUN} × 2`, source: "painter_request" }]);
    const { data: r } = await db!.from("wo_material_requests").select("status, reply").eq("id", req).single();
    expect((r as Row).status).toBe("ordered");
    expect(String((r as Row).reply)).toMatch(/Added to the order/);
  });

  test("the job page: chips and lines under the gate items; Add a line → a chip; the refusal in words", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const mats = page.getByTestId("prestart-materials");
    await expect(mats).toBeVisible({ timeout: 30_000 });
    await expect(mats.getByTestId("prestart-chip")).not.toHaveCount(0);
    await expect(mats.getByTestId("prestart-material-line")).not.toHaveCount(0);
    await expect(page.getByTestId("prestart-text-materials")).toHaveCount(0); // the old box is gone
    const before = (await chips()).length;
    await mats.getByTestId("prestart-line-input").fill(`E2E drop sheets ${RUN}`);
    await mats.getByTestId("prestart-line-add").click();
    await expect(mats.getByTestId("prestart-materials-msg")).toContainText(/Line added/);
    await expect.poll(async () => (await chips()).length, { timeout: 15_000 }).toBe(before + 1);
    // The gate line says why the tick would refuse (the paint chip is back in the tray, unordered).
    await expect(mats.getByTestId("prestart-materials-gate")).toContainText(/refuses until/);
    const equipment = page.getByTestId("prestart-equipment");
    await expect(equipment.getByTestId("prestart-equipment-gate")).toContainText(/the tick is free/);
  });

  test("the painter cannot tick the office's gate items past the gate", async () => {
    const materials = (await items()).get("pre_start:materials")!;
    expect(await rpcAs(contractor!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true })).toBe("error:paint_not_ordered");
    const token = await accessTokenFor(contractor!);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const body = await fetch(`${url}/rest/v1/wo_material_lines?work_order_id=eq.${job!.workOrderId}&select=id`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    expect(Array.isArray(body) ? body : [], "no painter read on the lines table").toEqual([]);
  });

  // Tom, 24 Oct 2026 (6 Fleet St Laverton): the paint chip sat planned on the Supplier lane for a day
  // outside the board's week, so the tray looked empty and Materials ordered would not tick. The gate
  // now only minds the tray, the job page names the chip still in it, and the item ticks itself.
  test("the job page names the chip still in the tray; once every chip is on the board the item is ticked by itself", async ({ page }) => {
    const paint = (await chips()).find((r) => r.source_key === `paint:${BRAND}`)!;
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: START, p_half: "AM" })).toBe("ok:planned");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const mats = page.getByTestId("prestart-materials");
    // The drop-sheets line added above is a materials chip still in the tray — it is the one named.
    await expect(mats.getByTestId("prestart-materials-gate")).toContainText(/ticks itself once "E2E drop sheets .*" \(in the tray\)/, { timeout: 30_000 });
    expect((await items()).get("pre_start:materials")!.done).toBe(false);
    const sheets = (await chips()).find((r) => String(r.title).startsWith("E2E drop sheets"))!;
    expect(await rpcAs(staff!, "movement_place", { p_id: sheets.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: START, p_half: "AM" })).toBe("ok:planned");
    expect((await items()).get("pre_start:materials")!.done, "ticked itself once the last chip left the tray").toBe(true);
    await page.reload();
    await expect(mats.getByTestId("prestart-materials-gate")).toContainText(/on the board — ticked by itself/, { timeout: 30_000 });
  });
});

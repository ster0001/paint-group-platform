import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 8 of the build plan: the full loop (brief §7 Session 8, §8).
 *
 * The mockup's week, small: two jobs (one live with a Dulux paint chip, a materials line and
 * gear going out; one closed with a sprayer stranded on it), the staff login hourly on the
 * board, the E2E contractor as the painter. Then: plan every chip → order every order → run
 * Mon–Sat with ticks from the PC and the painter → every item back at the warehouse → a
 * supplier invoice with the PG- reference lands on its movement. Every §8 criterion that can
 * be asserted at the API or on the rendered page is asserted here; the rollback switch last.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `E2E Dulux ${RUN}`;
const PRODUCT = `E2E Weathershield ${RUN}`;
const LINE = `E2E filler × 2 ${RUN}`;
type Row = Record<string, unknown>;

let contractorId = "";
let staffProfileId = "";
let live: LoopFixture | null = null;
let closed: LoopFixture | null = null;
let productId = "";
let branchId = "";
let ladderId = "";
let sprayerId = "";
let settingsBefore: unknown = undefined;
let settingsExisted = false;
let phoneBefore: string | null | undefined;
const PHONE = "0400000000";

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function targetMonday(): string {
  const today = melbourne.format(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(addDays(today, ((8 - dow) % 7) || 7), 14); // three weeks out: no other spec's data
}
const MON = targetMonday();
const TUE = addDays(MON, 1);
const FRI = addDays(MON, 4);
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };

async function chipsOf(wo: string): Promise<Row[]> {
  const { data, error } = await db!.from("movements").select("id, kind, source_key, title, status, ordered_at, due_date, assignee_kind, assignee_id, order_ref, painter_confirmed_at, done_at").eq("work_order_id", wo).neq("status", "cancelled").order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}
const chip = (rows: Row[], key: string) => rows.find((r) => r.source_key === key);

test.describe.configure({ mode: "serial" });

test.describe("Movements full loop (Session 8)", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    // The painter has a mobile, so the order step has somewhere to draft the text to.
    const { data: c } = await db!.from("contractors").select("phone").eq("id", contractorId).single();
    phoneBefore = (c as { phone: string | null } | null)?.phone;
    await db!.from("contractors").update({ phone: PHONE }).eq("id", contractorId);
    const { data: pr, error: pErr } = await db!.from("products").insert({ name: PRODUCT, brand: BRAND, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
    if (pErr) throw new Error(pErr.message);
    productId = (pr as { id: string }).id;
    const { data: b, error: bErr } = await db!.from("supplier_branches").insert({ brand: BRAND, branch: "Delivers", kind: "paint", suburb: "Oakleigh South", address: "1 Paint Rd", postcode: "3167", lat: -37.92, lng: 145.1, delivers_to_site: true, opens_weekday: "06:30", active: true }).select("id").single();
    if (bErr) throw new Error(bErr.message);
    branchId = (b as { id: string }).id;
    ladderId = okId(await rpcAs(staff!, "equipment_item_create", { p_name: `E2E ladder ${RUN}`, p_category: "ext_ladder_7" }));
    sprayerId = okId(await rpcAs(staff!, "equipment_item_create", { p_name: `E2E sprayer ${RUN}`, p_category: "spray_gun" }));

    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s); settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const people = Array.isArray(base.boardPeople) ? (base.boardPeople as Row[]).filter((p) => p.id !== staffProfileId) : [];
    const { error: sErr } = await db!.from("settings").upsert({ key: "movements", value: { ...base, movementsTab: true, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }], warehouse: { label: "Warehouse", address: "25-27 Bunney Rd", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1 } } }, { onConflict: "key" });
    if (sErr) throw new Error(sErr.message);

    // The live job: Dulux paint, a materials line, start Tue–Fri next week.
    live = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", live.workOrderId).single();
    const materials = [{ product: PRODUCT, colourKey: `${PRODUCT}||Lexicon`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" }];
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E Loop ${RUN}` },
      stage: "pre_start", start_date: TUE, end_date: FRI, colours: { [PRODUCT]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" } },
    }).eq("id", live.workOrderId);
    if (uErr) throw new Error(uErr.message);
    expect(await rpcAs(staff!, "material_line_add", { p_work_order_id: live.workOrderId, p_text: LINE, p_source: "pc" })).toMatch(/^ok:/);

    // The closed job with the sprayer still on it: out, done, then closed.
    closed = await createLoopFixture(db!, contractorId, [{ heading: "Back", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "in_progress", start_date: addDays(MON, -10), end_date: addDays(MON, -7) }).eq("id", closed.workOrderId);
    const out = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: closed.workOrderId, items: [sprayerId] } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: out, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: addDays(MON, -10), p_half: "AM" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: out, p_status: "done" })).toBe("ok:done");
    const { error: cErr } = await db!.from("work_orders").update({ stage: "closed" }).eq("id", closed.workOrderId);
    if (cErr) throw new Error(cErr.message);
  });

  test.afterAll(async () => {
    for (const f of [live, closed]) if (f) { await db!.from("material_costs").delete().eq("work_order_id", f.workOrderId); await destroyLoopFixture(db!, f); }
    for (const id of [ladderId, sprayerId]) if (id) await db!.from("equipment_items").delete().eq("id", id);
    if (branchId) await db!.from("supplier_branches").delete().eq("id", branchId);
    await db!.from("vendors").delete().eq("name", BRAND);
    if (productId) await db!.from("products").delete().eq("id", productId);
    if (contractorId) {
      await db!.from("automation_holds").delete().eq("contractor_id", contractorId).in("automation_key", ["movement_pickup_ready", "movement_delivery_booked", "movement_run_plan"]);
      if (phoneBefore !== undefined) await db!.from("contractors").update({ phone: phoneBefore }).eq("id", contractorId);
    }
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  const openWeek = async (page: Page) => { await page.goto(`/pc/movements?view=week&week=${MON}`); await expect(page.getByTestId("movements-board")).toBeVisible({ timeout: 30_000 }); };

  test("§8.4 chips come from the jobs: paint per brand, a chip per line, the rubbish question, the stranded sprayer's return", async ({ page }) => {
    const rows = await chipsOf(live!.workOrderId);
    expect(chip(rows, `paint:${BRAND}`)).toBeTruthy();
    expect(rows.some((r) => String(r.source_key).startsWith("matline:"))).toBe(true);
    expect(chip(rows, "rubbish")).toBeTruthy();
    const closedRows = await chipsOf(closed!.workOrderId);
    expect(closedRows.find((r) => r.kind === "equipment_return" && r.status === "tray"), "the stranded sprayer's return chip in the tray").toBeTruthy();
    await signIn(page, staff!, /\/(home|estimates)/);
    await openWeek(page);
    await expect(page.getByTestId("movements-headline")).toContainText(/chips still in the tray/);
    await expect(page.locator(`[data-testid="tray-chip"][data-movement-id="${chip(rows, `paint:${BRAND}`)!.id}"]`)).toBeVisible();
    // The closed job is its own group in the tray (other closed jobs with stranded gear may sit there too).
    expect(await page.getByTestId("tray-group").filter({ hasText: /closed/i }).count()).toBeGreaterThanOrEqual(1);
  });

  test("plan every chip, order every order (§8.5 alerts the painter draft-first; §8.6 the gate opens)", async ({ page }) => {
    const rows = await chipsOf(live!.workOrderId);
    const paint = chip(rows, `paint:${BRAND}`)!;
    const line = rows.find((r) => String(r.source_key).startsWith("matline:"))!;
    const rubbish = chip(rows, "rubbish")!;
    // Paint → the supplier, Tuesday AM; the materials line → the painter picks up Tuesday 07:00; rubbish → painter drops at the warehouse.
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: TUE, p_half: "AM" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "movement_update", { p_id: line.id, p: { from_branch_id: branchId } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: line.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: TUE, p_half: "AM", p_time: "07:00" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "movement_update", { p_id: rubbish.id, p: { rubbish_how: "painter_warehouse" } })).toMatch(/^ok/);
    // Gear: the ladder out with the staff member Monday 07:30 (booked by placing — no order step); its return appears for Friday.
    const ladderOut = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: live!.workOrderId, items: [ladderId] } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: ladderOut, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: MON, p_half: "AM", p_time: "07:30" })).toBe("ok:booked");
    const after = await chipsOf(live!.workOrderId);
    const ladderBack = chip(after, `return:${ladderOut}`)!;
    expect(ladderBack.status).toBe("tray");
    expect(ladderBack.due_date).toBe(FRI);
    expect(await rpcAs(staff!, "movement_place", { p_id: ladderBack.id, p_assignee_kind: "person", p_assignee_id: staffProfileId, p_due_date: FRI, p_half: "PM", p_time: "15:30" })).toBe("ok:booked");
    // The stranded sprayer's return: the painter brings it back Monday.
    const sprayerBack = (await chipsOf(closed!.workOrderId)).find((r) => r.kind === "equipment_return")!;
    expect(await rpcAs(staff!, "movement_place", { p_id: sprayerBack.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "AM" })).toBe("ok:booked");

    // Order every order on the Day view's Orders card.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/movements?view=day&day=${TUE}&who=${contractorId}`);
    await expect(page.getByTestId("day-view")).toBeVisible({ timeout: 30_000 });
    const orders = page.getByTestId("order-row");
    await expect(orders).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("order-row").first().getByRole("button", { name: /Ordered ✓/ }).click();
      await expect(page.locator(".toast.show")).toContainText(/Ordered/);
      await expect(page.getByTestId("order-row")).toHaveCount(1 - i, { timeout: 15_000 });
    }
    await expect.poll(async () => (await chipsOf(live!.workOrderId)).filter((r) => r.ordered_at).length, { timeout: 15_000 }).toBe(2);
    // §8.5: the painter's pickup text is drafted (a pending hold), not sent.
    const holdsNow = async () => ((await db!.from("automation_holds").select("status, automation_key").eq("contractor_id", contractorId).in("automation_key", ["movement_pickup_ready", "movement_delivery_booked"]).order("created_at", { ascending: false }).limit(2)).data ?? []) as { status: string }[];
    await expect.poll(async () => (await holdsNow()).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    expect((await holdsNow()).every((h) => h.status === "pending")).toBe(true);
    // §8.6: the two gates are open now.
    const { data: items } = await db!.from("wo_checklist_items").select("id, item_key, label").eq("work_order_id", live!.workOrderId).eq("phase", "pre_start");
    const materials = ((items ?? []) as { id: string; item_key: string | null; label: string }[]).find((i) => i.item_key === "materials" || i.label === "Materials ordered")!;
    const colours = ((items ?? []) as { id: string; item_key: string | null; label: string }[]).find((i) => i.item_key === "colours")!;
    expect(await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: colours.id, p_answer: "yes", p_note: "" })).toBe("ok:yes");
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true })).toBe("ok:done");
    // The week is planned: nothing of the live job in the tray.
    await openWeek(page);
    await expect(page.getByTestId("movements-headline")).toContainText(/is planned|still in the tray/);
    expect((await chipsOf(live!.workOrderId)).filter((r) => r.status === "tray")).toEqual([]);
  });

  test("run the week: the painter ticks, the PC ticks, every item is back at the warehouse (§8.7), the invoice finds its order", async ({ page }) => {
    // Monday: the painter brings the sprayer back (portal card), the PC takes the ladder out.
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal?day=${MON}`);
    const card = page.getByTestId("movements-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByTestId("movements-tick").first().click();
    await expect.poll(async () => (await chipsOf(closed!.workOrderId)).find((r) => r.kind === "equipment_return")?.status, { timeout: 15_000 }).toBe("done");
    const ladderOut = (await chipsOf(live!.workOrderId)).find((r) => r.kind === "equipment_out")!;
    expect(await rpcAs(staff!, "movement_set_status", { p_id: ladderOut.id, p_status: "done" })).toBe("ok:done");
    // Tuesday: the painter picks up the materials (portal), the paint arrives (PC ticks Done).
    await page.goto(`/portal?day=${TUE}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const pickup = card.getByTestId("movements-card-line").filter({ hasText: LINE });
    await expect(pickup).toContainText(`${BRAND} Delivers`);
    await pickup.getByTestId("movements-tick").click();
    const line = (await chipsOf(live!.workOrderId)).find((r) => String(r.source_key).startsWith("matline:"))!;
    await expect.poll(async () => (await chipsOf(live!.workOrderId)).find((r) => r.id === line.id)?.status, { timeout: 15_000 }).toBe("done");
    const paint = chip(await chipsOf(live!.workOrderId), `paint:${BRAND}`)!;
    expect(await rpcAs(staff!, "movement_set_status", { p_id: paint.id, p_status: "done" })).toBe("ok:done");
    // Friday: the ladder comes back; the rubbish goes to the warehouse with the painter.
    const rows = await chipsOf(live!.workOrderId);
    for (const r of rows.filter((x) => x.status === "booked")) expect(await rpcAs(staff!, "movement_set_status", { p_id: r.id, p_status: "done" })).toBe("ok:done");
    // §8.7: both items read Warehouse on the Gear view.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/movements?view=gear");
    for (const id of [ladderId, sprayerId]) await expect(page.locator(`[data-testid="gear-card"][data-item-id="${id}"]`)).toHaveAttribute("data-state", "warehouse", { timeout: 30_000 });
    // The supplier's invoice carrying the order reference lands on its movement.
    const { data: mc, error } = await db!.from("material_costs").insert({ work_order_id: live!.workOrderId, supplier: BRAND, brand: BRAND, order_ref: String(paint.order_ref), amount_cents: 48400, source: "manual", matched_by: "manual", matched_at: new Date().toISOString() }).select("movement_id").single();
    expect(error).toBeNull();
    expect((mc as { movement_id: string | null }).movement_id).toBe(paint.id);
    // §8.9 / §8.11: the customer sees none of it.
    const { accessTokenFor } = await import("./fixtures/woLoop");
    const token = await accessTokenFor(customer!);
    const body = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/movements?work_order_id=eq.${live!.workOrderId}&select=id`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    expect(body).toEqual([]);
  });

  test("the rollback switch hides the tab and its routes; on again brings them back", async ({ page }) => {
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").single();
    const value = (s as { value: Record<string, unknown> }).value;
    await db!.from("settings").update({ value: { ...value, movementsTab: false } }).eq("key", "movements");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    await expect(page.locator("nav.nav a", { hasText: "Movements" })).toHaveCount(0);
    // The route answers with a server redirect; the navigation it interrupts reports ERR_ABORTED.
    await page.goto("/pc/movements", { waitUntil: "commit" }).catch(() => undefined);
    await expect(page).toHaveURL(/\/pc$/, { timeout: 20_000 });
    await db!.from("settings").update({ value: { ...value, movementsTab: true } }).eq("key", "movements");
    // The settings screen revalidates the /pc layout when it saves; a direct DB write (this test) does not, so bust the route cache.
    await page.goto(`/pc?r=${Date.now()}`);
    await expect(page.locator("nav.nav a", { hasText: "Movements" })).toHaveCount(1, { timeout: 20_000 });
  });
});

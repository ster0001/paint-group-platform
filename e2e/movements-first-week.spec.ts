import { expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Tom's first-week asks (21 Oct 2026), migration 20270287.
 *
 *   1. a materials line is ONE order chip however many commas it carries, up to 500 chars;
 *   2. the gear box on the job page turns words into a gear chip (no register items), and
 *      booking it makes the return chip like any gear chip;
 *   3. no shop is assumed for a materials line: the Supplier lane refuses it (no_shop) until
 *      the office confirms the shop and delivery / pickup in the chip — delivery lands it on
 *      the Supplier lane on the job's first day, pickup leaves it for a person;
 *   4. one paint chip per brand per job: a product with a blank brand takes the brand its
 *      name starts with, so two products of one brand are one order;
 *   6. a site check-in with no day sits in the tray and is booked by dropping it on a staff
 *      lane — the row gets that day and hour.
 *   (5, the editable litres, is the existing Materials card / chip sheet / builder path.)
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `E2E Dulux ${RUN}`;
const PRODUCT_A = `${BRAND} Weathershield`;
const PRODUCT_B = `${BRAND} Aquanamel`; // inserted with a BLANK brand — the trigger infers it from the name
const LINE = `E2E gap filler, interior filler, brushes, rollers ${RUN}`;
const GEAR = `E2E extension ladder, drop sheets ${RUN}`;

type Row = Record<string, unknown>;
let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
const productIds: string[] = [];
const branch = { delivering: "", counter: "" };
let visitId = "";
let settingsBefore: unknown = undefined;
let settingsExisted = false;

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function targetMonday(): string {
  const today = melbourne.format(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(addDays(today, ((8 - dow) % 7) || 7), 14); // three weeks out: clear of the other movements specs
}
const MON = targetMonday();
const WED = addDays(MON, 2);

async function chips(): Promise<Row[]> {
  const { data, error } = await db!.from("movements").select("id, kind, source_key, title, status, from_branch_id, method_pref, due_date, half, time, assignee_kind, assignee_id, lines").eq("work_order_id", job!.workOrderId).order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };
async function centre(el: Locator) { await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); if (!b) throw new Error("no box"); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function dragTo(page: Page, from: Locator, to: Locator, steps = 10) {
  await from.scrollIntoViewIfNeeded(); await to.scrollIntoViewIfNeeded();
  const a = await centre(from); const b = await centre(to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
}
async function openWeek(page: Page) {
  await page.goto(`/pc/movements?view=week&week=${MON}`);
  await expect(page.getByTestId("movements-board")).toBeVisible({ timeout: 30_000 });
}
const laneOf = (page: Page, id: string) => page.locator(`[data-testid="lane"][data-lane="${id}"]`);
const slotIn = (lane: Locator, day: string, slot: string) => lane.locator(`.bgc[data-day="${day}"] .slot[data-slot="${slot}"]`);
const trayChip = (page: Page, id: string) => page.locator(`[data-testid="tray-chip"][data-movement-id="${id}"]`);

test.describe.configure({ mode: "serial" });

test.describe("Movements first-week asks", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId).toBeTruthy();
    for (const [name, brand] of [[PRODUCT_A, BRAND], [PRODUCT_B, ""]]) {
      const { data, error } = await db!.from("products").insert({ name, brand, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
      if (error) throw new Error(`product: ${error.message}`);
      productIds.push((data as { id: string }).id);
    }
    for (const b of [{ key: "delivering", branch: "Delivers", delivers: true, lat: -37.92 }, { key: "counter", branch: "Counter only", delivers: false, lat: -37.89 }] as const) {
      const { data, error } = await db!.from("supplier_branches").insert({
        brand: BRAND, branch: b.branch, kind: "paint", suburb: "Oakleigh South", address: "1 Paint Rd", postcode: "3167", lat: b.lat, lng: 145.1, delivers_to_site: b.delivers, opens_weekday: "06:30", active: true,
      }).select("id").single();
      if (error) throw new Error(`branch: ${error.message}`);
      branch[b.key] = (data as { id: string }).id;
    }
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const people = Array.isArray(base.boardPeople) ? (base.boardPeople as Row[]).filter((p) => p.id !== staffProfileId) : [];
    const { error: sErr } = await db!.from("settings").upsert({ key: "movements", value: { ...base, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }] } }, { onConflict: "key" });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { error: eErr } = await db!.from("estimates").update({ builder_state: { internalMaterials: [LINE] } }).eq("id", job.estimateId);
    if (eErr) throw new Error(`estimate: ${eErr.message}`);
    const materials = [
      { product: PRODUCT_A, colourKey: `${PRODUCT_A}||Lexicon`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" },
      { product: PRODUCT_B, colourKey: `${PRODUCT_B}||Vivid`, photoUrl: "", litres: 4, coverageMissing: false, colourName: "Vivid White", colourHex: "#FFFFFF", colourStatus: "confirmed" },
    ];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E First week ${RUN}` };
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: MON, end_date: WED,
      colours: { [PRODUCT_A]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" }, [PRODUCT_B]: { status: "confirmed", name: "Vivid White", hex: "#FFFFFF" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(uErr.message);
    const { data: v, error: vErr } = await db!.from("wo_site_visits").insert({ work_order_id: job.workOrderId }).select("id").single();
    if (vErr) throw new Error(`visit: ${vErr.message}`);
    visitId = (v as { id: string }).id;
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    for (const id of Object.values(branch).filter(Boolean)) await db!.from("supplier_branches").delete().eq("id", id);
    await db!.from("vendors").delete().eq("name", BRAND);
    if (productIds.length) await db!.from("products").delete().in("id", productIds);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  test("4: a blank-brand product takes the brand its name starts with — one paint chip for the job", async () => {
    const { data: p } = await db!.from("products").select("brand").eq("id", productIds[1]).single();
    expect((p as { brand: string }).brand, "the trigger filled the brand").toBe(BRAND);
    const paint = (await chips()).filter((r) => r.kind === "paint");
    expect(paint.length, "one paint order for the brand").toBe(1);
    expect(paint[0].source_key).toBe(`paint:${BRAND}`);
    // The lines freeze onto the chip at ordering; before that the chip reads the Materials card live.
  });

  test("1: a comma-separated line is one chip; 500 characters fit; no shop is assumed", async () => {
    const rows = await chips();
    const lines = rows.filter((r) => String(r.source_key).startsWith("matline:"));
    expect(lines.length).toBe(1);
    expect(lines[0].title).toContain("gap filler, interior filler, brushes, rollers");
    expect(lines[0].from_branch_id, "no Bunnings default").toBeNull();
    const long = `E2E long ${RUN} ` + "sandpaper 120, ".repeat(30);
    expect(long.length).toBeGreaterThan(200);
    const id = okId(await rpcAs(staff!, "material_line_add", { p_work_order_id: job!.workOrderId, p_text: long }));
    const { data: l } = await db!.from("wo_material_lines").select("text").eq("id", id).single();
    expect((l as { text: string }).text.length).toBe(long.trim().length);
    expect(await rpcAs(staff!, "material_line_remove", { p_id: id })).toMatch(/^ok/);
  });

  test("3: the Supplier lane refuses a shop-less order; confirm pickup, or delivery with a shop that delivers", async () => {
    const line = (await chips()).find((r) => String(r.source_key).startsWith("matline:"))!;
    expect(await rpcAs(staff!, "movement_place", { p_id: line.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: MON, p_half: "AM" })).toBe("error:no_shop");
    expect(await rpcAs(staff!, "movement_set_method", { p_id: line.id, p_method: "delivery" })).toBe("ok:pickshop");
    expect(await rpcAs(staff!, "movement_set_method", { p_id: line.id, p_method: "delivery", p_branch_id: branch.counter })).toBe("ok:nodelivery");
    expect(await rpcAs(staff!, "movement_set_method", { p_id: line.id, p_method: "pickup" })).toBe("ok:pickup");
    let after = (await chips()).find((r) => r.id === line.id)!;
    expect(after.method_pref).toBe("pickup");
    expect(after.status).toBe("tray");
    expect(await rpcAs(staff!, "movement_set_method", { p_id: line.id, p_method: "delivery", p_branch_id: branch.delivering })).toBe("ok:placed");
    after = (await chips()).find((r) => r.id === line.id)!;
    expect(after.method_pref).toBe("delivery");
    expect(after.assignee_kind).toBe("supplier");
    expect(after.due_date).toBe(MON);
    expect(after.from_branch_id).toBe(branch.delivering);
    expect(await rpcAs(staff!, "movement_unplace", { p_id: line.id })).toMatch(/^ok/);
  });

  test("2: words in the gear box are a gear chip; booking it makes the return", async () => {
    expect(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_return", work_order_id: job!.workOrderId, title: "x" } }), "a return still needs items").toBe("error:no_items");
    const out = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, title: GEAR } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: out, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "AM" })).toBe("ok:booked");
    const ret = (await chips()).find((r) => r.source_key === `return:${out}`);
    expect(ret, "the return chip").toBeTruthy();
  });

  test("in the browser: the job page gear box, the chip's shop + method, and a check-in dropped on a staff hour", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    // The gear box on the job page.
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const gear = page.getByTestId("prestart-equipment");
    await expect(gear).toBeVisible({ timeout: 30_000 });
    await gear.getByTestId("prestart-gear-input").fill(`E2E sprayer, hose ${RUN}`);
    await gear.getByTestId("prestart-gear-input").press("Enter");
    await expect(gear.getByTestId("prestart-equipment-msg")).toContainText(/Gear chip added/);
    expect((await chips()).some((r) => r.kind === "equipment_out" && String(r.title).includes("sprayer, hose")), "the typed gear is a chip").toBe(true);

    // The materials chip: confirm the shop, then Delivered to site → Supplier lane.
    await openWeek(page);
    const line = (await chips()).find((r) => String(r.source_key).startsWith("matline:"))!;
    const tray = trayChip(page, String(line.id));
    await expect(tray).toBeVisible();
    await tray.click();
    const sheet = page.getByTestId("chip-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("chip-method")).toContainText(/How does it move/);
    await sheet.getByTestId("shop-option").filter({ hasText: `${BRAND} Delivers` }).click();
    await sheet.getByTestId("method-delivery").click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(`[data-testid="movement-card"][data-movement-id="${line.id}"]`)).toBeVisible({ timeout: 15_000 });
    expect((await chips()).find((r) => r.id === line.id)!.assignee_kind).toBe("supplier");

    // The unscheduled check-in: in the tray, dropped on the staff lane at 10:30.
    const checkin = page.locator(`[data-testid="tray-checkin"][data-visit-id="${visitId}"]`);
    await expect(checkin).toBeVisible();
    await dragTo(page, checkin, slotIn(laneOf(page, staffProfileId), MON, "10:30"));
    await expect(page.locator(".toast.show")).toContainText(/Check-in booked/);
    await expect(checkin).toHaveCount(0, { timeout: 15_000 });
    const { data: v } = await db!.from("wo_site_visits").select("scheduled_for, scheduled_time").eq("id", visitId).single();
    expect((v as { scheduled_for: string }).scheduled_for).toBe(MON);
    expect(String((v as { scheduled_time: string }).scheduled_time)).toMatch(/^10:30/);
  });
});

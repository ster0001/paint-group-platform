import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 6, the Map part (brief §3.4 Map, rulings 13, 21, 22; flags 3, 7).
 *
 *   As the PC in the browser, on Google Maps:
 *     1. the painter's Monday: one icon per job; the job's real point (work_orders.lat/lng,
 *        flag 3) is used, the pickup carries "1" at the SHOP and the drop-off "2" at the job;
 *        dragging the handle of row 2 above row 1 in the order card reorders the day — the
 *        numbers on the map and the rows change together, the Day view shows the same order,
 *        and the database holds the same two times in the new order (ruling 22);
 *     2. the job is amber while its last need is the rubbish question; tapping the pin opens
 *        that chip, answering it turns the icon teal within one render.
 *
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY in the app's build (the Map tab does not exist
 * without it) — the spec skips, loudly, when the key is absent from the test env.
 * The service key builds and tears down the fixture; every assertion about what a person
 * sees is made through that person's own session in the browser.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `E2E Wattyl ${RUN}`;
const PRODUCT = `E2E Solagard ${RUN}`;

type Row = Record<string, unknown>;

let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
let productId = "";
let branchId = "";
let dropoffId = "";
let settingsBefore: unknown = undefined;
let settingsExisted = false;

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const todayMelb = () => melbourne.format(new Date());
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday three weeks out — past the Day spec's week, so no other spec's data sits on it. */
function targetMonday(): string {
  const today = todayMelb();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nextMonday = addDays(today, ((8 - dow) % 7) || 7);
  return addDays(nextMonday, 14);
}
const MON = targetMonday();
const WED = addDays(MON, 2);
// The job's real point (a house in Oakleigh South) and the shop's (Carnegie): two distinct pins.
const JOB_POINT = { lat: -37.9187, lng: 145.0932 };
const SHOP_POINT = { lat: -37.8895, lng: 145.0581 };

async function chipsOf(workOrderId: string): Promise<Row[]> {
  const { data, error } = await db!.from("movements")
    .select("id, kind, source_key, title, status, from_branch_id, ordered_at, due_date, half, time, sequence, assignee_kind, assignee_id, detail")
    .eq("work_order_id", workOrderId).order("created_at");
  expect(error, "reading the fixture's movements").toBeNull();
  return (data ?? []) as Row[];
}
const chip = (rows: Row[], key: string) => rows.find((r) => r.source_key === key);

test.describe.configure({ mode: "serial" });

test.describe("Movements Map (Session 6)", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.skip(!MAPS_KEY, "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not in the test env — the Map tab does not exist without it (build plan step 3)");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId, "the E2E contractor and staff logins exist").toBeTruthy();

    const { data: pr, error: pErr } = await db!.from("products").insert({ name: PRODUCT, brand: BRAND, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
    if (pErr) throw new Error(`product: ${pErr.message}`);
    productId = (pr as { id: string }).id;
    const { data: b, error: bErr } = await db!.from("supplier_branches").insert({
      brand: BRAND, branch: "Carnegie", kind: "paint", suburb: "Carnegie", address: "2 Koornang Rd", postcode: "3163", lat: SHOP_POINT.lat, lng: SHOP_POINT.lng,
      delivers_to_site: false, opens_weekday: "06:30", phone: "(03) 9000 0000", active: true,
    }).select("id").single();
    if (bErr) throw new Error(`branch: ${bErr.message}`);
    branchId = (b as { id: string }).id;

    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const { error: sErr } = await db!.from("settings").upsert({
      key: "movements", value: { ...base, warehouse: { label: "Warehouse", address: "25-27 Bunney Rd", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1 } },
    }, { onConflict: "key" });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const materials = [{ product: PRODUCT, colourKey: `${PRODUCT}||Monument`, photoUrl: "", litres: 8, coverageMissing: false, colourName: "Monument", colourHex: "#333333", colourStatus: "confirmed" }];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: `${RUN} Map St, Oakleigh South VIC 3167`, jobTitle: `E2E Movements Map ${RUN}` };
    // Flag 3: the job carries its real point (as the lazy geocode would have written through wo_set_point).
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: MON, end_date: WED, lat: JOB_POINT.lat, lng: JOB_POINT.lng, point_checked_at: new Date().toISOString(),
      colours: { [PRODUCT]: { status: "confirmed", name: "Monument", hex: "#333333" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(`fixture update (needs migration 20270283 for lat/lng): ${uErr.message}`);

    // Two stops on the painter's Monday: the paint pickup at the shop (07:00, ordered — so it is not a need) and a drop sheets drop-off at the job (13:00).
    const rows = await chipsOf(job.workOrderId);
    const paint = chip(rows, `paint:${BRAND}`)!;
    expect(paint, "paint chip from the sync").toBeTruthy();
    expect(await rpcAs(staff!, "movement_update", { p_id: paint.id, p: { from_branch_id: branchId } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "AM", p_time: "07:00" })).toBe("ok:planned");
    expect(await rpcAs(staff!, "movement_mark_ordered", { p_id: paint.id })).toMatch(/^ok/);
    const made = await rpcAs(staff!, "movement_create", { p: { kind: "other", work_order_id: job.workOrderId, title: `E2E drop sheets ${RUN}`, from: { kind: "warehouse" }, to: { kind: "site" } } });
    expect(made, "manual chip").toMatch(/^ok:/);
    dropoffId = made.replace(/^ok:/, "");
    expect(await rpcAs(staff!, "movement_place", { p_id: dropoffId, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "PM", p_time: "13:00" })).toBe("ok:booked");
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    if (branchId) { const r = await db!.from("supplier_branches").delete().eq("id", branchId); expect(r.error?.message ?? "", "branch cleanup").toBe(""); }
    await db!.from("vendors").delete().eq("name", BRAND);
    if (productId) await db!.from("products").delete().eq("id", productId);
    if (contractorId) await db!.from("automation_holds").delete().eq("contractor_id", contractorId).in("automation_key", ["movement_pickup_ready", "movement_run_plan"]);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  const openMap = async (page: Page) => {
    await page.goto(`/pc/movements?view=map&day=${MON}&who=${contractorId}`);
    await expect(page.getByTestId("map-view")).toBeVisible({ timeout: 30_000 });
    // The pins exist once Google Maps has drawn the overlay pane.
    await expect(page.getByTestId("map-box")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("map-pins")).toBeAttached({ timeout: 15_000 });
  };
  const jobPin = (page: Page) => page.locator(`[data-testid="map-job"][data-job-id="${job!.workOrderId}"]`);
  const shopPin = (page: Page) => page.locator(`[data-testid="map-shop"][data-branch-id="${branchId}"]`);
  const row = (page: Page, id: string) => page.locator(`[data-testid="order-row"][data-movement-id="${id}"]`);

  test("the map: real point, the shop numbered 1 and the job 2; drag row 2 above row 1 → the map, the card and Day all follow (ruling 22)", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMap(page);
    await expect(page.getByTestId("tab-map")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("order-summary")).toContainText("2 stops");
    const rows = await chipsOf(job!.workOrderId);
    const paintId = String(chip(rows, `paint:${BRAND}`)!.id);

    // One icon per job, drawn at its real point (flag 3), amber because the rubbish question is still in the tray.
    const pin = jobPin(page);
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveAttribute("data-point", "exact");
    await expect(pin).toHaveAttribute("data-fill", "amber");
    await expect(pin).toHaveAttribute("data-need", "rubbish");
    await expect(pin).toContainText(`${RUN} Map St`);
    await expect(pin).toContainText("rubbish to plan");
    // The shop is a stop today: drawn solid with "1"; the job carries "2".
    await expect(shopPin(page)).toHaveAttribute("data-stop", "true");
    await expect(shopPin(page).getByTestId("map-badge")).toHaveText("1");
    await expect(pin.getByTestId("map-badge")).toHaveText("2");
    // The order card agrees.
    await expect(row(page, paintId).getByTestId("order-n")).toHaveText("1");
    await expect(row(page, dropoffId).getByTestId("order-n")).toHaveText("2");
    await expect(row(page, paintId)).toContainText(`${BRAND} Carnegie → ${RUN} Map St`);

    // Drag the drop-off's handle above the pickup (pointer events: down, move past the threshold, over the top half of row 1, up).
    const handle = row(page, dropoffId).getByTestId("order-handle");
    const target = await row(page, paintId).boundingBox();
    const from = await handle.boundingBox();
    expect(target && from, "rows have boxes").toBeTruthy();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + from!.width / 2, from!.y - 20, { steps: 4 });
    await page.mouse.move(target!.x + target!.width / 2, target!.y + 4, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".toast.show")).toContainText(/Order updated/);

    // The numbers on the map and in the card changed together: the job is now 1, the shop 2.
    await expect(jobPin(page).getByTestId("map-badge")).toHaveText("1", { timeout: 15_000 });
    await expect(shopPin(page).getByTestId("map-badge")).toHaveText("2");
    await expect(row(page, dropoffId).getByTestId("order-n")).toHaveText("1");
    await expect(row(page, paintId).getByTestId("order-n")).toHaveText("2");
    // Ruling 22: the same two times, handed out in the new order.
    const after = await chipsOf(job!.workOrderId);
    expect([after.find((r) => r.id === dropoffId)!.sequence, after.find((r) => r.id === dropoffId)!.time]).toEqual([1, "07:00:00"]);
    expect([chip(after, `paint:${BRAND}`)!.sequence, chip(after, `paint:${BRAND}`)!.time]).toEqual([2, "13:00:00"]);

    // Run plan → the Day view, same person, same day, same order.
    await page.getByTestId("open-run-plan").click();
    await expect(page.getByTestId("day-view")).toBeVisible({ timeout: 30_000 });
    const stops = page.locator('[data-testid="run-stop"][data-movement-id]');
    await expect(stops.nth(0)).toHaveAttribute("data-movement-id", dropoffId);
    await expect(stops.nth(0).getByTestId("run-stop-n")).toHaveText("1");
    await expect(stops.nth(1)).toHaveAttribute("data-movement-id", paintId);
  });

  test("the icon: tapping the amber pin opens its last need (the rubbish question); answering it turns the job teal", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMap(page);
    const pin = jobPin(page);
    await expect(pin).toHaveAttribute("data-fill", "amber");
    await pin.getByRole("button").click();
    const sheet = page.getByTestId("chip-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Rubbish — how?");
    await sheet.getByRole("button", { name: "Painter disposed" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    // Clearing the job's last need: the icon turns teal, the line says on track, no need icon.
    await expect(jobPin(page)).toHaveAttribute("data-fill", "teal", { timeout: 15_000 });
    await expect(jobPin(page)).toHaveAttribute("data-need", "");
    await expect(jobPin(page)).toContainText("on track");
    const rubbish = chip(await chipsOf(job!.workOrderId), "rubbish")!;
    expect(rubbish.detail).toBe("painter disposes of it");
    // Shops toggle: off by default shows only today's stop; on shows every shop with a point — this one stays, and is named.
    await expect(page.locator('[data-testid="map-shop"][data-stop="false"]')).toHaveCount(0);
    await page.getByTestId("toggle-shops").click();
    await expect(shopPin(page)).toContainText(`${BRAND} Carnegie`);
    // Route line: off by default, a toggle; the pins are untouched by it.
    await expect(page.getByTestId("toggle-route")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("toggle-route").click();
    await expect(page.getByTestId("toggle-route")).toHaveAttribute("aria-pressed", "true");
    await expect(jobPin(page)).toHaveCount(1);
  });
});

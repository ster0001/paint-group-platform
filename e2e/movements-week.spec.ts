import { expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 4 of the build plan: the Week board and Sources, driven THROUGH THE
 * SCREEN as the PC (staff). The mockup's interactions, encoded (brief §3.4, build plan
 * Session 4 prompt):
 *
 *   1. drag the Taubmans chip onto Felipe's lane, Mon 10:30 → a movement with time 10:30
 *   2. a paint chip whose shop does not deliver is refused by the Supplier lane, with the
 *      toast; with a delivering shop it lands, Ordered ✓ sets ordered_at and drafts the
 *      painter's text (the movement_ordered event names the alert — nothing is sent)
 *   3. add a materials line on the Sources view's estimate card → a chip in the tray
 *   4. "Painter drops at warehouse" on the rubbish chip → a movement on the painter's last day
 *
 * The service key builds the fixture (a job with two paint brands, three branches, the
 * staff login as an hourly person in Settings → boardPeople) and tears it down; every
 * assertion about what the office sees is made through the staff session in the browser.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND_T = `E2E Taubmans ${RUN}`;
const BRAND_D = `E2E Dulux ${RUN}`;
const PRODUCT_T = `E2E Endure ${RUN}`;
const PRODUCT_D = `E2E Weathershield ${RUN}`;
const LINE_TEXT = `E2E caulk × 6 ${RUN}`;

type Row = Record<string, unknown>;

let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
const productIds: string[] = [];
const branch = { delivering: "", noDelivery: "", taubmans: "" };
let settingsBefore: unknown = undefined;
let settingsExisted = false;

// Calendar days in Melbourne, never the UTC date (CLAUDE.md, Dates).
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const todayMelb = () => melbourne.format(new Date());
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week after next — far enough out that no other spec's data sits on it. */
function targetMonday(): string {
  const today = todayMelb();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sun
  const nextMonday = addDays(today, ((8 - dow) % 7) || 7);
  return addDays(nextMonday, 7);
}
const MON = targetMonday();
const WED = addDays(MON, 2);

async function chipsOf(workOrderId: string): Promise<Row[]> {
  const { data, error } = await db!.from("movements")
    .select("id, kind, source_key, title, status, from_branch_id, ordered_at, due_date, half, time, assignee_kind, assignee_id, to_kind")
    .eq("work_order_id", workOrderId).order("created_at");
  expect(error, "reading the fixture's movements").toBeNull();
  return (data ?? []) as Row[];
}
const chip = (rows: Row[], key: string) => rows.find((r) => r.source_key === key);

async function centre(el: Locator) {
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Several small moves: one jump can be read as a click rather than a drag (the engine's 5 px threshold). */
async function dragTo(page: Page, from: Locator, to: Locator, steps = 10) {
  // Both in view FIRST, then measure: scrolling the target into view after measuring the
  // source left the mouse-down a page-scroll away from the chip.
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
}

async function openWeek(page: Page) {
  await page.goto(`/pc/movements?view=week&week=${MON}`);
  await expect(page.getByTestId("movements-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("lane").first()).toBeVisible();
}

const laneOf = (page: Page, id: string) => page.locator(`[data-testid="lane"][data-lane="${id}"]`);
const slotIn = (lane: Locator, day: string, slot: string) => lane.locator(`.bgc[data-day="${day}"] .slot[data-slot="${slot}"]`);
const trayChip = (page: Page, id: string) => page.locator(`[data-testid="tray-chip"][data-movement-id="${id}"]`);
const card = (page: Page, id: string) => page.locator(`[data-testid="movement-card"][data-movement-id="${id}"]`);

test.describe.configure({ mode: "serial" });

test.describe("Movements week board, as the PC", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId, "the E2E contractor and staff logins exist").toBeTruthy();

    for (const [name, brand] of [[PRODUCT_T, BRAND_T], [PRODUCT_D, BRAND_D]]) {
      const { data, error } = await db!.from("products").insert({ name, brand, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
      if (error) throw new Error(`product: ${error.message}`);
      productIds.push((data as { id: string }).id);
    }
    // Three branches: Dulux delivers (nearest to the job, so the sync picks it), Dulux counter
    // only (does not deliver — the refusal), Taubmans counter only (pickup by hand).
    const branches = [
      { key: "delivering", brand: BRAND_D, branch: "Delivers", suburb: "Oakleigh South", lat: -37.92, lng: 145.1, delivers_to_site: true, address: "1 Paint Rd" },
      { key: "noDelivery", brand: BRAND_D, branch: "Counter only", suburb: "Carnegie", lat: -37.89, lng: 145.06, delivers_to_site: false, address: "2 Counter St" },
      { key: "taubmans", brand: BRAND_T, branch: "Trade", suburb: "Oakleigh South", lat: -37.9, lng: 145.09, delivers_to_site: false, address: "31 Connell Rd" },
    ] as const;
    for (const b of branches) {
      const { data, error } = await db!.from("supplier_branches").insert({
        brand: b.brand, branch: b.branch, kind: "paint", suburb: b.suburb, address: b.address, postcode: "3167", lat: b.lat, lng: b.lng, delivers_to_site: b.delivers_to_site, opens_weekday: "06:30", active: true,
      }).select("id").single();
      if (error) throw new Error(`branch: ${error.message}`);
      branch[b.key] = (data as { id: string }).id;
    }

    // The staff login is an HOURLY person on the board (ruling 16) — Settings → boardPeople.
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const people = Array.isArray(base.boardPeople) ? (base.boardPeople as Row[]).filter((p) => p.id !== staffProfileId) : [];
    const { error: sErr } = await db!.from("settings").upsert({
      key: "movements", value: { ...base, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }], showHowItWorks: true },
    }, { onConflict: "key" });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const materials = [
      { product: PRODUCT_T, colourKey: `${PRODUCT_T}||Monument`, photoUrl: "", litres: 8, coverageMissing: false, colourName: "Monument", colourHex: "#333333", colourStatus: "confirmed" },
      { product: PRODUCT_D, colourKey: `${PRODUCT_D}||Lexicon`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" },
    ];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E Movements ${RUN}` };
    // The Materials-card hook: this update fires movements_sync_for_wo → paint chips + the rubbish question.
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: MON, end_date: WED,
      colours: { [PRODUCT_T]: { status: "confirmed", name: "Monument", hex: "#333333" }, [PRODUCT_D]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(`fixture update: ${uErr.message}`);
    const rows = await chipsOf(job.workOrderId);
    expect(chip(rows, `paint:${BRAND_T}`), "Taubmans chip from the sync").toBeTruthy();
    expect(chip(rows, `paint:${BRAND_D}`), "Dulux chip from the sync").toBeTruthy();
    expect(chip(rows, "rubbish"), "rubbish question from the sync").toBeTruthy();
  });

  test.afterAll(async () => {
    // Movements, items, lines and decisions cascade from the work order; the work order from the estimate.
    await destroyLoopFixture(db!, job);
    for (const id of Object.values(branch).filter(Boolean)) {
      const r = await db!.from("supplier_branches").delete().eq("id", id);
      expect(r.error?.message ?? "", "branch cleanup").toBe("");
    }
    await db!.from("vendors").delete().in("name", [BRAND_T, BRAND_D]);
    if (productIds.length) await db!.from("products").delete().in("id", productIds);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  test("the tab, the headline and the strip; the Taubmans chip dropped on Felipe Mon 10:30 gets that time", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openWeek(page);
    await expect(page.locator("nav.nav a.on")).toHaveText("Movements");
    await expect(page.getByTestId("movements-headline")).toContainText("still in the tray");
    await expect(page.getByTestId("how-it-works")).toHaveAttribute("open", "");

    const rows = await chipsOf(job!.workOrderId);
    const taubmans = chip(rows, `paint:${BRAND_T}`)!;
    const tray = trayChip(page, String(taubmans.id));
    await expect(tray).toBeVisible();
    await expect(tray).toContainText(BRAND_T);

    const felipe = laneOf(page, staffProfileId);
    await expect(felipe).toBeVisible();
    await expect(felipe.locator(".bgc").first().locator(".slot")).toHaveCount(10);
    await expect(page.locator(`.cinfo:has-text("1-hour slots")`).first()).toBeVisible();

    await dragTo(page, tray, slotIn(felipe, MON, "10:30"));
    const placed = card(page, String(taubmans.id));
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect(placed).toHaveAttribute("data-time", "10:30");
    await expect(placed).toContainText("Paint pickup");
    await expect(slotIn(felipe, MON, "10:30").locator(`[data-movement-id="${taubmans.id}"]`)).toHaveCount(1);
    const after = chip(await chipsOf(job!.workOrderId), `paint:${BRAND_T}`)!;
    expect(String(after.time)).toMatch(/^10:30/);
    expect(after.due_date).toBe(MON);
    expect(after.assignee_id).toBe(staffProfileId);
  });

  test("the Supplier lane refuses a non-delivering shop with the toast; a delivering one lands, and Ordered ✓ drafts the painter's text", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openWeek(page);
    const rows = await chipsOf(job!.workOrderId);
    const dulux = chip(rows, `paint:${BRAND_D}`)!;
    expect(dulux.from_branch_id, "the sync picked the delivering branch").toBe(branch.delivering);

    // Pick the counter-only shop in the chip sheet (nearest first), save, then drop on Supplier.
    await trayChip(page, String(dulux.id)).click();
    const sheet = page.getByTestId("chip-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("shop-option").filter({ hasText: `${BRAND_D} Counter only` }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const supplier = laneOf(page, "supplier");
    await dragTo(page, trayChip(page, String(dulux.id)), slotIn(supplier, MON, "am"));
    await expect(page.locator(".toast.show")).toContainText(/does not deliver/i);
    await expect(trayChip(page, String(dulux.id))).toBeVisible();
    expect(chip(await chipsOf(job!.workOrderId), `paint:${BRAND_D}`)!.status).toBe("tray");

    // Back to the delivering shop, and it lands as a delivery that still owes the order step.
    await trayChip(page, String(dulux.id)).click();
    await sheet.getByTestId("shop-option").filter({ hasText: `${BRAND_D} Delivers` }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await dragTo(page, trayChip(page, String(dulux.id)), slotIn(supplier, MON, "am"));
    const placed = card(page, String(dulux.id));
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect(placed).toContainText("Paint delivery");
    await expect(placed).toContainText("Not ordered yet");
    await placed.getByRole("button", { name: "Ordered ✓" }).click();
    await expect(placed).toContainText(/Ordered/);
    await expect(placed.getByRole("button", { name: "Ordered ✓" })).toHaveCount(0);
    await expect(page.locator(".toast.show")).toContainText(/client notice off/i);

    const after = chip(await chipsOf(job!.workOrderId), `paint:${BRAND_D}`)!;
    expect(after.status).toBe("booked");
    expect(after.ordered_at).toBeTruthy();
    // The painter's text is DRAFTED, not sent: the order event names the alert Session 5 will send.
    const { data: events } = await db!.from("wo_events").select("type, meta").eq("work_order_id", job!.workOrderId).eq("type", "movement_ordered");
    const ev = ((events ?? []) as { type: string; meta: Row }[]).find((e) => e.meta.movement_id === dulux.id);
    expect(ev, "movement_ordered event").toBeTruthy();
    expect(ev!.meta.alert).toBe("movement_delivery_booked");
    expect(ev!.meta.client_notice).toBe(false);
    // The Taubmans pickup from the first test (a person picking up from a branch) still owes its order.
    await expect(page.getByTestId("orders-pill")).toContainText("Orders to place · 1");
  });

  test("Sources: a line added on the estimate card is a chip in the tray", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/movements?view=sources&week=${MON}&job=${job!.workOrderId}`);
    const estimate = page.getByTestId("sources-estimate");
    await expect(estimate).toBeVisible({ timeout: 30_000 });
    await estimate.getByPlaceholder(/One order per line/).fill(LINE_TEXT);
    await estimate.getByRole("button", { name: "Add" }).click();
    await expect(estimate.getByTestId("material-line").filter({ hasText: LINE_TEXT })).toBeVisible({ timeout: 15_000 });
    // The same row on the job-page card and as a chip on the tray card.
    await expect(page.getByTestId("sources-prestart").getByTestId("material-line").filter({ hasText: LINE_TEXT })).toBeVisible();
    await expect(page.getByTestId("sources-tray").locator(`[data-testid="tray-chip"]`).filter({ hasText: LINE_TEXT })).toBeVisible();
    const { data: lines } = await db!.from("wo_material_lines").select("id, source").eq("work_order_id", job!.workOrderId).eq("text", LINE_TEXT);
    expect(lines).toHaveLength(1);
    expect((lines![0] as Row).source).toBe("estimate");
    const line = chip(await chipsOf(job!.workOrderId), `matline:${(lines![0] as Row).id}`)!;
    expect(line.status).toBe("tray");

    await openWeek(page);
    await expect(trayChip(page, String(line.id))).toBeVisible();
    await expect(trayChip(page, String(line.id))).toContainText(LINE_TEXT);
  });

  test("the rubbish question: Painter drops at warehouse lands on the painter's last day", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openWeek(page);
    const rubbish = chip(await chipsOf(job!.workOrderId), "rubbish")!;
    const tray = trayChip(page, String(rubbish.id));
    await expect(tray).toContainText("Rubbish — how?");
    await tray.click();
    const sheet = page.getByTestId("chip-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Painter drops at warehouse" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    const placed = card(page, String(rubbish.id));
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect(placed).toContainText("Rubbish to warehouse");
    await expect(laneOf(page, contractorId).locator(`.bgc[data-day="${WED}"] [data-movement-id="${rubbish.id}"]`)).toHaveCount(1);
    const after = chip(await chipsOf(job!.workOrderId), "rubbish")!;
    expect(after.due_date).toBe(WED);
    expect(after.assignee_id).toBe(contractorId);
    expect(after.status).toBe("booked");
    expect(after.to_kind).toBe("warehouse");
  });
});

import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 6 of the build plan, the parts that need no Google key: the Gear
 * view (ruling 18) and Settings → Suppliers / Equipment / Movements (brief §3.4 Settings).
 * The Map view waits for NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY (⚑4) and is not here.
 *
 *   As the PC in the browser:
 *     1. Settings → Equipment: add an item → it has a tag and its type icon; retire it;
 *     2. Settings → Suppliers: add a branch → in the list; set its trade account → shown
 *        masked, and the raw reference is on the accounts table, never in the HTML again;
 *     3. Settings → Movements: Nearby radius + a board person in hours → settings.movements;
 *     4. Gear: an item taken out and ticked done reads On site; the job closing flags it
 *        (clay pill) and Find it in the tray opens its return chip on the Week board.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const ITEM = `E2E platform ladder ${RUN}`;
const BRAND = `E2E Inspirations ${RUN}`;
const ACCOUNT = `ACCT${RUN}7788`;


let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
let settingsBefore: unknown = undefined;
let settingsExisted = false;
let fixtureItemId = "";
let outId = "";
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const TODAY = melbourne.format(new Date());
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };

async function openFolder(page: Page, bucket: string, folderId: string) {
  await page.goto(`/settings#${folderId}`);
  await expect(page.getByTestId(`bucket-${bucket}`)).toBeVisible({ timeout: 30_000 });
  const folder = page.getByTestId(`folder-${folderId}`);
  await expect(folder).toBeVisible();
  return folder;
}

test.describe.configure({ mode: "serial" });

test.describe("Movements Gear + Settings (Session 6)", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId).toBeTruthy();
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s); settingsBefore = s?.value ?? null;
    // Gear fixture: an item taken out to a live job and ticked done.
    fixtureItemId = okId(await rpcAs(staff!, "equipment_item_create", { p_name: `E2E sprayer ${RUN}`, p_category: "spray_gun" }));
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { error } = await db!.from("work_orders").update({ stage: "in_progress", start_date: addDays(TODAY, -2), end_date: addDays(TODAY, 1) }).eq("id", job.workOrderId);
    if (error) throw new Error(error.message);
    outId = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job.workOrderId, items: [fixtureItemId] } }));
    expect(await rpcAs(staff!, "movement_place", { p_id: outId, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: addDays(TODAY, -2), p_half: "AM" })).toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_set_status", { p_id: outId, p_status: "done" })).toBe("ok:done");
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    const { data: made } = await db!.from("equipment_items").select("id").or(`name.eq.${ITEM},id.eq.${fixtureItemId}`);
    for (const r of (made ?? []) as { id: string }[]) await db!.from("equipment_items").delete().eq("id", r.id);
    await db!.from("supplier_branches").delete().eq("brand", BRAND);
    await db!.from("vendors").delete().eq("name", BRAND);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  test("Settings → Equipment: add an item, it gets a tag and its icon; retire it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    const folder = await openFolder(page, "movements", "equipment");
    await folder.getByTestId("eq-name").fill(ITEM);
    await folder.getByTestId("eq-category").selectOption("platform_ladder");
    await folder.getByTestId("eq-add").click();
    await expect(folder.getByTestId("eq-msg")).toContainText(/Added/, { timeout: 15_000 });
    const { data } = await db!.from("equipment_items").select("id, tag, category, status").eq("name", ITEM).single();
    const row = data as { id: string; tag: string; category: string; status: string };
    expect(row.tag).toMatch(/^E-\d{3,}$/);
    expect(row.category).toBe("platform_ladder");
    await expect(folder.getByTestId(`eq-row-${row.tag}`)).toContainText("Platform ladder", { timeout: 15_000 });
    await folder.getByTestId(`eq-status-${row.tag}`).selectOption("retired");
    await expect(folder.getByTestId("eq-msg")).toContainText(/Now retired/, { timeout: 15_000 });
    const { data: after } = await db!.from("equipment_items").select("status").eq("id", row.id).single();
    expect((after as { status: string }).status).toBe("retired");
  });

  test("Settings → Suppliers: add a branch; the trade account is saved masked and never rendered raw", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    const folder = await openFolder(page, "movements", "suppliers");
    await folder.getByTestId("sup-add").click();
    await folder.getByTestId("sup-brand").fill(BRAND);
    await folder.getByTestId("sup-branch").fill("Oakleigh");
    await folder.getByTestId("sup-suburb").fill("Oakleigh");
    await folder.getByTestId("sup-postcode").fill("3166");
    await folder.getByTestId("sup-opens").fill("07:00");
    await folder.getByTestId("sup-delivers").check();
    await folder.getByTestId("sup-save").click();
    await expect(folder.getByTestId("sup-msg")).toContainText(/Saved/, { timeout: 15_000 });
    const { data } = await db!.from("supplier_branches").select("id, delivers_to_site, opens_weekday, vendor_id").eq("brand", BRAND).single();
    const b = data as { id: string; delivers_to_site: boolean; opens_weekday: string; vendor_id: string | null };
    expect(b.delivers_to_site).toBe(true);
    expect(b.opens_weekday).toBe("07:00:00");
    expect(b.vendor_id, "the brand's vendor row").toBeTruthy();

    const row = folder.getByTestId(`sup-row-${b.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId(`sup-account-input-${b.id}`).fill(ACCOUNT);
    await row.getByTestId(`sup-account-save-${b.id}`).click();
    await expect(folder.getByTestId("sup-msg")).toContainText(/Account saved/, { timeout: 15_000 });
    await expect(row.getByTestId(`sup-account-${b.id}`)).toContainText(`••••${ACCOUNT.slice(-4)}`, { timeout: 15_000 });
    const html = await page.content();
    expect(html, "the raw account reference is never in the page").not.toContain(ACCOUNT);
    const { data: acc } = await db!.from("supplier_branch_accounts").select("account_ref").eq("branch_id", b.id).single();
    expect((acc as { account_ref: string }).account_ref).toBe(ACCOUNT);
  });

  test("Settings → Movements: the radius and a board person in hours reach settings.movements", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    const folder = await openFolder(page, "movements", "movements");
    await folder.getByTestId("mv-nearkm").fill("9");
    const existing = await folder.getByTestId(`mv-person-${staffProfileId}`).count();
    if (existing === 0) await folder.getByTestId("mv-add-person").selectOption(staffProfileId);
    await folder.getByTestId(`mv-slots-${staffProfileId}`).selectOption("hour");
    await folder.getByTestId("mv-save").click();
    await expect(folder.getByTestId("mv-msg")).toContainText(/Saved/, { timeout: 15_000 });
    const { data } = await db!.from("settings").select("value").eq("key", "movements").single();
    const v = (data as { value: { nearKm: number; boardPeople: { id: string; slots: string }[] } }).value;
    expect(v.nearKm).toBe(9);
    expect(v.boardPeople.find((p) => p.id === staffProfileId)?.slots).toBe("hour");
  });

  test("Gear: on site after the out is done; flagged when the job closes; Find it in the tray opens the return chip", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/movements?view=gear");
    const card = page.locator(`[data-testid="gear-card"][data-item-id="${fixtureItemId}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-state", "site");
    await expect(card.getByTestId("gear-pill")).toContainText(/On site/);
    await expect(page.getByTestId("gear-legend")).toContainText("Spray gun");

    // The job closes with the sprayer still there: the nightly sync (here: the stage hook) makes the return chip; the item is stranded.
    const { error } = await db!.from("work_orders").update({ stage: "closed" }).eq("id", job!.workOrderId);
    expect(error).toBeNull();
    await page.goto("/pc/movements?view=gear");
    await expect(card).toHaveAttribute("data-state", "stranded", { timeout: 30_000 });
    await expect(card.getByTestId("gear-pill")).toContainText(/job closed/);
    await page.locator(`[data-testid="gear-filters"] button[data-filter="flag"]`).click();
    await expect(card).toBeVisible();
    await card.locator(".top").click();
    await card.getByTestId("gear-find-in-tray").click();
    await expect(page).toHaveURL(/view=week.*movement=/);
    await expect(page.getByTestId("chip-sheet")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chip-sheet")).toContainText(/Collect/);
  });
});

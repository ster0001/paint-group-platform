import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 2 — PC Command + Contractors, as a PC login
 * (brief Part D, session 2 e2e): every tile opens the right list and the
 * count equals the list length; the fixture job is in the right tiles; the
 * contractor tiles read the 0c capture (all_surfaces_done, the booking's
 * end, worked hours) with the source named on the row and the coverage on
 * the tile. Cleaned up in afterAll.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

test.describe("dashboard · session 2 · PC Command + Contractors", () => {
  test.skip(!staff || !contractor || !db, missingCreds("STAFF") + " + CONTRACTOR + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  let pcId = ""; const pcEmail = `pg.e2e.pc.${run}@example.com`;
  let contractorId = ""; let fixture: LoopFixture | null = null; let offerId = ""; let flagWas = false;
  // The Melbourne calendar day — never toISOString().slice(0, 10), which is yesterday before 10 am.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const daysFrom = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  test.beforeAll(async () => {
    const made = await db!.auth.admin.createUser({ email: pcEmail, password, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    pcId = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id: pcId, role: "staff", name: `PC ${run}`, is_owner: false, staff_access: {}, staff_roles: ["pc"] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);

    contractorId = (await contractorIdForEmail(db!, contractor!.email)) ?? "";
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    const flag = await db!.from("contractors").select("capture_worked_hours").eq("id", contractorId).single();
    flagWas = Boolean((flag.data as { capture_worked_hours: boolean } | null)?.capture_worked_hours);
    await db!.from("contractors").update({ capture_worked_hours: true }).eq("id", contractorId);

    // An in-progress job for the e2e painter, booked Mon-ish this week, all surfaces done today, hours entered.
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const offer = await db!.from("booking_offers").insert({
      work_order_id: fixture.workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: daysFrom(-3), end_date: daysFrom(1), hours_allowance: 24, payment_cents: 100000,
      offered_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), accepted_at: new Date(Date.now() - 20 * 3_600_000).toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();
    if (offer.error) throw new Error(offer.error.message);
    offerId = offer.data.id as string;
    const done = await db!.from("wo_events").insert({ work_order_id: fixture.workOrderId, type: "all_surfaces_done", actor_kind: "contractor", meta: {} });
    if (done.error) throw new Error(done.error.message);
    const hours = await db!.from("wo_worked_hours").insert({ work_order_id: fixture.workOrderId, contractor_id: contractorId, days: 3, hours: 22.5, source: "entered" });
    if (hours.error) throw new Error(hours.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (offerId) await db.from("booking_offers").delete().eq("id", offerId);
    await destroyLoopFixture(db, fixture);
    if (contractorId) await db.from("contractors").update({ capture_worked_hours: flagWas }).eq("id", contractorId);
    if (pcId) await db.auth.admin.deleteUser(pcId);
  });

  test("a PC login: every tile's count equals its list, and the fixture job sits in the right ones", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, { email: pcEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("section-pc_command")).toBeVisible();
    await expect(page.getByTestId("section-contractors")).toBeVisible();
    await expect(page.getByTestId("switches-on-pc_command")).toHaveCount(0);

    // Every tile on the page: the number shown equals the rows behind it (acceptance 1).
    const tiles = page.locator("button.tile");
    const n = await tiles.count();
    expect(n).toBeGreaterThanOrEqual(15);
    const checked: string[] = [];
    for (let i = 0; i < n; i++) {
      const tile = tiles.nth(i);
      const key = (await tile.getAttribute("data-testid"))!.replace(/^tile-/, "");
      const unit = key.endsWith("_cents") || key.includes("hours_vs") || key.includes("days_on_site") ? "money-or-ratio" : "count";
      if (unit !== "count") continue;   // money and ratio tiles are sums, checked by the unit suite
      const shown = Number(((await tile.getByTestId(`tile-value-${key}`).textContent()) ?? "").replace(/[^\d]/g, ""));
      await tile.click();
      const drill = page.getByTestId(`drill-${key}`);
      await expect(drill).toBeVisible();
      const rowsText = (await drill.locator(".drill-head .mono").textContent()) ?? "";
      const rowCount = Number(rowsText.replace(/[^\d].*$/, ""));
      const countWhere = ["contractors.finished_on_time", "contractors.qa_first_time", "contractors.offers_within_24h"].includes(key);
      if (!countWhere) expect(rowCount, key).toBe(shown);
      else expect(rowCount, key).toBeGreaterThanOrEqual(shown);   // "8 of 11": the value counts a subset of the rows
      checked.push(key);
      await tile.click();   // close
    }
    expect(checked).toEqual(expect.arrayContaining(["pc.in_progress", "pc.offers_past_sla", "contractors.finished_on_time", "contractors.expenses_pending"]));

    // The fixture job is in progress …
    await page.getByTestId("tile-pc.in_progress").click();
    await expect(page.getByTestId("drill-pc.in_progress")).toContainText("E2E tick fixture");
    await page.getByTestId("tile-pc.in_progress").click();
    // … finished on time (done today, booked to tomorrow) …
    await page.getByTestId("tile-contractors.finished_on_time").click();
    const onTime = page.getByTestId("drill-contractors.finished_on_time");
    await expect(onTime).toContainText("E2E tick fixture");
    await expect(onTime.locator("tr", { hasText: "E2E tick fixture" })).toContainText(today);
    await page.getByTestId("tile-contractors.finished_on_time").click();
    // … and its hours are the painter's own entry, named as such, with the coverage on the tile.
    await page.getByTestId("tile-contractors.hours_vs_estimate").click();
    const hours = page.getByTestId("drill-contractors.hours_vs_estimate");
    await expect(hours.locator("tr", { hasText: "E2E tick fixture" })).toContainText("Entered by the painter");
    await expect(hours.locator("tr", { hasText: "E2E tick fixture" })).toContainText("22.5");
    await expect(page.getByTestId("tile-note-contractors.hours_vs_estimate")).toContainText(/actual on \d+ of \d+ jobs?, schedule on \d+/);
    // Offers accepted within 24h: the fixture's offer was accepted 10 h after it went out.
    await page.getByTestId("tile-contractors.offers_within_24h").click();
    await expect(page.getByTestId("drill-contractors.offers_within_24h").locator("tr", { hasText: "WO-E2E" }).first()).toContainText("true");
  });

  test("the PC export goes through the one route, and a money-role section is not theirs", async ({ page }) => {
    await signIn(page, { email: pcEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    const ok = await page.request.get("/api/reporting/export?metric=pc.in_progress");
    expect(ok.status()).toBe(200);
    expect((await ok.text()).split("\r\n")[0]).toContain("Job,Address,Painter,Stage");
    const refused = await page.request.get("/api/reporting/export?metric=sales.estimates_sent&preset=month");
    expect(refused.status()).toBe(403);
  });
});

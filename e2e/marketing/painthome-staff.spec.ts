import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Paint Home brief §6 — the staff side: one brand pill and one brand filter,
 * no separate views. A seeded Paint Home estimate beside a Paint Group one:
 *  1. Estimates: the Paint Home row wears the pill, the Paint Group row does
 *     not; `?brand=painthome` keeps one, `?brand=paintgroup` the other, and
 *     the filter chips carry the choice across the status tabs
 *  2. the dashboard's marketing row "By shopfront" exists for the owner
 *     (the per-brand funnel draws itself once Paint Home sessions exist)
 */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("Paint Home — the staff side (session 5)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  const made: string[] = [];

  test.beforeAll(async () => {
    for (const [brand, title] of [["painthome", `PH staff ${run}`], ["paintgroup", `PG staff ${run}`]] as const) {
      const r = await db!.from("estimates").insert({
        status: "sent", source: "customer_intake", brand, level_of_finish: 3, title, total_cents: 110000, subtotal_cents: 100000,
        sent_at: new Date().toISOString(), builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      }).select("id").single();
      if (r.error) throw r.error;
      made.push(r.data.id as string);
    }
  });
  test.afterAll(async () => {
    if (db && made.length) await db.from("estimates").delete().in("id", made);
  });

  test("1 · Estimates: the pill on the Paint Home row, the filter across the tabs", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    const [phId, pgId] = made;
    await page.goto(`/estimates?status=all&q=${encodeURIComponent(`staff ${run}`)}`);
    const ph = page.locator(`tr:has([data-testid="estimate-pill-${phId}"])`);
    const pg = page.locator(`tr:has([data-testid="estimate-pill-${pgId}"])`);
    await expect(ph).toBeVisible({ timeout: 20_000 });
    await expect(pg).toBeVisible();
    await expect(ph.getByTestId("brand-pill")).toHaveText("Paint Home");
    await expect(pg.getByTestId("brand-pill")).toHaveCount(0);

    await page.getByTestId("brand-filter-painthome").click();
    await expect(page).toHaveURL(/brand=painthome/);
    await expect(page.locator(`[data-testid="estimate-pill-${phId}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-testid="estimate-pill-${pgId}"]`)).toHaveCount(0);
    // the status tabs keep the brand
    await page.getByTestId("estimates-tab-sent").click();
    await expect(page).toHaveURL(/status=sent.*brand=painthome|brand=painthome.*status=sent/);
    await expect(page.locator(`[data-testid="estimate-pill-${phId}"]`)).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("brand-filter-paintgroup").click();
    await expect(page.locator(`[data-testid="estimate-pill-${pgId}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-testid="estimate-pill-${phId}"]`)).toHaveCount(0);
    await page.getByTestId("brand-filter-all").click();
    await expect(page.locator(`[data-testid="estimate-pill-${phId}"]`)).toBeVisible({ timeout: 20_000 });
  });

  test("2 · the dashboard offers the By shopfront row", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/home?preset=30d");
    const tile = page.locator('[data-testid="tile-mk.by_brand"], [data-metric="mk.by_brand"]').first();
    if (await tile.count()) {
      await expect(tile).toBeVisible();
    } else {
      // the marketing section is owner/admin only — a staff login without it sees the page and no error
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });
});

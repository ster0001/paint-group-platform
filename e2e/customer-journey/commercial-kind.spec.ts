import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fillContactStep, MONEY_RANGE } from "./drive";
import { deleteUserByEmail, destroyAccountChain } from "../fixtures/portal";

/**
 * Tom, 8 Sep 2026 — commercial is three things, not one:
 *   · a few rooms or offices is priced by the wizard like any interior (no
 *     asbestos question, no "will anyone be living there"), and a figure shows;
 *   · a larger space, or strata / body corporate, says "we'll need to see it"
 *     on page 1 and ends on the person screen with that reason.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;
const stamp = Date.now();
const smallEmail = `e2e-commercial-small-${stamp}@example.com`;
const largeEmail = `e2e-commercial-large-${stamp}@example.com`;

const answer = (page: Page) => async (heading: string | RegExp, label: string) => {
  const row = page.locator(".wz-qhead", { hasText: heading })
    .locator("xpath=following-sibling::div[1]")
    .getByRole("button", { name: label, exact: true });
  if (await row.count()) await row.first().click();
};
const nextOf = (page: Page) => async () => {
  await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
  const err = page.locator(".wz-err");
  if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
};

async function startCommercial(page: Page) {
  await page.goto("/estimate");
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  await expect(page.getByText(/thirty seconds of basics/i)).toBeVisible();
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  await answer(page)("What kind of property", "Commercial");
  await expect(page.locator(".wz-qhead", { hasText: "What sort of commercial job" })).toBeVisible();
}

test.describe("commercial kind (Tom, 8 Sep)", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!, { auth: { persistSession: false } });

  test.afterAll(async () => {
    if (!db) return;
    for (const e of [smallEmail, largeEmail]) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); }
  });

  test("a few rooms or offices: no asbestos or living-there question, and a price shows", async ({ page }) => {
    test.setTimeout(240_000);
    await startCommercial(page);
    const ans = answer(page), next = nextOf(page);
    // Continue is refused until the sort of job is picked.
    await page.getByRole("button", { name: /Continue/ }).first().click();
    await expect(page.locator(".wz-err")).toContainText(/What sort of commercial job/);
    await ans("What sort of commercial job", "A few rooms or offices");
    await expect(page.getByTestId("commercial-small-note")).toBeVisible();
    await next(); // surfaces
    await next(); // condition
    await next(); // details
    await expect(page.locator(".wz-qhead", { hasText: /asbestos/ })).toHaveCount(0);
    await expect(page.locator(".wz-qhead", { hasText: /living there/ })).toHaveCount(0);
    await next(); // contact — nothing on the details page blocks a commercial job
    await fillContactStep(page, smallEmail);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 90_000 });
  });

  test("a larger space says 'we'll need to see it' up front and ends with a person", async ({ page }) => {
    test.setTimeout(240_000);
    await startCommercial(page);
    const ans = answer(page), next = nextOf(page);
    await ans("What sort of commercial job", "A larger space — whole floor, shop or warehouse");
    await expect(page.getByTestId("commercial-visit-note")).toContainText(/need to see it/);
    await ans("What sort of commercial job", "Strata / body corporate");
    await expect(page.getByTestId("commercial-visit-note")).toContainText(/Strata and body-corporate/);
    await next(); await next(); await next(); // surfaces, condition, details
    await expect(page.locator(".wz-qhead", { hasText: /asbestos/ })).toHaveCount(0);
    await next(); // contact
    await fillContactStep(page, largeEmail);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page.getByRole("heading", { name: "This one deserves a person" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("outcome-why")).toContainText(/priced on site/);
  });
});

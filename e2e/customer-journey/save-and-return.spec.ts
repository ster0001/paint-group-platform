import { test, expect, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, MONEY_RANGE } from "./drive";
import { magicLinkFor, destroyAccountChain } from "../fixtures/portal";

/**
 * Phase 1 of the 6 Sep estimator plan — save-and-return, as an anonymous
 * customer on a phone.
 *
 *  1. Same device: answer two pages, reload → the same page and the same
 *     answers come back with a "Welcome back" line; Start again wipes it.
 *     A homepage hand-off for a DIFFERENT address starts fresh.
 *  2. Another day, another device: a finished wizard run whose email owns
 *     an account. The magic link signs the customer in; the portal Home's
 *     primary action is "Keep shaping my estimate" and it opens the
 *     confirm-loop editor with the range — ownership by account membership,
 *     not by the anonymous session that built it.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

test.describe("save-and-return", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const returnEmail = `e2e-return-${stamp}@example.com`;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().eq("email", returnEmail);
    await destroyAccountChain(db, returnEmail);
  });

  test("same device: a reload puts the answers back on the page they were on; Start again wipes them", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByRole("button", { name: "4", exact: true }).click(); // bedrooms
    await page.locator(".wz-qhead", { hasText: "Heritage listed" }).locator("xpath=following-sibling::div[1]").getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 6", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Windows", exact: true }).click(); // an extra tick
    await page.waitForTimeout(800); // the browser copy is written a beat after the change

    await page.reload();
    await expect(page.getByTestId("wz-resume")).toContainText(/you were at Surfaces/);
    await expect(page.getByText("Step 2 of 6", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Windows/ })).toHaveClass(/\bon\b/);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("Murrumbeena");
    await expect(page.getByRole("button", { name: "4", exact: true })).toHaveClass(/\bon\b/);

    await page.getByTestId("wz-start-again").click();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    await page.reload();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);

    // A different address from the homepage is a new job — no resume.
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Malvern");
    await page.getByPlaceholder("Postcode").fill("3144");
    await page.waitForTimeout(800);
    await page.goto(`/estimate?address=${encodeURIComponent("9 Elm Street, Bentleigh VIC 3204")}&mode=home&src=homepage_hero`);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    await ctx.close();
  });

  test("another device: the magic link → portal Home → Keep shaping my estimate → the editor, by account membership", async ({ browser }) => {
    test.setTimeout(240_000);
    // Build and finish as an anonymous customer.
    const anon = await browser.newContext({ ...devices["iPhone 13"] });
    const p1 = await anon.newPage();
    await driveNoPlanWizard(p1, { email: returnEmail });
    const estimateId = new URL(p1.url()).searchParams.get("id");
    expect(estimateId).toBeTruthy();
    await anon.close();

    // A fresh browser (no anonymous session) with the emailed link.
    const other = await browser.newContext({ ...devices["iPhone 13"] });
    const p2 = await other.newPage();
    await p2.goto(await magicLinkFor(db!, returnEmail));
    await p2.goto("/account");
    const keep = p2.getByRole("link", { name: "Keep shaping my estimate" });
    await expect(keep).toBeVisible({ timeout: 20_000 });
    await keep.click();
    await expect(p2).toHaveURL(new RegExp(`/estimate/scope\\?id=${estimateId}`));
    await expect(p2.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 30_000 });
    // And an edit round-trips through the same ownership rule.
    await p2.locator('[data-card^="room:"] .il-hd').first().click();
    await p2.getByRole("button", { name: "Looks right" }).first().click();
    await expect(p2.locator(".sd-saving")).toHaveCount(0, { timeout: 20_000 });
    await expect(p2.locator(".il-prog")).toContainText(/OF \d+ ROOMS/);
    await other.close();
  });
});

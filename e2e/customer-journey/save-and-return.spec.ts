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

  test("same device: a reload puts the quick look's answers back; Start again wipes them", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto("/estimate");
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("ql-next").click();
    await page.getByTestId("ql-bedrooms-4").click();
    await page.getByTestId("ql-storeys-double").click();
    await page.waitForTimeout(800); // the browser copy is written a beat after the change

    /**
     * ⚑ THE BUG THIS CATCHES. The quick look's eight answers first lived in
     * component state, where autosave could not see them — a reload dropped
     * the customer back on screen 1 with nothing, and the draft the funnel
     * stored carried the derived state with no record of what was tapped.
     * They ride `state.quickLook` now, and the screen is the ordinary `page`.
     */
    await page.reload();
    await expect(page.getByTestId("wz-resume")).toContainText(/you were at The place/);
    await expect(page.locator("[data-quick-step='place']")).toBeVisible();
    await expect(page.getByTestId("ql-bedrooms-4")).toHaveClass(/\bon\b/);
    await expect(page.getByTestId("ql-storeys-double")).toHaveClass(/\bon\b/);
    await page.getByTestId("ql-back").click();
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("Murrumbeena");

    await page.getByTestId("wz-start-again").click();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    // The address field always renders; the suburb/postcode pair only appears
    // once something has been typed that the lookup could not resolve, so an
    // emptied screen correctly has no pair to check.
    await expect(page.getByPlaceholder(/Your address/)).toHaveValue("");
    await expect(page.getByPlaceholder("Suburb")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);

    // A different address from the homepage is a new job — no resume.
    await page.getByPlaceholder(/Your address/).fill("2 Wattle Road, Malvern");
    await page.getByPlaceholder("Suburb").fill("Malvern");
    await page.getByPlaceholder("Postcode").fill("3144");
    await page.waitForTimeout(800);
    await page.goto(`/estimate?address=${encodeURIComponent("9 Elm Street, Bentleigh VIC 3204")}&mode=home&src=homepage_hero`);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    // The homepage's address is MEANT to arrive prefilled — what must not come
    // back is the previous walk, so the field shows Bentleigh, never Malvern.
    await expect(page.getByPlaceholder(/Your address/)).toHaveValue(/Bentleigh/);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    await ctx.close();
  });

  test("another device: the magic link → portal Home → Keep shaping my estimate → the editor, by account membership", async ({ browser }) => {
    test.setTimeout(240_000);
    // Build and finish as an anonymous customer.
    const anon = await browser.newContext({ ...devices["iPhone 13"] });
    const p1 = await anon.newPage();
    /**
     * ⚑1 in practice: nothing asked for an email on the way to the price, so
     * the customer gives one at the REVEAL, through "Keep this estimate" —
     * which is also what creates the account the magic link then signs into.
     */
    await driveNoPlanWizard(p1, { stopAtReveal: true });
    const estimateId = await p1.getByTestId("reveal").getAttribute("data-estimate-id");
    expect(estimateId).toBeTruthy();
    await p1.getByTestId("door-keep").click();
    await p1.getByTestId("reveal-keep-email").fill(returnEmail);
    await p1.getByTestId("reveal-keep-send").click();
    await expect(p1.getByTestId("reveal-kept")).toContainText(returnEmail, { timeout: 30_000 });
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

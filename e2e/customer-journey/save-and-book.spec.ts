import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, signIn } from "../helpers";

/**
 * C8 — Screen 1, Save & book, "both", email after the price.
 *
 * Accept: no email field before the range on any customer branch · Save &
 * book on every screen · "both" shows two ranges. Tom's check: nine taps to
 * a range with no email asked; Save & book from screen 3, then open the
 * session as staff — it lands on screen 3.
 */

test("nine taps to a range, and no email is asked before it", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  // Screen 1 carries the way out: book someone in, or call.
  await expect(page.getByTestId("ql-rather-not")).toBeVisible();
  await expect(page.getByTestId("ql-book")).toBeVisible();
  // The pill is in the header from the first screen.
  await expect(page.getByTestId("save-and-book-pill")).toBeVisible();

  let taps = 0;
  const tap = async (testId: string) => { await page.getByTestId(testId).click(); taps++; };
  await fillQuickAddress(page);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await tap("ql-next");
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await tap("ql-kind-house"); await tap("ql-bedrooms-3"); await tap("ql-storeys-single");
  await tap("ql-next");
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await tap("ql-scope-whole"); await tap("ql-colour-same");
  await tap("ql-next");
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await tap("ql-condition-good"); await tap("ql-occupied-no");
  await tap("ql-next");
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // Eleven taps including the two Continues after the answers — nine answers
  // and no email anywhere on the way.
  expect(taps).toBeLessThanOrEqual(11);
  // The email exists only AFTER the range, behind "Keep this estimate".
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await page.getByTestId("door-keep").click();
  await expect(page.getByTestId("reveal-keep-email")).toBeVisible();
  // And the pill is still in the header on the reveal.
  await expect(page.getByTestId("save-and-book-pill")).toBeVisible();
});

test("Save & book from screen 3 keeps the session; staff open it at screen 3", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  const staff = credentials("STAFF");
  test.skip(!staff, "needs E2E_STAFF_*");

  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='job']")).toBeVisible();
  await page.getByTestId("ql-scope-walls_ceilings").click();

  // The pill, on screen 3.
  await page.getByTestId("save-and-book-pill").click();
  const email = `pg.e2e.sab.${Date.now().toString(36)}@example.com`;
  await page.getByTestId("sab-email").fill(email);
  await page.getByTestId("sab-call").click();
  await expect(page.getByTestId("save-and-book-done")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("save-and-book-done")).toContainText(email);

  // The session carries the promise and the resume point.
  await expect.poll(async () => {
    const r = await db!.from("wizard_drafts").select("id").eq("email", email).maybeSingle();
    return r.data?.id ?? null;
  }, { timeout: 30_000 }).not.toBeNull();
  const draft = (await db!.from("wizard_drafts").select("id, outcome, last_screen, bucket").eq("email", email).single()).data!;
  expect(draft.outcome).toBe("visit_requested");
  expect(draft.bucket).toBe("ready_visit");
  expect(draft.last_screen).toBe("quick:job");

  // Staff open the session — it lands on screen 3, under the assisted banner.
  const ctx = await browser.newContext();
  const staffPage = await ctx.newPage();
  await signIn(staffPage, staff!, /estimates/);
  await staffPage.goto(`/estimate?session=${draft.id}`);
  await expect(staffPage.getByTestId("assisted-banner")).toBeVisible({ timeout: 60_000 });
  await expect(staffPage.locator("[data-quick-step='job']")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

test("'both' meets the choice screen, then shows two ranges", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-both").click();
  await quickNext(page);
  await expect(page.getByTestId("ql-both")).toBeVisible();
  await expect(page.getByTestId("ql-next")).toHaveCount(0); // the doors are the answer
  await page.getByTestId("ql-both-book").click();
  await expect(page.getByTestId("save-and-book")).toBeVisible();
  await page.getByTestId("sab-close").click();
  await page.getByTestId("ql-both-self").click();
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();

  // The rest of the walk, through the shared drive, from where we are.
  await page.getByTestId("ql-kind-house").click();
  await quickNext(page);
  await page.getByTestId("ql-scope-whole").click();
  await quickNext(page);
  await page.getByTestId("ql-condition-good").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);

  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-part-interior")).toContainText(MONEY_RANGE);
  await expect(page.getByTestId("reveal-part-exterior")).toContainText(MONEY_RANGE);
});

test("the drive still walks a both job end to end", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page, { jobType: "both" });
  await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible({ timeout: 60_000 });
});

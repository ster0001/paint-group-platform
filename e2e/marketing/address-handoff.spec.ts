import { expect } from "@playwright/test";
import { test } from "../helpers";

/**
 * Tom, 25 Oct 2026: "after adding the address in the website, it doesn't
 * automatically transfer the suburb or the post code across". The homepage
 * resolves a picked address (suburb + postcode) and now hands the parts over
 * on the URL; the wizard opens with them in place and the first Continue
 * passes — no "We couldn't look that address up".
 *
 * The test stack has no Places key, so the pick itself cannot be driven here
 * (the field is a plain input); the hand-off URL the homepage builds is
 * pinned by lib/marketing/estimateLink.test.ts. This proves the receiving
 * side, as an anonymous customer, on both shopfronts.
 *
 * Wizard mobile v5 (S2, 28 Oct 2026): at 375px the wizard is the phone's
 * shell — the pick shows as the address chip on "What are we painting?", and
 * the first tap (Inside) is what passes the address check; with words alone
 * the address field and its empty suburb / postcode boxes show instead.
 */
const PARTS = "street=14+Acacia+Street&suburb=Northcote&state=VIC&postcode=3070&address=14+Acacia+Street%2C+Northcote+VIC+3070";

test.describe("Address hand-off — the pick's suburb and postcode reach the wizard", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  for (const [name, host] of [["Paint Home", "painthome"], ["Paint Group", null]] as const) {
    test(`${name}: the wizard opens with the suburb and postcode filled and Continue passes`, async ({ page, baseURL }) => {
      const u = new URL(baseURL!);
      const root = host ? `${u.protocol}//${host}.localhost${u.port ? `:${u.port}` : ""}` : baseURL!;
      await page.goto(`${root}/estimate?${PARTS}&mode=home&src=homepage_hero${host ? "&brand=painthome&scope=interior" : ""}`);
      await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
      await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
      await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("wzm-addr")).toContainText("Northcote");
      await expect(page.getByTestId("wzm-addr")).toContainText("3070");
      await expect(page.getByPlaceholder("Suburb")).toHaveCount(0);
      await page.getByTestId("ql-jobtype-interior").tap();
      await expect(page.locator("body")).not.toContainText("couldn't look that address up");
      await expect(page.locator("[data-quick-step='start']")).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator("[data-mobile-screen='property']")).toBeVisible();
    });
  }

  test("words alone still open the wizard, with the fallback fields empty (no lookup on the test stack)", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/estimate?address=14+Acacia+Street+Northcote&mode=home`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("wzm-addr")).toHaveCount(0);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
  });
});

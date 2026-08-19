import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Production killer #1 from the 20 Aug audit: a reprice is a 1–3s server
 * round-trip on production, and with no pending state the tapped control
 * read as dead — customers tapped again, or gave up.
 *
 * Every editor tap runs through act(), which counts in-flight requests and
 * renders the fixed SAVING… pill (.sd-saving) while the queue drains. This
 * spec slows one wizard-edit response by 1.5s and requires the indicator
 * to be VISIBLE during the round-trip and GONE after it — with the range
 * still a live money range. WITHOUT the indicator wiring this spec FAILS
 * (verified by suppressing the .sd-saving render and watching it fail).
 */
test("a reprice tap shows a visible pending state until the server answers", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  // Hold the next reprice for 1.5s — a production-shaped round-trip.
  await page.route("**/wizard-edit", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });

  await page.locator(".sc-tl").first().click();
  await expect(page.locator(".sd-saving")).toBeVisible({ timeout: 3_000 });
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

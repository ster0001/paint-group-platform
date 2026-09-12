import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard } from "./drive";

/**
 * Batch 4 — "Both" jobs get the STACKED editor (Tom's ruling on the parity
 * audit): the interior confirm loop first, then the four sides + exterior
 * meta cards, ONE combined progress count, ONE CTA — and always the visit
 * tier in v1 (mixed scope needs eyes). The old element-grouped exterior
 * editor is DELETED — no estimate renders it any more; pre-rebuild
 * estimates get a polite start-again holding message instead.
 */

test("Both job: interior cards then sides, combined progress, single visit CTA", async ({ page }) => {
  test.setTimeout(300_000);
  /**
   * v2 phase 2: a both job walks the quick look and the outside is sized from
   * the answers (`noPhotos`) — which is what it always did. ⚑ It still does not
   * name its sides, so all four are priced; closing that needs the surfaces
   * model split by side (see quickNext's note in WizardApp).
   */
  await driveNoPlanWizard(page, { jobType: "both" });

  // BOTH structures on one page: interior room cards AND the four sides.
  const roomCards = page.locator(".sc-rc[data-room]");
  expect(await roomCards.count()).toBeGreaterThan(2);
  await expect(page.locator(".sd-card", { hasText: "Front" })).toBeVisible();
  await expect(page.locator('[data-side="sweep"]')).toBeVisible();

  // ONE combined progress: rooms + dw + sweep + 8 exterior items.
  const rooms = await roomCards.count();
  await expect(page.locator(".il-prog")).toContainText(`0 OF ${rooms + 2 + 8}`);

  // The old element-grouped exterior editor is GONE.
  await expect(page.locator(".sc-grouplbl")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Whole house" })).toHaveCount(0);

  // Single CTA; mixed scope is ALWAYS the visit tier, and it says so.
  const cta = page.locator(".il-cta");
  // Tom, 8 Sep (evening): the button is live from the start and says how much
  // is left; it hands a mixed job to a person, and never accepts one online.
  await expect(cta).toBeEnabled();
  await expect(cta).not.toHaveText(/Accept estimate/);
  await expect(page.getByTestId("human-line")).toBeVisible(); // C11: the counter is gone; one human line stands in its place
  await expect(page.locator(".sc-tier")).toContainText(/visit/i);
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

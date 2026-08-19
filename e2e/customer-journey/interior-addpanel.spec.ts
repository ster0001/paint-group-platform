import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Parity PR — interior "+ Add a surface" panel (Inventory B6, mockup
 * customer-review-confirm-mockup.html): one panel per room offering the
 * catalogue as chips (priced adds with a toast — including the countable
 * Air Vent from Tom's price list), "+ More windows — a different size"
 * INSIDE the panel, and the free-text custom input (amber ⚑ tile, never
 * auto-priced) — replacing the old "More surfaces…" tail + stray input.
 */

test("interior add-surface panel: catalogue chips, air vent countable, more windows, custom", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const first = page.locator(".sc-rc[data-room]").first();
  await first.scrollIntoViewIfNeeded();

  // The panel opens from "+ Add a surface" (the mockup's control, not
  // "More surfaces…").
  await first.getByRole("button", { name: /\+ Add a surface/ }).click();
  const panel = first.locator(".sd-addpanel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/EVERYTHING WE PAINT/i);

  // Catalogue chips include the rate-card extras — Air Vent is priced,
  // added as a countable tile with a stepper.
  await panel.getByRole("button", { name: /\+ Air vent/i }).click();
  const airVent = first.locator(".sc-tl.on", { hasText: /Air vent/i });
  await expect(airVent).toBeVisible({ timeout: 15_000 });
  await expect(airVent.locator(".sc-st")).toBeVisible();
  await airVent.locator(".sc-st button", { hasText: "+" }).click();
  await expect(airVent.locator(".sc-st b")).toHaveText("2", { timeout: 15_000 });

  // "+ More windows — a different size" lives INSIDE the panel.
  await panel.getByRole("button", { name: /More windows — a different size/ }).click();
  await expect(first.locator(".il-wingroup")).toHaveCount(1, { timeout: 15_000 });

  // Custom input INSIDE the panel → amber ⚑ tile, site-visit toast.
  await panel.getByPlaceholder(/Something else/).fill("wall panelling");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(first.locator(".sc-tl.custom", { hasText: "wall panelling" })).toBeVisible({ timeout: 15_000 });

  // The range survives everything.
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

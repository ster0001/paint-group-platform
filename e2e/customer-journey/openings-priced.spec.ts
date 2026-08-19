import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * R1.2 — doors and windows priced by default (diagnostic #4 and part of #5).
 *
 * The bug this encodes: doorStyle/windowStyle default to "unsure", and the
 * merge never priced an unsure style — so EVERY door and window in the house
 * silently contributed $0, no countable tile was ever on, and no stepper ever
 * rendered. The rule now: a scope element the customer told us exists must
 * never contribute $0 without an on-screen trace. Unsure styles price at the
 * default rate (flat door / casement window) with an amber "style to confirm"
 * chip and a deferred entry — visible and provisionally priced.
 */

test.describe("R1.2 openings priced", () => {
  test("styles answered: every room's doors/windows are on, priced, steppered", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page, { doorStyle: "Panel", windowStyle: "Sash" });
    await openScopeEditor(page);

    // Doors are on wherever the room type carries them, with steppers.
    const doorTiles = page.locator(".sc-tl.on", { hasText: "Doors" });
    expect(await doorTiles.count()).toBeGreaterThan(0);
    expect(await page.locator(".sc-st").count()).toBeGreaterThan(0);
    // An answered style is not "to confirm".
    await expect(page.locator(".sc-styleconfirm")).toHaveCount(0);
  });

  test("styles unsure: openings still priced at defaults with an amber trace", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page); // page 4 untouched — both styles stay unsure
    await openScopeEditor(page);

    // The same tiles are PRESENT and ON — never silently omitted.
    const doorTiles = page.locator(".sc-tl.on", { hasText: "Doors" });
    expect(await doorTiles.count()).toBeGreaterThan(0);
    expect(await page.locator(".sc-st").count()).toBeGreaterThan(0);
    // The amber trace: style to confirm, visible on the tile.
    expect(await page.locator(".sc-styleconfirm").count()).toBeGreaterThan(0);
    await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
  });
});

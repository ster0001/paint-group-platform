import { test, expect, type Page } from "@playwright/test";
import { credentials, missingCreds, signIn } from "../helpers";
import { MONEY_RANGE, driveNoPlanWizard } from "./drive";

/**
 * R1.1 — the response contract (diagnostic #1 and #6).
 *
 * The wizard-edit endpoint must return a payload determined by the REQUESTING
 * SURFACE (explicit view=customer|staff), never by the caller's role. The bug
 * this encodes: a staff member previewing /estimate/scope got editorPayload
 * (no rangeLoCents, no scopeRooms) on every edit, so the range rendered
 * undefined after the FIRST tap and tiles never refreshed — invisible to a
 * real customer, visible to every staff preview, which is exactly how it hid.
 *
 * Both actors run the same assertions: load → range visible → first edit
 * keeps the range rendered → toggled tile actually disappears → removed room
 * actually disappears.
 */

async function assertContractHolds(page: Page) {
  // 28 Aug: no interstitial — the editor's range is a real range, immediately.
  const range = page.locator(".sc-r").first();
  await expect(range).toHaveText(MONEY_RANGE, { timeout: 20_000 });

  // THE regression: the first edit after load must keep the range rendered
  // and must refresh the tile grid.
  const firstCard = page.locator(".sc-rc").first();
  const onTiles = firstCard.locator(".sc-tl.on");
  const before = await onTiles.count();
  expect(before).toBeGreaterThan(0);
  await onTiles.first().click();
  await expect(onTiles).toHaveCount(before - 1, { timeout: 15_000 });
  await expect(range).toHaveText(MONEY_RANGE);
  await expect(range).not.toContainText(/undefined|NaN/);

  // Removing a room removes its card (server applied it AND the UI saw it).
  const cards = page.locator(".sc-rc[data-room]");
  const roomCards = (await cards.count()) ? cards : page.locator(".sc-rc:has(.sc-x)");
  const roomsBefore = await roomCards.count();
  expect(roomsBefore).toBeGreaterThan(1);
  page.once("dialog", (d) => d.accept());
  await page.locator(".sc-x").first().click();
  await expect(roomCards).toHaveCount(roomsBefore - 1, { timeout: 15_000 });
  await expect(range).toHaveText(MONEY_RANGE);
}

test.describe("R1.1 response contract", () => {
  test("staff preview gets the customer payload — range survives the first edit", async ({ page }) => {
    const staff = credentials("STAFF");
    test.skip(!staff, missingCreds("STAFF"));
    test.setTimeout(180_000);
    await signIn(page, staff!, /estimates/);
    await driveNoPlanWizard(page);
    await assertContractHolds(page);
  });

  test("anonymous customer gets the same contract", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/estimate");
    const held = await page.getByText("Online estimates are nearly here").count();
    test.skip(held > 0, "wizard_public is off — enable it (or run as staff) to exercise the anonymous path");
    await driveNoPlanWizard(page);
    await assertContractHolds(page);
  });
});

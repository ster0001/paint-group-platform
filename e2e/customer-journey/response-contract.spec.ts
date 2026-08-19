import { test, expect, type Page } from "@playwright/test";
import { credentials, missingCreds, signIn } from "../helpers";

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

const MONEY_RANGE = /\$[\d,]+\s*–\s*\$[\d,]+/;

/** Drive the no-plan customer wizard from /estimate to the result screen. */
async function driveNoPlanWizard(page: Page) {
  await page.goto("/estimate");
  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  await expect(page.getByText(/thirty seconds of basics/i)).toBeVisible();

  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page
      .locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("Heritage listed", "No");
  await answer("What kind of property", "House");

  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    // A gate error means the drive is wrong — surface it instead of timing out.
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // → surfaces
  await next(); // → condition
  await next(); // → details
  await answer(/built before 1970/, "No");
  await next(); // → paint
  await next(); // → email gate
  const email = page.locator("input[type=email]");
  if (await email.count()) await email.fill(`e2e-contract-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();

  // Processing → result. The no-plan path prices from typicals, so this is
  // seconds, not the minute a plan extraction takes.
  await expect(page.locator(".wz-r")).toBeVisible({ timeout: 90_000 });
}

async function assertContractHolds(page: Page) {
  // Result screen: the range is a real range, immediately.
  await expect(page.locator(".wz-r")).toHaveText(MONEY_RANGE);

  await page.getByRole("link", { name: /Open the editor/i }).click();
  const range = page.locator(".sc-r");
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

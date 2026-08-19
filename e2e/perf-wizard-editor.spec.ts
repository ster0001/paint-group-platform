import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * A4 measurement, part 2: the WIZARD EDITOR's removals. Every action there
 * POSTs to /api/estimates/:id/wizard-edit and waits for the server's
 * repriced payload before the row disappears. This spec runs the no-plan
 * wizard (8 bedrooms, double storey → 12 rooms) and times remove-room from
 * click to the card leaving the DOM.
 */

const staff = credentials("STAFF");

test.use({ actionTimeout: 8_000 });

test("measure wizard-editor removal cost on a 12-room estimate", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  test.setTimeout(180_000);

  await signIn(page, staff!, /estimates/);
  await page.goto("/wizard");

  // Page 1: no plan → quick basics, 5+ bedrooms double storey (11 rooms).
  await page.getByRole("button", { name: "There isn't a floorplan to hand" }).click();
  await page.getByRole("button", { name: "5+", exact: true }).click();
  await page.getByRole("button", { name: "Double", exact: true }).click();
  const next = () => page.getByRole("button", { name: /Continue|See my estimate/ }).click();
  for (let p = 1; p <= 4; p++) {
    await next();
    await page.waitForTimeout(400); // page transition animation
  }
  await next().catch(() => null); // "See my estimate" if a page gate delayed us

  // The editor: wait for room cards.
  await expect(page.getByText(/Bed 1/).first()).toBeVisible({ timeout: 60_000 });

  // Remove is inside the opened room card: open the card, then time the
  // Remove click until the card is gone from the list.
  const removals: number[] = [];
  const cards = page.getByRole("button", { name: /surfaces · \$/ });
  for (let i = 0; i < 4; i++) {
    const before = await cards.count();
    await cards.first().click(); // open the card
    const removeBtn = page.getByRole("button", { name: "Remove", exact: true });
    await expect(removeBtn).toBeVisible({ timeout: 10_000 });
    const t0 = Date.now();
    await removeBtn.click();
    await expect(cards).toHaveCount(before - 1, { timeout: 30_000 });
    removals.push(Date.now() - t0);
    console.log(`editor removal ${i + 1}: ${removals[i]}ms click→row-gone`);
  }
  console.log("wizard-editor removal wall times (ms):", removals);
});

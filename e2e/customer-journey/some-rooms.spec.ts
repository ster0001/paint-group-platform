/**
 * 14 Sep — "Some rooms — you'll pick which ones next" now asks. The rooms
 * step sits after the job screen for that preset only; unticked rooms are
 * never seeded, so the range is honest from the first number and the editor
 * opens on the rooms the customer named.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

test("some rooms asks which rooms and seeds only those", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page); // the place, defaults (3 beds)
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ql-scope-some_rooms").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  const tiles = page.locator("[data-testid^='ql-room-']");
  const n = await tiles.count();
  expect(n).toBeGreaterThan(4);
  // Every room starts ticked; untick the last two. (Two bedrooms alone at two
  // coats on the trims price under the $2,000 floor and land on the
  // "we'll price it directly" page — correct, and not this journey.)
  for (let i = n - 2; i < n; i++) await tiles.nth(i).click();
  await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(n - 1)).toHaveAttribute("aria-pressed", "false");
  const kept = [await tiles.nth(0).innerText(), await tiles.nth(1).innerText()];
  // Nothing ticked is a gate, not a silent "all rooms".
  for (let i = 0; i < n - 2; i++) await tiles.nth(i).click();
  await expect(page.getByTestId("ql-rooms-none")).toBeVisible();
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/at least one room/i);
  for (let i = 0; i < n - 2; i++) await tiles.nth(i).click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  const names = page.locator("[data-testid^='room-rename-btn-']");
  await expect(names).toHaveCount(n - 2);
  for (const k of kept) await expect(page.getByLabel(`Rename ${k}`)).toBeVisible();
});

/**
 * Tom, 14 Sep (evening): before the gate, every inside job confirms the rooms
 * being painted — from the answers when there is no floorplan — with untick
 * to remove and "Add a room" (a type and a name). The submit honours the list.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

test("the rooms are confirmed before the range: untick one, add one, and the editor shows exactly that", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page); // the place, defaults (3 beds)
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page); // the job, defaults
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1")).toContainText(/confirm the rooms/i);
  const tiles = page.locator("[data-testid^='ql-room-']:not([data-testid^='ql-room-added'])");
  const n = await tiles.count();
  expect(n).toBeGreaterThan(4);
  // Untick the last room.
  const dropped = (await tiles.nth(n - 1).innerText()).trim();
  await tiles.nth(n - 1).click();
  await expect(tiles.nth(n - 1)).toHaveAttribute("aria-pressed", "false");
  // Add a dining room.
  await page.getByTestId("ql-add-room-open").click();
  await page.getByTestId("ql-add-room-type-dining").click();
  await page.getByTestId("ql-add-room-name").fill("Dining room");
  await page.getByTestId("ql-add-room-go").click();
  await expect(page.getByTestId("ql-room-added-0")).toContainText("Dining room");
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  const names = page.locator("[data-testid^='room-rename-btn-']");
  await expect(names).toHaveCount(n); // n − 1 kept + the one added
  await expect(page.getByLabel("Rename Dining room")).toBeVisible();
  await expect(page.getByLabel(`Rename ${dropped}`)).toHaveCount(0);
});

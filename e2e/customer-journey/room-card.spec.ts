/**
 * Tom, 14 Sep (tighten batch, Part D): the room card.
 *  - "Extras in this room" is a Yes/No that starts at No; the questions appear after Yes;
 *  - Confirm on a room whose size is not confirmed reads the measurements back:
 *    Confirm answers the size and confirms in one tap and moves on; Change it
 *    opens the measurement boxes.
 */
import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

test("extras start at No and open on Yes", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const first = page.locator(".sc-rc[data-room]").first();
  const areaId = (await first.getAttribute("data-room"))!;
  await first.locator(".il-hd").click().catch(() => undefined);
  const extras = page.getByTestId(`room-extras-${areaId}`);
  await expect(extras).toContainText(/feature walls, wallpaper removal or something we should know/i);
  await expect(page.getByTestId(`room-extras-${areaId}-no`)).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("button", { name: "more feature walls" })).toHaveCount(0);
  await expect(page.getByTestId(`room-wallpaper-${areaId}-yes`)).toHaveCount(0);
  await page.getByTestId(`room-extras-${areaId}-yes`).click();
  await expect(first.getByRole("button", { name: "more feature walls" })).toBeVisible();
  await expect(page.getByTestId(`room-wallpaper-${areaId}-yes`)).toBeVisible();
  await first.getByRole("button", { name: "more feature walls" }).click();
  await expect(page.getByTestId(`room-feature-walls-${areaId}`)).toHaveText("1");
  await expect(page.getByTestId(`room-extras-note-${areaId}`)).toBeVisible({ timeout: 20_000 });
  // Once something is recorded the answer is Yes and stays that way.
  await expect(page.getByTestId(`room-extras-${areaId}-no`)).toBeDisabled();
});

test("Confirm on an unconfirmed size reads the measurements back; Change it opens the boxes; Confirm moves on", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const cards = page.locator(".sc-rc[data-room]");
  const first = cards.first();
  const areaId = (await first.getAttribute("data-room"))!;
  await first.locator(".il-hd").click().catch(() => undefined);
  // Answer the cupboard question (if the room has one) but NOT the size.
  for (let c = 0; c < 4 && (await first.locator(".il-cup:not(.ok)").count()); c++) {
    await first.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click({ timeout: 10_000 }).catch(() => undefined);
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  }
  await first.locator(".il-confirm").click();
  const box = page.getByTestId(`size-confirm-${areaId}`);
  await expect(box).toBeVisible();
  await expect(box).toContainText(/Confirming the room measurements are \d+(\.\d+)? × \d+(\.\d+)? m/);
  await expect(first).not.toHaveClass(/done/);
  // Change it → the measurement boxes, no confirm.
  await page.getByTestId(`size-confirm-change-${areaId}`).click();
  await expect(box).toHaveCount(0);
  await expect(first.getByPlaceholder(/length/i)).toBeVisible();
  await expect(first).not.toHaveClass(/done/);
  // Confirm from the box → size answered + confirmed in one tap, and the next room opens.
  await first.locator(".il-confirm").click();
  await page.getByTestId(`size-confirm-ok-${areaId}`).click();
  await expect(first).toHaveClass(/done/, { timeout: 20_000 });
  await expect(cards.nth(1).locator(".il-first")).toBeVisible({ timeout: 20_000 });
});

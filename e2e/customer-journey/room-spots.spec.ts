import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Phase 4 (§4.3, §9.4) — "point out a spot", driven on a real estimate.
 *
 * The gap this closes (§2.3): condition was one global answer, and "needs
 * repair" opened a free-text box the engine could not price. A spot is now a
 * tag pinned to a room that becomes a repair line — priced where ⚑6 says it
 * can be, and shown to a person where it says it cannot.
 */

test("a flagged spot becomes a repair line on the room it's in", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 200));
    }
  });

  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const firstRoom = page.locator(".sc-rc[data-room]").first();
  const areaId = await firstRoom.getAttribute("data-room");
  expect(areaId).toBeTruthy();

  const spots = page.getByTestId(`room-spots-${areaId}`);
  await expect(spots).toBeVisible();

  // The three-way condition question defaults to "same as the rest".
  await expect(page.getByTestId(`room-cond-${areaId}-same`)).toHaveAttribute("aria-pressed", "true");

  // A crack: ⚑6 says this one auto-prices.
  const before = await page.locator(".sc-r").first().innerText();
  await page.getByTestId(`spot-open-${areaId}`).click();
  // "A couple of spots" is the safe floor and starts selected.
  await expect(page.getByTestId(`spot-extent-${areaId}-spots`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`spot-tag-${areaId}-crack`).click();

  const list = page.getByTestId(`spot-list-${areaId}`);
  // Their own word back — they tapped "Crack", they read "Crack".
  await expect(list).toContainText("Crack", { timeout: 30_000 });
  await expect(list).toContainText("repair priced");

  // The repair moved the money, and the range is still a range.
  const after = page.locator(".sc-r").first();
  await expect(after).toHaveText(MONEY_RANGE);
  expect(await after.innerText()).not.toBe(before);

  // A water mark: ⚑6 says a person prices this one.
  // A water mark with no photo: recorded, priced by a person (⚑6) — and the
  // extent goes with it so they know whether it is two spots or the whole wall.
  await page.getByTestId(`spot-open-${areaId}`).click();
  await page.getByTestId(`spot-extent-${areaId}-most`).click();
  await page.getByTestId(`spot-tag-${areaId}-water`).click();
  await expect(list).toContainText("Water mark", { timeout: 30_000 });
  await expect(list).toContainText("we'll price this one");

  /**
   * The repair must NOT appear as a paintable surface tile. Prep lines used to
   * fall through to the catalogue branch and render with a count stepper,
   * inviting the customer to order "3 water damages".
   */
  await expect(firstRoom.locator(".sc-tile", { hasText: "Crack" })).toHaveCount(0);
  await expect(firstRoom.locator(".sc-tile", { hasText: "Water mark" })).toHaveCount(0);

  // Their own spot is theirs to take back off.
  const remove = firstRoom.locator("[data-testid^='spot-remove-']").first();
  await remove.click();
  await expect(list).not.toContainText("Crack", { timeout: 30_000 });

  // "Worse than the rest" is a room a person should look at.
  await page.getByTestId(`room-cond-${areaId}-worse`).click();
  await expect(page.getByTestId(`room-cond-${areaId}-worse`)).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });

  await firstRoom.screenshot({ path: "test-results/room-spots.png" });
});

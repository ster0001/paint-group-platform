import { test, expect } from "@playwright/test";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Commercial "Both" chosen ON the Space screen (found in UI refresh S7,
 * 10 Oct 2026). Both puts a `both` step at the front of the step list, so
 * the customer was dropped back onto the Place screen the moment they tapped
 * it, and their next Continue only brought them back to Space — it read as
 * Continue doing nothing. The page must stay on the step it is showing when
 * the list changes underneath it.
 *
 * As an anonymous customer.
 */
test("commercial Both on the Space screen: the page stays on Space, and ONE Continue reaches the questions", async ({ page }) => {
  test.setTimeout(120_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("ql-segment-office").click();
  await page.getByTestId("ql-cpart-both").click();
  // Still on Space — not thrown back to Place.
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible();
  await expect(page.getByTestId("ql-cpart-both")).toHaveAttribute("aria-pressed", "true");

  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 20_000 });

  // And back to Inside: still on the step it was on (Space), one Continue to the areas.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ql-cpart-interior").click();
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 20_000 });
});

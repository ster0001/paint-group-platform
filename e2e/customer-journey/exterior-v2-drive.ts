import { expect, type Page } from "@playwright/test";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Exterior wizard v2 — the shared walk to the Each-side step for the S4/S5
 * specs (a spec must not import another spec: Playwright would register its
 * tests twice). Home → Painting → About it with the plainest answers for the
 * shape, landing on "Check each side of the house".
 */
const BUNGALOW_PARTS = ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"];

export async function toSides(page: Page, shape = "cal", parts = BUNGALOW_PARTS, rowPosition?: string) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='home']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`ql-ext-type-${shape}`).click();
  await page.getByTestId("ql-ext-size-md").click();
  if (rowPosition) await page.getByTestId(`ql-ext-row-${rowPosition}`).click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
  for (const p of parts) await page.getByTestId(`ext-part-${p}`).click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  if (parts.includes("walls")) await page.getByTestId("ext-mat-weatherboards").click();
  if (parts.includes("gable")) await page.getByTestId("ext-gable-stucco").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
}


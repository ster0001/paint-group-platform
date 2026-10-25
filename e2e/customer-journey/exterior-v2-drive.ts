import { expect, type Page } from "@playwright/test";
import { fillQuickAddress, lookAtEverySide, MONEY_RANGE, openQuickLook, passDetailsSheetIfShown, passGateIfShown, quickNext } from "./drive";

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


/**
 * Tom, 25 Oct 2026: the old upload route (listing, facade photos, five pages)
 * is staff-only now, so the specs that used it to reach the SIDES EDITOR take
 * the customer's real way: the drawn house, every side looked at, the gate,
 * the range, then Tighten my price (exterior-v2-tighten.spec.ts, item 8).
 */
export async function toSidesEditor(page: Page, who: { name?: string; email?: string; mobile?: string } = {}) {
  await toSides(page, "cal", ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors"]);
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page, who);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page, who);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
}

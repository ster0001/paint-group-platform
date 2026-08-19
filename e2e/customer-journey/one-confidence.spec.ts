import { test, expect, type Page } from "@playwright/test";
import { driveNoPlanWizard } from "./drive";

/**
 * R1.4 — ONE confidence function (diagnostic #5, the 90%-vs-41% split).
 *
 * The bug this encodes: the header ring came from accuracy.ts while every
 * room card used a separate fixed lookup that ignored the height penalty,
 * deferred items and missing surfaces — cards said 90% while the ring said
 * 41%. Now one provenance-weighted function feeds header, cards and the
 * range band, and a no-plan/no-photo estimate is capped (~65%) until a real
 * confirmation arrives — honest-low always beats fake-high.
 */

async function headerPct(page: Page): Promise<number> {
  return parseInt((await page.locator(".wz-num").innerText()).replace("%", ""), 10);
}
async function cardPcts(page: Page): Promise<number[]> {
  const texts = await page.locator(".wz-rooms .wz-room span", { hasText: /^\d+%$/ }).allInnerTexts();
  return texts.map((t) => parseInt(t, 10));
}

test("R1.4 header and room cards agree; confirming moves both; no-plan is capped", async ({ page }) => {
  test.setTimeout(180_000);
  await driveNoPlanWizard(page);

  // Honesty cap: a starter-list estimate (nothing extracted, nothing
  // confirmed) can never exceed 65%.
  const header0 = await headerPct(page);
  expect(header0).toBeLessThanOrEqual(65);

  // The regression: every card must come from the same function — with all
  // rooms assumed from typicals, no card may report near-certainty.
  const cards0 = await cardPcts(page);
  expect(cards0.length).toBeGreaterThan(0);
  for (const c of cards0) expect(c).toBeLessThanOrEqual(65);

  // Confirming one room's size moves BOTH its card and the header, together.
  await page.locator(".wz-rooms .wz-room").first().locator("button").first().click();
  await page.getByRole("button", { name: "Confirm size" }).click();
  await expect(page.locator(".wz-prov", { hasText: /CONFIRMED/ }).first()).toBeVisible({ timeout: 15_000 });
  const header1 = await headerPct(page);
  const cards1 = await cardPcts(page);
  expect(header1).toBeGreaterThan(header0);
  expect(Math.max(...cards1)).toBeGreaterThan(Math.max(...cards0));
});

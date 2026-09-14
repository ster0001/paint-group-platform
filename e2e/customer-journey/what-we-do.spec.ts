import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

/**
 * C9 — What's changing colour, the details screen, What we'll do.
 *
 * Tom's check: tick doors and trims as changing colour, then answer water-based over oil on the
 * details screen — What we'll do gains an undercoat and a primer line and the
 * range moves once per tap. Accept: no paint-system control in any customer
 * component · the panel's lines derive only from rules and state.
 */
test("doors and trims changing, then water over oil: the panel gains the undercoat, and the range moves", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);

  // Screen 3: the colour block. Every tile starts ticked (Tom, 14 Sep) —
  // doors and trims are already changing. No coat picker anywhere.
  await expect(page.getByTestId("ql-changing")).toBeVisible();
  await expect(page.locator('[data-testid^="ql-colour-"]')).toHaveCount(0);
  await expect(page.getByTestId("ql-changing-trims")).toHaveAttribute("aria-pressed", "true");
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 }); // 14 Sep (evening): confirm the rooms
  await quickNext(page);
  await page.getByTestId("ql-condition-wear").click();
  await quickNext(page);

  // The reveal: the range, and What we'll do beneath it — read-only.
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  const panel = page.getByTestId("what-we-do");
  await expect(panel).toBeVisible();
  await expect(panel.locator("button")).toHaveCount(0);
  const trimsLine = page.getByTestId("what-we-do-trims");
  await expect(trimsLine).toBeVisible();
  // Doors and trims are changing colour: two coats as standard (Tom, 14 Sep),
  // no undercoat yet, and the orange "may need more" line under it.
  const coatsBefore = Number(await trimsLine.getAttribute("data-coats"));
  expect(coatsBefore).toBe(2);
  await expect(trimsLine).toHaveAttribute("data-undercoat", "0");
  await expect(page.getByTestId("what-we-do-note-trims")).toContainText(/additional coats/i);
  const rangeBefore = await page.getByTestId("reveal-range").textContent();

  // Tighten → the details card asks what the trims are painted with, then
  // what is underneath.
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  // Tom, 14 Sep (evening): one question at a time — cornices, doors, the window type, then the paint.
  const detailsCard = page.getByTestId("details-card");
  await expect(detailsCard).toBeVisible({ timeout: 60_000 });
  await detailsCard.getByTestId("details-cornices").getByRole("button", { name: "No", exact: true }).click();
  await expect(detailsCard.getByTestId("door-tile-panel")).toBeVisible({ timeout: 30_000 });
  await detailsCard.getByTestId("door-tile-panel").click();
  await expect(detailsCard.getByTestId("window-tile-casement")).toBeVisible({ timeout: 30_000 });
  await detailsCard.getByTestId("window-tile-casement").click();
  const base = page.getByTestId("details-paint-base");
  await expect(base).toBeVisible({ timeout: 60_000 });
  const editorRange = page.locator(".sc-r").first();
  await expect(editorRange).toContainText(MONEY_RANGE, { timeout: 30_000 });
  const editorRangeBefore = (await editorRange.textContent())!.trim();
  await base.getByRole("button", { name: "Water based", exact: true }).click();
  const current = page.getByTestId("details-trims-current");
  await expect(current).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("details-card-step-trims_current")).toContainText(/extra coats will apply/i);
  await expect(base).toHaveCount(0);
  await current.getByRole("button", { name: "Currently oil based", exact: true }).click();

  // One tap: the trims line gains the undercoat (one more coat), and the
  // toast carries the money that moved. The panel is still read-only.
  const editorPanel = page.getByTestId("what-we-do");
  await expect(editorPanel.getByTestId("what-we-do-trims")).toContainText(/an undercoat and two coats of water-based enamel/i, { timeout: 30_000 });
  await expect(editorPanel.getByTestId("what-we-do-trims")).toHaveAttribute("data-coats", String(coatsBefore + 1));
  await expect(editorPanel.getByTestId("what-we-do-trims")).toHaveAttribute("data-undercoat", "1");
  await expect(editorPanel.locator("button")).toHaveCount(0);
  // One tap, one reprice: the range moved with the extra coat.
  await expect(editorRange).not.toHaveText(editorRangeBefore, { timeout: 30_000 });
  // Both questions answered, so they go.
  await expect(current).toHaveCount(0);
  expect(rangeBefore).toBeTruthy();
});

test("nothing ticked is the same colour: one coat on the walls, and no undercoat anywhere", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await quickNext(page);
  // Every tile starts ticked (Tom, 14 Sep) — "nothing ticked" means unticking all three.
  for (const k of ["walls", "ceilings", "trims", "windows"]) {
    await page.getByTestId(`ql-changing-${k}`).click();
    await expect(page.getByTestId(`ql-changing-${k}`)).toHaveAttribute("aria-pressed", "false");
  }
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 }); // 14 Sep (evening): confirm the rooms
  await quickNext(page);
  await page.getByTestId("ql-condition-good").click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("what-we-do-walls")).toHaveAttribute("data-coats", "1");
  await expect(page.getByTestId("reveal-restatement")).toContainText("the same colours");
  for (const li of await page.locator('li[data-testid^="what-we-do-"]').all()) {
    await expect(li).toHaveAttribute("data-undercoat", "0");
  }
});

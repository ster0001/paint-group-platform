import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

/**
 * C9 — What's changing colour, the details screen, What we'll do.
 *
 * Tom's check: tick doors and trims as changing colour, then tap Shiny on the
 * details screen — What we'll do gains an undercoat and a primer line and the
 * range moves once per tap. Accept: no paint-system control in any customer
 * component · the panel's lines derive only from rules and state.
 */
test("doors and trims changing, then Shiny: the panel gains the undercoat and the primer, and the range moves", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);

  // Screen 3: the colour block. Walls stay ticked by default; tick doors and
  // trims too. No coat picker anywhere.
  await expect(page.getByTestId("ql-changing")).toBeVisible();
  await expect(page.locator('[data-testid^="ql-colour-"]')).toHaveCount(0);
  await page.getByTestId("ql-changing-trims").click();
  await expect(page.getByTestId("ql-changing-trims")).toHaveAttribute("aria-pressed", "true");
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
  // Doors and trims are changing colour: the rules' own "new" system (an
  // undercoat and two coats by default), and no bonding primer yet.
  const coatsBefore = Number(await trimsLine.getAttribute("data-coats"));
  expect(coatsBefore).toBeGreaterThanOrEqual(2);
  await expect(trimsLine).not.toContainText(/bonding primer/i);
  const rangeBefore = await page.getByTestId("reveal-range").textContent();

  // Tighten → the details card asks whether the doors and skirtings are shiny.
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  const gloss = page.getByTestId("details-gloss");
  await expect(gloss).toBeVisible({ timeout: 60_000 });
  const editorRange = page.locator(".sc-r").first();
  await expect(editorRange).toContainText(MONEY_RANGE, { timeout: 30_000 });
  const editorRangeBefore = (await editorRange.textContent())!.trim();
  await gloss.getByRole("button", { name: "Shiny" }).click();

  // One tap: the trims line gains the bonding primer (one more coat), and the
  // toast carries the money that moved. The panel is still read-only.
  const editorPanel = page.getByTestId("what-we-do");
  await expect(editorPanel.getByTestId("what-we-do-trims")).toContainText(/bonding primer/i, { timeout: 30_000 });
  await expect(editorPanel.getByTestId("what-we-do-trims")).toHaveAttribute("data-coats", String(coatsBefore + 1));
  await expect(editorPanel.getByTestId("what-we-do-trims")).toHaveAttribute("data-undercoat", "1");
  await expect(editorPanel.locator("button")).toHaveCount(0);
  // One tap, one reprice: the range moved with the extra coat.
  await expect(editorRange).not.toHaveText(editorRangeBefore, { timeout: 30_000 });
  // The gloss question is answered, so it goes.
  await expect(gloss).toHaveCount(0);
  expect(rangeBefore).toBeTruthy();
});

test("nothing ticked is the same colour: one coat on the walls, and no undercoat anywhere", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await quickNext(page);
  await page.getByTestId("ql-changing-walls").click(); // untick the default
  await expect(page.getByTestId("ql-changing-walls")).toHaveAttribute("aria-pressed", "false");
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

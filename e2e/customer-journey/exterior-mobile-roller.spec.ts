import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, openQuickLook } from "./drive";

/**
 * EXTERIOR ON MOBILE v5 — session 2 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 5a–5d, §3; v5 brief §3.3): THE ROLLER ON THE DRAWN HOUSE, as an
 * ANONYMOUS customer at 390 × 780 with touch.
 *
 * Ticking a part on a Painting screen sweeps that part's paint in on the
 * strip's thumbnail WITHOUT opening the sheet (the v4 bug test): the part's
 * clip rect runs 0 → 400 over ~520 ms with the roller glyph riding the
 * edge; unticking wipes it back; reduced motion snaps. In the sheet the same
 * house is full width, a tap on a part there ticks the chip, and both
 * pictures stay in step with the step's chips.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0";
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");
test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
const width = (page: Page, where: "wzm-thumb" | "wzm-bigpic", part: string) =>
  page.locator(`[data-testid='${where}'] svg.wz-elev [data-surf='${part}'] rect.cprect`).evaluate((r) => Number(r.getAttribute("width") ?? "0"));

/** Outside → a Californian bungalow, medium → the first Painting screen. */
async function toPainting(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ql-jobtype-exterior").tap();
  await at(page, "property");
  await page.getByTestId("ql-kind-house").tap();
  await at(page, "shape");
  await page.getByTestId("ql-ext-type-cal").tap();
  await at(page, "size");
  await page.getByTestId("ql-ext-size-md").tap();
  await at(page, "p-house");
}

test("a part chip sweeps its paint in on the thumbnail without the sheet, the glyph rides the edge, unticking wipes it back, reduced motion snaps", async ({ page }) => {
  test.setTimeout(150_000);
  await toPainting(page);
  const thumb = page.getByTestId("wzm-thumb").locator("svg.wz-elev");
  await expect(thumb).toHaveAttribute("data-shape", "cal");
  // nothing pre-ticked (C8b): every layer out
  for (const p of ["walls", "gable", "fascias", "gutters", "eaves"]) expect(await width(page, "wzm-thumb", p)).toBe(0);
  await expect(thumb.locator(".e-walls")).toHaveAttribute("data-on", "0");
  await expect(page.getByTestId("wzm-sheet")).toHaveCount(0);
  // tick the walls: the sweep is under way (not a snap), the glyph shows, then the layer is fully in
  await page.getByTestId("ext-part-walls").tap();
  await expect(thumb.locator(".e-walls")).toHaveAttribute("data-on", "1");
  await page.waitForTimeout(150);
  const mid = await width(page, "wzm-thumb", "walls");
  expect(mid, "the sweep is under way, not a snap").toBeGreaterThan(0);
  expect(mid).toBeLessThan(400);
  await expect(thumb.locator("[data-surf='walls'] .roller")).toHaveClass(/on/);
  await expect.poll(() => width(page, "wzm-thumb", "walls"), { timeout: 3_000 }).toBe(400);
  await expect(thumb.locator("[data-surf='walls'] .roller")).not.toHaveClass(/on/);
  await expect(page.getByTestId("wzm-sheet"), "no sheet opened").toHaveCount(0);
  // the gable too; the walls stay in
  await page.getByTestId("ext-part-gable").tap();
  await expect.poll(() => width(page, "wzm-thumb", "gable"), { timeout: 3_000 }).toBe(400);
  expect(await width(page, "wzm-thumb", "walls")).toBe(400);
  await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("2 parts ticked · tap to see");
  // untick the walls: the wipe runs back to nothing
  await page.getByTestId("ext-part-walls").tap();
  await expect(thumb.locator(".e-walls")).toHaveAttribute("data-on", "0");
  await page.waitForTimeout(150);
  const wiping = await width(page, "wzm-thumb", "walls");
  expect(wiping).toBeGreaterThan(0);
  expect(wiping).toBeLessThan(400);
  await expect.poll(() => width(page, "wzm-thumb", "walls"), { timeout: 3_000 }).toBe(0);
  // reduced motion: a snap
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("ext-part-fascias").tap();
  await page.waitForTimeout(60);
  expect(await width(page, "wzm-thumb", "fascias")).toBe(400);
  await page.getByTestId("ext-part-fascias").tap();
  await page.waitForTimeout(60);
  expect(await width(page, "wzm-thumb", "fascias")).toBe(0);
});

test("the sheet: the same house full width; a tap on a part there ticks the chip; a sheet chip ticks a part; both pictures stay in step", async ({ page }) => {
  test.setTimeout(150_000);
  await toPainting(page);
  await page.getByTestId("ext-part-walls").tap();
  await expect.poll(() => width(page, "wzm-thumb", "walls"), { timeout: 3_000 }).toBe(400);
  await page.getByTestId("wzm-strip").tap();
  const big = page.getByTestId("wzm-bigpic").locator("svg.wz-elev");
  await expect(big).toHaveAttribute("data-shape", "cal");
  await expect(big).toHaveClass(/tappable/);
  expect(await width(page, "wzm-bigpic", "walls"), "the sheet's copy shows the walls painted").toBe(400);
  await expect(page.getByTestId("wzm-cap")).toContainText("Tap a part to paint it in or out");
  // a tap on the gutters in the picture
  await big.locator(".e-gutters").first().tap();
  await expect(big.locator(".e-gutters")).toHaveAttribute("data-on", "1");
  await expect.poll(() => width(page, "wzm-bigpic", "gutters"), { timeout: 3_000 }).toBe(400);
  // the sheet's chip for the doors
  await page.getByTestId("wzm-sheet-chip-doors").tap();
  await expect(page.getByTestId("wzm-sheet-chip-doors")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => width(page, "wzm-bigpic", "doors"), { timeout: 3_000 }).toBe(400);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wzm-sheet")).toHaveCount(0);
  // the step's chips and the thumbnail agree
  await expect(page.getByTestId("ext-part-gutters")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => width(page, "wzm-thumb", "gutters"), { timeout: 3_000 }).toBe(400);
  await expect.poll(() => width(page, "wzm-thumb", "doors"), { timeout: 3_000 }).toBe(400);
  await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("3 parts ticked · tap to see");
  // the doors chip lives on the second screen
  await page.getByTestId("ql-next").tap();
  await at(page, "p-win");
  await expect(page.getByTestId("ext-part-doors")).toHaveAttribute("aria-pressed", "true");
});

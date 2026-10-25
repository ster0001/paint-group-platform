import { test, expect } from "@playwright/test";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Tom, 25 Oct 2026 (evening, on his phone): "when clicking apartment or unit,
 * the picture doesn't show in full". On a phone the picture band is 170px and
 * the 400 × 300 house drawing is zoomed to fill it; a unit is a tall block and
 * the zoom cut its roof and door off. Every kind of property on the place step
 * must draw its building wholly inside the band.
 */
test("on a phone every kind of property draws its whole building inside the picture band", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await openQuickLook(page);
    await fillQuickAddress(page);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
    const building: Record<string, string> = {
      house: ".roof, .frame", townhouse: ".roof, .frame", unit_apartment: "[data-part='block']", commercial: "[data-part='shopfront']",
    };
    // Single storey for each kind, then the house again with two storeys (the roof lifts 70 units).
    const cases: Array<[string, string, "single" | "double"]> = [...Object.entries(building).map(([k, s]) => [k, s, "single"] as [string, string, "single"]), ["house", building.house, "double"]];
    for (const [kind, sel, storeys] of cases) {
      await page.getByTestId(`ql-kind-${kind}`).click();
      await page.getByTestId(`ql-storeys-${storeys}`).click();
      await expect(page.locator(`[data-testid='pic-house'][data-kind='${kind}'][data-storeys='${storeys}']`)).toBeVisible();
      await page.waitForTimeout(800); // the picture's transition (the two-storey roof lifts over .6s)
      const box = await page.evaluate((s) => {
        const art = document.querySelector(".wz-pic-art")!.getBoundingClientRect();
        const parts = [...document.querySelectorAll(`[data-testid='pic-house'] :is(${s})`)].map((e) => e.getBoundingClientRect());
        return { art: { top: art.top, bottom: art.bottom, left: art.left, right: art.right }, top: Math.min(...parts.map((p) => p.top)), bottom: Math.max(...parts.map((p) => p.bottom)), left: Math.min(...parts.map((p) => p.left)), right: Math.max(...parts.map((p) => p.right)), n: parts.length };
      }, sel);
      const tag = `${kind} (${storeys})`;
      expect(box.n, `${tag}: the building is drawn`).toBeGreaterThan(0);
      expect(box.top, `${tag}: the top of the building is in the band`).toBeGreaterThanOrEqual(box.art.top - 1);
      expect(box.bottom, `${tag}: the bottom of the building is in the band`).toBeLessThanOrEqual(box.art.bottom + 1);
      expect(box.left, `${tag}: the left of the building is in the band`).toBeGreaterThanOrEqual(box.art.left - 1);
      expect(box.right, `${tag}: the right of the building is in the band`).toBeLessThanOrEqual(box.art.right + 1);
    }
  } finally {
    await ctx.close();
  }
});

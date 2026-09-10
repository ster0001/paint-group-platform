import { test, expect, devices } from "@playwright/test";
import { openExteriorPages, quickNext, MONEY_RANGE } from "./drive";

for (const [name, vp] of [["phone", devices["iPhone 13"].viewport], ["desktop", { width: 1280, height: 900 }]] as const) {
  test(`walls % sits cleanly — ${name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await openExteriorPages(page);
    await quickNext(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await page.getByTestId("door-tighten").click();
    const front = page.locator('[data-side="front"]');
    await expect(front).toBeVisible({ timeout: 60_000 });
    await front.locator(".sd-hd").click();
    await front.getByRole("button", { name: "Yes", exact: true }).click();
    const wall = front.locator(".sd-wall").first();
    await expect(wall).toBeVisible();
    await wall.scrollIntoViewIfNeeded();
    // The buttons must sit INSIDE the tile, not spill past its edge.
    const tile = await wall.boundingBox();
    const pcts = await wall.locator(".sd-pcts").boundingBox();
    console.log(`${name} tile`, JSON.stringify(tile), "pcts", JSON.stringify(pcts));
    expect(pcts!.x).toBeGreaterThanOrEqual(tile!.x - 1);
    expect(pcts!.x + pcts!.width).toBeLessThanOrEqual(tile!.x + tile!.width + 1);
    await wall.screenshot({ path: `test-results/walls-pct-${name}.png` });
    await ctx.close();
  });
}

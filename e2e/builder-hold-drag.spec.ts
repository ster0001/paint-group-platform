import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 10 Sep 2026: "the drag and drop function in the estimator doesn't
 * work on mobile or tablet — hold your finger down for 1 second to move."
 *
 * Real touch events through CDP (Playwright's touchscreen only taps): a
 * finger that lands on the grip, stays still for the second and then slides
 * over the last row moves the block there. A finger that slides straight
 * away is a scroll, not a drag — nothing moves.
 */
const db = serviceClient();
const staff = credentials("STAFF");

const block = (id: number, name: string) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [], surfaces: [],
});

test.describe("builder — hold to drag on a touch screen", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const run = randomBytes(3).toString("hex");
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Hold to drag ${run}`, status: "draft", source: "manual",
      builder_state: { blocks: [block(1, "Alpha room"), block(2, "Bravo room"), block(3, "Charlie room")], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  const order = async (page: import("@playwright/test").Page) =>
    page.locator("[data-block-id]").evaluateAll((els) => els.map((e) => e.textContent?.match(/(Alpha|Bravo|Charlie) room/)?.[1] ?? "?"));

  test("a still second on the grip lifts the row; a slide straight away scrolls instead", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await expect(page.getByTestId("grip-1")).toBeVisible({ timeout: 20_000 });
    expect(await order(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

    const cdp = await page.context().newCDPSession(page);
    const centre = async (sel: string) => {
      const b = await page.locator(sel).boundingBox();
      if (!b) throw new Error(`no box for ${sel}`);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });

    // Both rows must be on screen for a finger to reach them — the toolbar
    // wraps on a phone and pushes the list down.
    const onScreen = async () => {
      await page.locator('[data-testid="grip-1"]').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(300);
      return { g: await centre('[data-testid="grip-1"]'), r: await centre('[data-block-id="3"]') };
    };

    // 1 · slide straight away: nothing moves.
    const { g: grip1, r: row3 } = await onScreen();
    await touch("touchStart", grip1);
    await page.waitForTimeout(100);
    await touch("touchMove", { x: grip1.x, y: grip1.y + 40 });
    await touch("touchMove", row3);
    await touch("touchEnd");
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

    // 2 · hold still for the second, then slide onto the last row: Alpha lands after Charlie.
    // (Re-measure: the quick slide above may have scrolled the page.)
    const { g: grip1b, r: row3b } = await onScreen();
    await touch("touchStart", grip1b);
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-block-id="1"]')).toHaveClass(/opacity-40/); // lifted
    await touch("touchMove", { x: grip1b.x, y: grip1b.y + 20 });
    await touch("touchMove", row3b);
    await expect(page.locator('[data-block-id="3"]')).toHaveClass(/ring-2/); // the drop target
    await touch("touchEnd");
    await expect.poll(() => order(page)).toEqual(["Bravo", "Charlie", "Alpha"]);
  });
});

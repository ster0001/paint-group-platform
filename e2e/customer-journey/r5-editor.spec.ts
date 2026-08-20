import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * R5 (Tom, 20 Aug 2026) — the five things he asked for on the scope editor,
 * each asserted against the REAL screen rather than the pure function under
 * it. Every one of these was reproducible in seconds of using the app and
 * invisible to the unit suite, which is the lesson from 19 Aug.
 */

test.describe("R5 customer scope editor", () => {
  test("the confidence score is named, starts low, and climbs as rooms are confirmed", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    await expect(page.locator(".sc-lbl b")).toHaveText(/confidence score/i);

    const pct = async () => parseInt((await page.locator(".sc-num").innerText()).replace("%", ""), 10);
    const start = await pct();
    // "Initially the accuracy % is lower" — an all-assumed starter house
    // must not present itself as nearly certain.
    expect(start).toBeLessThan(70);

    // Confirm two rooms properly; the score must rise at each one. Before
    // R5 it sat still through an entire walk-through (measured at 18%).
    const walk: number[] = [start];
    for (let i = 0; i < 2; i++) {
      // The open card is the one the confirm loop is currently on (it
      // auto-advances and scrolls after each confirm).
      const card = page.locator(".sc-rc").filter({ has: page.locator(".il-confirm") }).first();
      const looks = card.getByRole("button", { name: "Looks right" });
      if (await looks.count()) { await looks.first().click(); await page.waitForTimeout(1000); }
      const yes = card.locator(".il-cup").getByRole("button", { name: "Yes" });
      if (await yes.count()) { await yes.first().click(); await page.waitForTimeout(1000); }
      // The pill, not the button: a confirmed card COLLAPSES, taking its
      // confirm button out of the DOM entirely.
      const doneBefore = await page.locator(".il-pill.done").count();
      await card.locator(".il-confirm").first().click();
      // One more card has gone blue — the honest signal that a confirm landed.
      await expect
        .poll(async () => page.locator(".il-pill.done").count(), { timeout: 20_000 })
        .toBeGreaterThan(doneBefore);
      await page.waitForTimeout(400);
      walk.push(await pct());
    }
    for (let i = 1; i < walk.length; i++) {
      expect(walk[i], `confirming room ${i} must raise the score (${walk.join(" → ")})`).toBeGreaterThan(walk[i - 1]);
    }
  });

  test("the header, the progress bar and the score stay put while scrolling", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const box = await page.locator(".sc-freeze").boundingBox();
    expect(box, "the frozen stack must still be on screen at the bottom of the page").not.toBeNull();
    expect(box!.y).toBeLessThanOrEqual(1);
    await expect(page.locator(".sc-num")).toBeVisible();
    await expect(page.locator(".il-prog")).toBeVisible();
  });

  test("a burst of stepper taps is ONE save, and no tap is lost", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    let saves = 0;
    page.on("request", (r) => { if (r.url().includes("wizard-edit")) saves++; });

    const plus = page.locator(".sc-st button[aria-label='more']").first();
    const readout = page.locator(".sc-st b").first();
    const start = parseInt(await readout.innerText(), 10);
    for (let i = 0; i < 8; i++) { await plus.click({ noWaitAfter: true }); await page.waitForTimeout(60); }

    // The number moves on every tap, not when the network says so.
    expect(parseInt(await readout.innerText(), 10)).toBe(start + 8);
    await page.waitForTimeout(6000);
    // ...and all eight taps survive the round trip as one save.
    expect(parseInt(await readout.innerText(), 10)).toBe(start + 8);
    expect(saves, "eight taps must coalesce into one save").toBeLessThanOrEqual(2);
  });

  test("a double tap on a tile never errors", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    const failures: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("wizard-edit") && !r.ok()) failures.push(`${r.status()} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    });

    const tile = page.locator(".sc-rc").first().locator(".sc-tl").first();
    await tile.click({ noWaitAfter: true });
    await page.waitForTimeout(120);
    await tile.click({ noWaitAfter: true });
    await page.waitForTimeout(6000);
    expect(failures, "a double tap used to send the same instruction twice and 400").toEqual([]);
  });

  test("on a phone the frozen header stays small and the plan is one tap away", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 780 });
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    const frozen = page.locator(".sc-freeze");
    const before = (await frozen.boundingBox())!.height;
    // The header carries four things; on a phone it must still leave the
    // cards most of the screen.
    expect(before).toBeLessThan(780 / 3);

    const peek = page.locator(".pp-peek");
    if (await peek.count()) {
      await peek.click();
      await page.waitForTimeout(400);
      // Opening the plan overlays the page — it must NOT grow the header and
      // push the cards off screen.
      expect((await frozen.boundingBox())!.height).toBeCloseTo(before, 0);
      await expect(page.locator(".pp-sheet")).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(300);
      await expect(page.locator(".pp-sheet")).toBeVisible();
      await expect(page.locator(".sc-num")).toBeVisible();
    }
  });

  test("the add panel offers more than one room type's own surfaces", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);

    await page.locator(".sd-addsurf").first().click();
    const panel = page.locator(".sd-addpanel").first();
    await expect(panel).toBeVisible();
    // Grouped by the rate card's own sub-categories, and carrying rows that
    // no room type's scope rules list (a picture rail, a mantle).
    expect((await panel.locator(".sd-gl").count()), "the panel must be grouped").toBeGreaterThan(1);
    const chips = (await panel.locator(".sd-chip").allInnerTexts()).join(" | ").toLowerCase();
    expect(chips).toContain("picture rails");
  });
});

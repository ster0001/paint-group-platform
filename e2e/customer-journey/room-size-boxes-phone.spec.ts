import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, driveNoPlanWizard } from "./drive";

/**
 * Tom, 6 Nov 2026: "the measurement boxes for the rooms still don't line up on
 * mobile and are too big." As an anonymous customer on a 390 × 780 phone:
 *
 *   1. the Tighten editor's size row (length, width, ceiling) is ONE line of
 *      three equal boxes the full width of the room card — not two boxes beside
 *      the drawing with the ceiling wrapped underneath — and no box is taller
 *      than 44px;
 *   2. on the quote stage's "How big is …?" card the three boxes share a top
 *      edge and the grey "typical" note sits below them, never over them.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const suburb = `E2E Sizes ${run}`;

test.describe("room size boxes on a phone", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  const box = (page: Page, testId: string) => page.getByTestId(testId).evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; });

  /** The range on the phone, the door, the details sheet; answers the estimate id. */
  const toTheStage = async (page: Page) => {
    await driveNoPlanWizard(page, { suburb, bedrooms: 2, stopAtReveal: true });
    await page.getByTestId("gate-bar-exact").tap();
    // the gate already took the details, so the door opens the stage straight away; a details sheet (range first) is filled when it comes
    const sheet = page.getByTestId("talk-sheet");
    await expect(sheet.or(page.getByTestId("quote-stage")).or(page.locator(".sc-r").first())).toBeVisible({ timeout: 60_000 });
    if (await sheet.count()) {
      await page.getByTestId("talk-name").fill("Size Tester");
      await page.getByTestId("talk-email").fill(`sizes.${run}@example.com`);
      await page.getByTestId("talk-mobile").fill(`04${String(Date.now()).slice(-8)}`);
      await page.getByTestId("talk-go").tap();
    }
    await page.waitForURL(/\/estimate\/(quote|scope)\?id=/, { timeout: 60_000 });
    return new URL(page.url()).searchParams.get("id")!;
  };

  test("the Tighten editor's three boxes sit in one line, full width, not too tall", async ({ page }) => {
    test.setTimeout(240_000);
    const id = await toTheStage(page);
    await page.goto(`/estimate/scope?id=${id}`);
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 60_000 });
    const first = page.locator(".sc-rc[data-room]").first();
    const areaId = (await first.getAttribute("data-room"))!;
    await expect(first.getByTestId(`size-length-${areaId}`)).toBeVisible();
    const card = await first.locator(".il-first").evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; });
    const [l, w, h] = await Promise.all([box(page, `size-length-${areaId}`), box(page, `size-width-${areaId}`), box(page, `size-height-${areaId}`)]);
    // one line
    expect(Math.abs(l.top - w.top)).toBeLessThan(1);
    expect(Math.abs(w.top - h.top)).toBeLessThan(1);
    // three equal boxes across the card, in order
    expect(Math.abs(l.width - w.width)).toBeLessThan(1);
    expect(Math.abs(w.width - h.width)).toBeLessThan(1);
    expect(l.left).toBeLessThan(w.left);
    expect(w.left).toBeLessThan(h.left);
    expect(h.right).toBeLessThanOrEqual(card.right + 0.5);
    expect(h.right - l.left).toBeGreaterThan((card.right - card.left) * 0.8);
    // not too tall
    expect(l.height).toBeLessThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // the boxes still save on the way out (Tom, 28 Oct)
    await page.getByTestId(`size-width-${areaId}`).fill("3.8");
    await page.getByTestId(`size-width-${areaId}`).blur();
    await expect(first.getByTestId(`size-inline-${areaId}`)).toContainText("3.8 m", { timeout: 30_000 });
  });

  test("the quote stage's measure card: boxes level, the typical note under them", async ({ page }) => {
    test.setTimeout(240_000);
    await toTheStage(page);
    if (!/\/estimate\/quote/.test(page.url())) test.skip(true, "quote stage v10 is off in this environment");
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 20; i++) {
      await expect(stage).toHaveAttribute("data-busy", "0", { timeout: 60_000 });
      const id = (await stage.getAttribute("data-quote-card"))!;
      if (id.startsWith("measure:")) break;
      const opt = page.locator("[data-testid^='q-card-'] button").first();
      if (await opt.count()) await opt.tap(); else await page.getByTestId("q-next").tap();
      await expect.poll(() => stage.getAttribute("data-quote-card"), { timeout: 30_000 }).not.toBe(id);
    }
    await expect(page.getByTestId("q-measure")).toBeVisible();
    const [w, l, h] = await Promise.all([box(page, "q-measure-w"), box(page, "q-measure-l"), box(page, "q-measure-h")]);
    expect(Math.abs(w.top - l.top)).toBeLessThan(1);
    expect(Math.abs(l.top - h.top)).toBeLessThan(1);
    const meas = await box(page, "q-measure");
    const note = await box(page, "q-typical-note");
    expect(note.top).toBeGreaterThanOrEqual(meas.bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

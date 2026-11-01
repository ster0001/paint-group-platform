import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, driveMobileQuickLook, openQuickLook, fillQuickAddress } from "./drive";

/**
 * QUOTE STAGE v10 — session 1, the skeleton (`docs/briefs/claude-code-brief-quote-stage-v10.md`
 * §2 mobile, §3 A + B1, §7; prototype `design/reference/wizard-quote-stage-v10-prototype.html`),
 * as an ANONYMOUS customer at 390 × 780 with touch, on the Paint Group host.
 *
 * Behind `NEXT_PUBLIC_QUOTE_STAGE_V10=1`: the phone gate's door reads "Get my
 * detailed price" and opens `/estimate/quote`; the whole-house cards come one
 * question at a time with the door and window drawings, single choices
 * advancing themselves; then one measure card per room — typed numbers over
 * greyed typicals, "That's the size" or "Not sure — use the typical"; then
 * a done screen with the range (never one number), which rooms stayed
 * typical, and "Book <estimator> to confirm it". Nothing says "exact".
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 === "1";
const db = serviceClient();

test.describe("quote stage v10 — session 1: the cards on a phone", () => {
  test.skip(!FLAG_ON, "quote stage v10 is off in this environment (NEXT_PUBLIC_QUOTE_STAGE_V10)");
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Q10 ${run}`;
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });
  const card = (page: Page, id: string) => expect(page.getByTestId("quote-stage")).toHaveAttribute("data-quote-card", id, { timeout: 15_000 });

  test("the gate's door, the whole-house cards in order with drawings, a measure card per room, the done screen", async ({ page }) => {
    test.setTimeout(300_000);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/wizard/event")) {
        try { events.push(JSON.parse(req.postData() ?? "{}") as { type: string; payload: Record<string, unknown> }); } catch { /* not json */ }
      }
    });
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await driveMobileQuickLook(page, { suburb, bedrooms: 2, colour: "same", condition: "good" });
    await expect(page.locator("[data-mobile-screen='details']")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("gate-name").fill("Quote Tester");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`q10.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    // R1 / D-Q2: the door's words
    await expect(page.getByTestId("gate-exact")).toContainText("Get my detailed price");
    await expect(page.getByTestId("gate-bar-exact")).toHaveText("Get my detailed price");
    await expect(gate).not.toContainText(/exact/i);
    await page.getByTestId("gate-bar-exact").tap();
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 30_000 });
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toBeVisible({ timeout: 30_000 });
    // A — the whole-house cards, one question each, in the brief's order; single choices advance themselves
    await card(page, "g:cornices");
    await expect(page.getByTestId("q-stage")).toHaveText("A few things first");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Do you have cornices?");
    await expect(page.getByTestId("q-card-cornices").locator("button")).toHaveCount(3);
    const bar0 = await page.getByTestId("wzm-bar").evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(bar0).toBeGreaterThanOrEqual(55);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // §5 (S2) — the quote tile, the inline panel with the document (draft; every line "—" and typical), the band at 0% settled
    await expect(page.getByTestId("q-tile-title")).toHaveText(/^Quote · \d+ to go$/);
    await expect(page.getByTestId("q-tile-sub")).toHaveText(/^~\d+ min · tap to see$/);
    await expect(page.getByTestId("q-panel")).toHaveAttribute("data-open", "0");
    await page.getByTestId("q-tile-quote").tap();
    await expect(page.getByTestId("q-panel")).toHaveAttribute("data-open", "1");
    const doc = page.getByTestId("q-doc");
    await expect(doc).toHaveAttribute("data-title", "Draft quote");
    await expect(page.getByTestId("q-doc-title")).toHaveText(/^Draft quote · PG-[0-9A-F]{6}$/);
    await expect(doc).toContainText("Valid 30 days · Includes GST");
    await expect(page.getByTestId("q-doc-for")).toContainText("Quote Tester");
    await expect(page.getByTestId("q-doc-for")).toContainText(`q10.${run}@example.com`);
    const lines = doc.locator("[data-testid^='q-line-']:not([data-testid$='-amount'])");
    expect(await lines.count()).toBeGreaterThan(2);
    await expect(lines.first()).toHaveAttribute("data-state", "todo");
    await expect(lines.first()).toContainText("(typical)");
    await expect(lines.first().locator(".amt")).toHaveText("—");
    await expect(page.getByTestId("q-doc-subtotal")).toContainText(MONEY_RANGE);
    await expect(page.getByTestId("q-doc-gst")).toContainText(MONEY_RANGE);
    await expect(page.getByTestId("q-doc-total")).toContainText("Your range");
    const panelBox = (await page.getByTestId("q-panel").boundingBox())!;
    expect(panelBox.height, "the panel takes at most a third of the screen").toBeLessThanOrEqual(780 / 3 + 2);
    await expect(page.getByTestId("wzm-h1")).toBeInViewport();
    await expect(page.getByTestId("q-band-settled")).toHaveText(/closing in · \d+% settled/);
    const settled0 = Number(await page.getByTestId("q-band").getAttribute("data-settled"));
    await page.getByTestId("q-tile-quote").tap();
    await expect(page.getByTestId("q-panel")).toHaveAttribute("data-open", "0");
    await page.getByTestId("q-opt-cornices-standard").tap();
    await card(page, "g:height");
    await page.getByTestId("q-opt-height-2.7").tap();
    await card(page, "g:doors");
    await expect(page.getByTestId("q-card-doors").locator("button")).toHaveCount(2);
    await expect(page.getByTestId("q-opt-doors-panel").locator("svg")).toHaveCount(1);
    await page.getByTestId("q-opt-doors-panel").tap();
    await card(page, "g:windows");
    await expect(page.getByTestId("q-card-windows").locator("button")).toHaveCount(4);
    await expect(page.getByTestId("q-opt-windows-sash").locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("q-opt-windows-sash")).toContainText("Slides up and down");
    await page.getByTestId("q-opt-windows-sash").tap();
    await card(page, "g:paintBase");
    await page.getByTestId("q-opt-paintBase-water").tap();
    await card(page, "g:glossTrims");
    await page.getByTestId("q-opt-glossTrims-no").tap();
    await card(page, "g:cleared");
    await page.getByTestId("q-opt-cleared-yes").tap();
    await card(page, "g:stairwell");
    await page.getByTestId("q-opt-stairwell-no").tap();
    await card(page, "g:parking");
    await page.getByTestId("q-opt-parking-drive").tap();
    // Back keeps the answer pre-selected
    await expect(stage).toHaveAttribute("data-quote-card", /^measure:/, { timeout: 15_000 });
    await page.getByTestId("wzm-back").tap();
    await card(page, "g:parking");
    await expect(page.getByTestId("q-opt-parking-drive")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("q-opt-parking-drive").tap();
    // B1 — the measure cards: typical greyed, typing marks measured; Not sure keeps the typical
    await expect(stage).toHaveAttribute("data-quote-card", /^measure:/, { timeout: 15_000 });
    await expect(page.getByTestId("q-stage")).toContainText(/· 1 of \d+/);
    await expect(page.getByTestId("wzm-h1")).toContainText(/^How big is /);
    const w = page.getByTestId("q-measure-w");
    const typicalW = await w.getAttribute("placeholder");
    expect(Number(typicalW)).toBeGreaterThan(0);
    await expect(page.getByTestId("q-measure")).toHaveAttribute("data-measured", "0");
    await expect(page.getByTestId("q-typical-note")).toContainText(/typical for this room/);
    await w.fill("4");
    await page.getByTestId("q-measure-l").fill("3.5");
    await expect(page.getByTestId("q-typical-note")).toHaveCount(0);
    await page.getByTestId("q-size-ok").tap();
    await expect(page.getByTestId("q-stage")).toContainText(/· 2 of \d+/, { timeout: 30_000 });
    // §5 (S2) — the measured room's line now carries its amount and no "(typical)"; the band has moved on; the tile counts one fewer
    const firstId = (await page.getByTestId("quote-stage").getAttribute("data-quote-card"))!;
    await page.getByTestId("q-tile-quote").tap();
    const measuredLine = page.locator("[data-testid^='q-line-'][data-state='measured']").first();
    await expect(measuredLine).toBeVisible();
    await expect(measuredLine).not.toContainText("(typical)");
    await expect(measuredLine.locator(".amt")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("q-thumb").locator("[data-state='measured']")).toHaveCount(1);
    expect(Number(await page.getByTestId("q-band").getAttribute("data-settled"))).toBeGreaterThan(settled0);
    await page.getByTestId("q-tile-quote").tap();
    expect(firstId).toMatch(/^measure:/);
    // back: the first room now reads measured
    await page.getByTestId("wzm-back").tap();
    await expect(page.getByTestId("q-stage")).toContainText(/· 1 of \d+/);
    await expect(page.getByTestId("q-measure")).toHaveAttribute("data-measured", "1");
    await expect(page.getByTestId("q-measure-w")).toHaveAttribute("placeholder", "4");
    await page.getByTestId("q-size-ok").tap();
    await expect(page.getByTestId("q-stage")).toContainText(/· 2 of \d+/, { timeout: 30_000 });
    // the rest: Not sure — use the typical size for now
    for (let i = 0; i < 12; i++) {
      const id = await stage.getAttribute("data-quote-card");
      if (id === "done") break;
      await page.getByTestId("q-size-typical").tap();
      await expect.poll(() => stage.getAttribute("data-quote-card"), { timeout: 30_000 }).not.toBe(id);
    }
    await card(page, "done");
    // F — the done screen: a range, never one number; the typical rooms named; no "exact" / "±"; the one door
    await expect(page.getByTestId("gate-label")).toHaveText("Your detailed price");
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("gate-fine")).toContainText(/at the typical size/);
    await expect(page.getByTestId("gate-fine")).toContainText(/confirmed on the day/);
    await expect(page.getByTestId("gate-tiles").locator("li").nth(1)).toContainText("Your detailed price");
    // §5 (S2) — the quote in full on the done screen: every line settled → "Quote", "Your price", still a range
    const doneDoc = page.getByTestId("q-done-doc").getByTestId("q-doc");
    await expect(doneDoc).toHaveAttribute("data-title", "Quote");
    await expect(doneDoc.getByTestId("q-doc-total")).toContainText("Your price");
    await expect(doneDoc.getByTestId("q-doc-total")).toContainText(MONEY_RANGE);
    await expect(doneDoc.locator("[data-testid^='q-line-'][data-state='todo']")).toHaveCount(0);
    expect(await stage.innerText()).not.toMatch(/exact|±|within \d+%/i);
    expect(await page.getByTestId("wzm-bar").evaluate((el) => parseFloat((el as HTMLElement).style.width))).toBe(100);
    await expect(page.getByTestId("q-book")).toContainText(/Book .+ to confirm it/);
    // Contact from a card
    await page.getByTestId("wzm-contact").tap();
    await expect(page.getByTestId("wzm-contact-sheet")).toBeVisible();
    await expect(page.getByTestId("wzm-contact-book")).toContainText("Book a visit");
    await page.keyboard.press("Escape");
    // §7 — the events
    const types = events.map((e) => e.type);
    expect(types).toContain("quote_stage_viewed");
    expect(events.filter((e) => e.type === "quote_card_answered").length).toBeGreaterThanOrEqual(10);
    expect(events.some((e) => e.type === "quote_line_settled" && e.payload.state === "measured")).toBe(true);
    expect(events.some((e) => e.type === "quote_line_settled" && e.payload.state === "typical")).toBe(true);
    expect(types).toContain("quote_stage_done");
    // the door
    await page.getByTestId("q-book").tap();
    await expect(page).toHaveURL(/\/estimate\/visit\?id=/, { timeout: 30_000 });
    expect(events.map((e) => e.type)).toContain("quote_book_clicked");
  });
});

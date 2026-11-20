import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { fillQuickAddress, gateDoor, openQuickLook, passOtpIfShown, quickNext } from "./drive";

/**
 * Go-live brief Session 5 — the quote adds up, and copy (H1, H3, H5, M8–M12; D4, D5, D7), as an anonymous customer on
 * a PHONE (390 × 780), then the same quote on a laptop:
 *   · M8  — "Going much lighter, or a bold colour?" follows New colours (and Still deciding), never Same colours;
 *   · H5  — "Will the rooms be cleared?" → Yes changes the range by $0;
 *   · H1  — on the finished quote every room line plus Set-up and preparation plus Cleaning adds to the Subtotal, low and
 *           high, to the dollar, and Subtotal + GST is the range; the rows say their GST basis;
 *   · D5  — the validity line is the Settings number (never a typed 30);
 *   · M12 — the done line starts "Tap a room to measure it" and names only the rooms still at the typical size;
 *   · M11 — on a laptop the right rail carries the room grid, and a settled quote reads "All settled".
 * H3 (coat words = badge), M9 (hall doors) and M10 (step counter, Online now) are unit-tested.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
const SHOTS = process.env.GO_LIVE_SHOTS_DIR ?? "";
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" }); } };
const db = serviceClient();
/** "$1,234 – $5,678" → [1234, 5678]. */
const money = (s: string): [number, number] => { const m = s.replace(/[^\d–]/g, "").split("–").map(Number); return [m[0], m[1] ?? m[0]]; };

test.describe("Go-live S5 — the quote adds up, and copy", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E S5 ${run}`;
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 20_000 });
  const cardId = (page: Page) => page.getByTestId("quote-stage").getAttribute("data-quote-card");
  const settle = (page: Page) => expect(page.getByTestId("quote-stage")).toHaveAttribute("data-busy", "0", { timeout: 60_000 });
  const band = async (page: Page): Promise<[number, number]> => {
    const b = page.getByTestId("q-band");
    return [Number(await b.getAttribute("data-lo")), Number(await b.getAttribute("data-hi"))];
  };

  test("M8 bold on the phone · H5 cleared is $0 · H1 the quote adds up · D5 validity from Settings · M12 done line · M11 laptop rail", async ({ page }) => {
    test.setTimeout(420_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-2").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await quickNext(page);
    await at(page, "rooms");
    await quickNext(page);
    // M8 — New colours asks the bold question; Same colours does not
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "bold");
    await expect(page.locator("#wzm-h1")).toHaveText("Going much lighter, or a bold colour?");
    await expect(page.getByTestId("ql-bold")).toHaveAttribute("role", "group");
    await shot(page, "01-bold");
    await page.getByTestId("wzm-back").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-same").tap();
    await at(page, "condition");
    await expect(page.locator("[data-mobile-screen='bold']")).toHaveCount(0);
    await page.getByTestId("wzm-back").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "bold");
    await page.getByTestId("ql-bold-yes").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-good").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    // the details and the code, then the gate's door into the stage
    await at(page, "details");
    await page.getByTestId("gate-name").fill("Sam Lee");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s5.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    await passOtpIfShown(page);
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await gateDoor(page).tap();
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 30_000 });

    // Every card: the typical size for each room (so M12 has rooms to name), the first answer to each whole-house question —
    // except "cleared", which proves H5 on the way through.
    let clearedChecked = false;
    for (let i = 0; i < 60; i++) {
      await settle(page);
      const id = (await cardId(page))!;
      if (id === "done") break;
      if (id === "g:cleared") {
        const before = await band(page);
        await page.getByTestId("q-opt-cleared-yes").tap();
        await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
        await settle(page);
        await page.waitForTimeout(1_500); // the band tweens after an answer
        const after = await band(page);
        expect(after, "H5 — rooms cleared changes the price by $0").toEqual(before);
        clearedChecked = true;
        continue;
      }
      if (id.startsWith("measure:")) await page.getByTestId("q-size-typical").tap();
      else if (id.startsWith("robe:")) await page.getByTestId("q-robe-none").tap();
      else if (id.startsWith("g:")) await page.locator('[data-testid^="q-opt-"]').first().tap();
      else await page.getByTestId("q-next").tap();
      await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
    }
    expect(clearedChecked, "the cleared card was asked").toBe(true);
    await settle(page);
    expect(await cardId(page)).toBe("done");
    await shot(page, "02-done");

    // M12 — the instruction first, and only the rooms still at the typical size (every room here)
    await expect(page.getByTestId("gate-fine")).toContainText(/^Tap a room to measure it — /);
    // D5 — the validity line is Settings' number, whatever it is, never a typed figure
    const doc = page.getByTestId("q-done-doc");
    await expect(doc).toContainText(/Valid \d+ days · Includes GST/);
    // H1 — the lines add to the Subtotal, low and high, to the dollar; Subtotal + GST = the total; the basis is said
    await expect(doc.getByTestId("q-xline-prep")).toContainText("Set-up and preparation");
    await expect(doc.getByTestId("q-xline-cleaning")).toContainText("Cleaning");
    await expect(doc.getByTestId("q-doc-subtotal")).toContainText("Subtotal · ex GST");
    const amounts = await doc.locator("[data-testid^='q-line-'][data-testid$='-amount'], [data-testid^='q-xline-'][data-testid$='-amount']").allInnerTexts();
    expect(amounts.length).toBeGreaterThanOrEqual(3);
    for (const a of amounts) expect(a, "every line settled carries an amount").not.toBe("—");
    const [subLo, subHi] = money(await doc.getByTestId("q-doc-subtotal").locator(".amt").innerText());
    const [gstLo, gstHi] = money(await doc.getByTestId("q-doc-gst").locator(".amt").innerText());
    const [totLo, totHi] = money(await doc.getByTestId("q-doc-total").locator(".amt").innerText());
    const sum = amounts.map(money);
    expect(sum.reduce((n, [lo]) => n + lo, 0), "lines add to the Subtotal (low)").toBe(subLo);
    expect(sum.reduce((n, [, hi]) => n + hi, 0), "lines add to the Subtotal (high)").toBe(subHi);
    expect(subLo + gstLo, "Subtotal + GST = total (low)").toBe(totLo);
    expect(subHi + gstHi, "Subtotal + GST = total (high)").toBe(totHi);
    await shot(page, "03-quote");

    // M11 — the same quote on a laptop: the rail's room grid, every room in it, and "All settled"
    await page.setViewportSize({ width: 1470, height: 900 });
    await page.reload();
    await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const grid = page.getByTestId("q-rail-rooms");
    await expect(grid).toBeVisible();
    const tiles = grid.locator("[data-testid^='q-rail-room-']");
    expect(await tiles.count()).toBe(await page.getByTestId("q-rail-quote").locator("[data-testid^='q-line-']:not([data-testid$='-amount'])").count());
    await expect(tiles.first()).toHaveAttribute("data-state", "typical");
    await expect(page.getByTestId("q-rail-quote-toggle")).toContainText("All settled");
    await shot(page, "04-laptop-rail");
    // Tom, 20 Nov 2026 — Contact on a laptop is a side sheet with every row readable (it drew as one big bubble), and the
    // finished quote always carries "Send us a message": the talk sheet's message box, which posts into the office's live chat
    await page.getByTestId("wzm-contact").click();
    const panel = page.getByTestId("wzm-contact-panel");
    await expect(panel).toBeVisible();
    const look = await panel.evaluate((el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return { radius: parseFloat(c.borderTopLeftRadius), pad: parseFloat(c.paddingLeft), width: r.width, right: r.right, vw: window.innerWidth }; });
    expect(look.radius, "square side sheet, not a bubble").toBeLessThanOrEqual(30);
    expect(look.pad).toBeGreaterThanOrEqual(18);
    expect(look.width).toBeLessThanOrEqual(480);
    expect(Math.round(look.right), "docked to the right edge").toBe(look.vw);
    for (const id of ["wzm-contact-who", "wzm-contact-book", "wzm-contact-message"]) {
      const box = await panel.getByTestId(id).boundingBox();
      expect(box && box.x >= look.right - look.width && box.x + box.width <= look.right, `${id} sits inside the sheet`).toBe(true);
    }
    await shot(page, "05-laptop-contact");
    await expect(panel.getByTestId("wzm-contact-message")).toContainText("Send us a message");
    await panel.getByTestId("wzm-contact-message").click();
    await expect(page.getByTestId("wzm-contact-sheet")).toHaveCount(0);
    await expect(page.getByTestId("talk-sheet")).toHaveAttribute("aria-label", "Send us a message");
    await expect(page.getByTestId("talk-message"), "the details are known, so the message box comes first").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("talk-sheet")).toHaveCount(0);
    // a tile opens that room's size card
    await tiles.first().click();
    await expect.poll(() => cardId(page), { timeout: 30_000 }).toMatch(/^measure:/);
  });
});

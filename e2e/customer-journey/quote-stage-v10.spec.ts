import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { readFileSync } from "node:fs";
import { MONEY_RANGE, driveMobileQuickLook, driveNoPlanWizard, openQuickLook, fillQuickAddress } from "./drive";
/** D-Q5: `lib/wizard/spotPhoto.ts SPOT_PHOTO_MAX_BYTES` (not imported — that module loads the browser client). */
const SPOT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * QUOTE STAGE v10 — session 1, the skeleton (`docs/briefs/claude-code-brief-quote-stage-v10.md`
 * §2 mobile, §3 A + B1, §7; prototype `design/reference/wizard-quote-stage-v10-prototype.html`),
 * as an ANONYMOUS customer at 390 × 780 with touch, on the Paint Group host.
 *
 * Behind `NEXT_PUBLIC_QUOTE_STAGE_V10=1`: the phone gate's door reads "Get my
 * quote range" and opens `/estimate/quote`; the whole-house cards come one
 * question at a time with the door and window drawings, single choices
 * advancing themselves; then one measure card per room — typed numbers over
 * greyed typicals, "That's the size" or "Not sure — use the typical"; then
 * a done screen with the range (never one number), which rooms stayed
 * typical, and "Book <estimator> to confirm it". Nothing says "exact".
 *
 * Session 3 (§3 B2–B4, E, F): after each room's size — what we're painting
 * in here (chips with counts, scope and sizes), robes and cupboards (No
 * advances; Yes asks the loop's own two questions), anything needing
 * attention (tags, how much, a photo of the spot — D-Q5 limits); then
 * "Have we got every room?" (the list, + Add a room opening on its size
 * card, the doors-and-windows check) and "Anything we haven't listed?";
 * the done screen names the customer and a typical line taps back to its
 * size card.
 *
 * Session 4 (§4, R5): the room tile beside the quote tile — the one room
 * drawing, redrawn with every answer: an added door appears as its own
 * swept layer, S / M / L resizes, an unticked cornice is not drawn, the
 * robe and its doors render, a crack shows its mark; the sheet draws the
 * same picture full width.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
/** S7: the proof run writes the stage's screenshots here when set (docs/wizard-quote-stage/). */
const SHOTS = process.env.QUOTE_SHOTS_DIR ?? "";
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" }); } };
const db = serviceClient();

test.describe("quote stage v10 — session 1: the cards on a phone", () => {
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment (NEXT_PUBLIC_QUOTE_STAGE_V10=0)");
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
  const cardId = (page: Page) => page.getByTestId("quote-stage").getAttribute("data-quote-card");
  /** Pass one card the quickest honest way: typical size, Next, No robe, nothing to fix, every room, Next. */
  const passCard = async (page: Page) => {
    const id = (await cardId(page))!;
    if (id.startsWith("measure:")) await page.getByTestId("q-size-typical").tap();
    else if (id.startsWith("robe:")) await page.getByTestId("q-robe-none").tap();
    else await page.getByTestId("q-next").tap();
    await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
  };
  const passUntil = async (page: Page, stop: (id: string) => boolean) => {
    for (let i = 0; i < 60; i++) {
      const id = (await cardId(page))!;
      if (stop(id)) return;
      await passCard(page);
    }
    throw new Error("never reached the card");
  };

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
    await expect(page.getByTestId("gate-exact")).toContainText("Get my quote range");
    await expect(page.getByTestId("gate-bar-exact")).toHaveText("Get my quote range");
    await shot(page, "phone-00-gate");
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
    await shot(page, "phone-01-general");
    const bar0 = await page.getByTestId("wzm-bar").evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(bar0).toBeGreaterThanOrEqual(55);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // §5 (S2) — the quote tile, the inline panel with the document (draft; every line "—" and typical), the band at 0% settled
    await expect(page.getByTestId("q-tile-title")).toHaveText(/^Quote · \d+ to go$/);
    await expect(page.getByTestId("q-tile-sub")).toHaveText(/^~\d+ min · tap to see$/);
    await expect(page.getByTestId("q-panel")).toHaveAttribute("data-open", "0");
    await expect(page.getByTestId("q-tile-plan"), "no plan uploaded → no plan tile (R6)").toHaveCount(0);
    await page.getByTestId("q-tile-quote").tap();
    await expect(page.getByTestId("q-panel")).toHaveAttribute("data-open", "1");
    await shot(page, "phone-02-quote-open");
    const doc = page.getByTestId("q-panel").getByTestId("q-doc"); // the desktop rail holds a second copy, hidden on a phone
    await expect(doc).toHaveAttribute("data-title", "Draft quote");
    await expect(doc.getByTestId("q-doc-title")).toHaveText(/^Draft quote · PG-[0-9A-F]{6}$/);
    await expect(doc).toContainText("Valid 30 days · Includes GST");
    await expect(doc.getByTestId("q-doc-for")).toContainText("Quote Tester");
    await expect(doc.getByTestId("q-doc-for")).toContainText(`q10.${run}@example.com`);
    const lines = doc.locator("[data-testid^='q-line-']:not([data-testid$='-amount'])");
    expect(await lines.count()).toBeGreaterThan(2);
    await expect(lines.first()).toHaveAttribute("data-state", "todo");
    await expect(lines.first()).toContainText("(typical)");
    await expect(lines.first().locator(".amt")).toHaveText("—");
    await expect(doc.getByTestId("q-doc-subtotal")).toContainText(MONEY_RANGE);
    await expect(doc.getByTestId("q-doc-gst")).toContainText(MONEY_RANGE);
    await expect(doc.getByTestId("q-doc-total")).toContainText("Your range");
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
    await shot(page, "phone-03-measure");
    await expect(page.getByTestId("q-typical-note")).toContainText(/typical for this room/);
    await w.fill("4");
    await page.getByTestId("q-measure-l").fill("3.5");
    await expect(page.getByTestId("q-typical-note")).toHaveCount(0);
    await page.getByTestId("q-size-ok").tap();
    // S3: the size card is followed by this room's three other cards — "What we're painting in here" first
    await expect(stage).toHaveAttribute("data-quote-card", /^surfaces:/, { timeout: 30_000 });
    await expect(page.getByTestId("q-stage")).toContainText(/· 1 of \d+/);
    // §5 (S2) — the measured room's line now carries its amount and no "(typical)"; the band has moved on; the tile counts one fewer
    const firstId = (await cardId(page))!;
    await page.getByTestId("q-tile-quote").tap();
    const measuredLine = page.getByTestId("q-panel").locator("[data-testid^='q-line-'][data-state='measured']").first();
    await expect(measuredLine).toBeVisible();
    await expect(measuredLine).not.toContainText("(typical)");
    await expect(measuredLine.locator(".amt")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("q-thumb").locator("[data-state='measured']")).toHaveCount(1);
    expect(Number(await page.getByTestId("q-band").getAttribute("data-settled"))).toBeGreaterThan(settled0);
    await page.getByTestId("q-tile-quote").tap();
    expect(firstId).toMatch(/^surfaces:/);
    const firstArea = Number(firstId.split(":")[1]);
    // back: the first room now reads measured
    await page.getByTestId("wzm-back").tap();
    await card(page, `measure:${firstArea}`);
    await expect(page.getByTestId("q-measure")).toHaveAttribute("data-measured", "1");
    await expect(page.getByTestId("q-measure-w")).toHaveAttribute("placeholder", "4");
    // B1 (S3): the room photo control, with the D-Q5 size limit enforced before anything is sent
    await expect(page.getByTestId("q-room-photo-label")).toContainText("Add a photo of the room");
    await page.getByTestId("q-room-photo").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(SPOT_PHOTO_MAX_BYTES + 1) });
    await expect(page.getByTestId("q-photo-error")).toContainText("over 5 MB");
    await page.getByTestId("q-size-ok").tap();
    await card(page, `surfaces:${firstArea}`);
    // B2 — what we're painting in here: the tiles as chips; doors + → 2; the door scope and the window key
    await expect(page.getByTestId("wzm-h1")).toHaveText("What we’re painting in here");
    // §4 (S4) — the room tile: the drawing from the room's own state (cornices were answered Standard)
    const stageRoom = (await page.getByTestId("q-stage").innerText()).split(" · ")[0]; // the stage line is upper-cased by CSS
    expect((await page.getByTestId("q-tile-room-name").innerText()).toLowerCase()).toBe(stageRoom.toLowerCase());
    const pic = page.getByTestId("q-room-pic");
    await expect(pic).toHaveAttribute("data-quote", "true");
    await expect(pic.locator("[data-surf='cornices']")).toHaveCount(1);
    await expect(pic.locator("[data-surf='walls']")).toHaveAttribute("data-on", "true");
    const picDoors = Number(await pic.getAttribute("data-doors"));
    expect(picDoors).toBeGreaterThan(0);
    await expect(pic.locator("[data-kind='door']")).toHaveCount(picDoors);
    await shot(page, "phone-04-surfaces");
    const chips = page.getByTestId("q-surfaces").locator("button.wzm-chip");
    expect(await chips.count()).toBeGreaterThan(3);
    await expect(page.getByTestId("q-surf-walls")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("q-walls-share-100")).toHaveClass(/sel/);
    const doorsBefore = Number(await page.getByTestId("q-count-doors").locator("b").innerText());
    await page.getByTestId("q-count-doors").getByRole("button", { name: "More" }).tap();
    await expect(page.getByTestId("q-count-doors").locator("b")).toHaveText(String(doorsBefore + 1), { timeout: 30_000 });
    // §4 (S4) — the added door is drawn at once as its own layer, swept to full; untick cornices → not drawn; L → resized
    await expect(pic.locator("[data-kind='door']")).toHaveCount(doorsBefore + 1);
    await expect.poll(() => pic.locator(`[data-surf='door-${doorsBefore}'] rect.cprect`).getAttribute("width"), { timeout: 5_000 }).toBe("200");
    await page.getByTestId("q-surf-cornices").tap();
    await expect(page.getByTestId("q-surf-cornices")).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await expect(pic.locator("[data-surf='cornices']")).toHaveCount(0);
    const sizeL = page.locator("[data-testid^='q-win-size-'][data-testid$='-L']").first();
    if (await sizeL.count()) {
      await sizeL.tap();
      await expect(pic).toHaveAttribute("data-win-size", "L", { timeout: 30_000 });
    }
    // the sheet draws the same picture full width
    await page.getByTestId("q-tile-room").tap();
    await expect(page.getByTestId("q-room-sheet")).toBeVisible();
    await expect(page.getByTestId("q-room-bigpic-pic")).toHaveAttribute("data-doors", String(doorsBefore + 1));
    await expect(page.getByTestId("q-room-cap")).toContainText("Updates as you answer");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("q-room-sheet")).toHaveCount(0);
    await expect(page.getByTestId("q-win-key")).toContainText("S under 50 × 50 cm");
    await page.getByTestId("q-add-surface").tap();
    await expect(page.getByTestId("q-add-panel")).toBeVisible();
    await page.getByTestId("q-add-surface").tap();
    await page.getByTestId("q-next").tap();
    await expect(stage).toHaveAttribute("data-quote-card", new RegExp(`^(robe|attention):${firstArea}$`), { timeout: 30_000 });
    // B3 — robes and cupboards (only where the loop offers a row): Yes opens the loop's own questions
    if ((await cardId(page)) === `robe:${firstArea}`) {
      await expect(page.getByTestId("wzm-h1")).toContainText("robes or cupboards");
      await page.getByTestId("q-robe-yes").tap();
      await expect(page.getByTestId("q-robe-more")).toBeVisible();
      await page.getByTestId("q-robe-doors-yes").tap();
      await expect(page.getByTestId("q-robe-doors-yes")).toHaveAttribute("aria-pressed", "true");
      // §4 (S4) — the robe and its doors render on the right wall
      await expect(page.getByTestId("q-room-pic").locator("[data-surf='robedoors']")).toHaveAttribute("data-on", "true", { timeout: 30_000 });
      await page.getByTestId("q-next").tap();
    }
    await card(page, `attention:${firstArea}`);
    // B4 — anything needing attention: a crack, patches here and there, a photo of the spot (the real upload path), Add it
    await expect(page.getByTestId("wzm-h1")).toHaveText("Anything needing attention?");
    await expect(page.getByTestId("q-next")).toHaveText("Nothing to fix — next");
    await page.getByTestId("q-prep-crack").tap();
    await expect(page.getByTestId("q-prep-extent")).toBeVisible();
    await shot(page, "phone-05-attention");
    await page.getByTestId("q-prep-extent-patches").tap();
    await page.getByTestId("q-prep-photo").setInputFiles("e2e/fixtures/condition-photo.png");
    await expect(page.getByTestId("q-prep-photo-label")).toContainText("Photo added", { timeout: 90_000 });
    await page.getByTestId("q-prep-add").tap();
    await expect(stage).toHaveAttribute("data-quote-card", /^measure:/, { timeout: 30_000 });
    // back: the crack is noted on the room, removable; nothing picked → "Nothing to fix — next"
    await page.getByTestId("wzm-back").tap();
    await card(page, `attention:${firstArea}`);
    await expect(page.getByTestId("q-spots-noted")).toContainText(/crack/i);
    // §4 (S4) — the crack shows its mark on the drawing
    await expect(page.getByTestId("q-room-pic").locator("[data-prep='crack']")).toHaveCount(1);
    await page.getByTestId("q-next").tap();
    // the rest of the rooms: the typical size, Next, No robe, nothing to fix — until the last checks
    await passUntil(page, (id) => id === "rooms");
    // E1 — have we got every room? the list, the doors-and-windows check, + Add a room → its size card
    await expect(page.getByTestId("wzm-h1")).toHaveText("Have we got every room?");
    await shot(page, "phone-06-rooms");
    const listed = await page.getByTestId("q-rooms").locator("li").count();
    expect(listed).toBeGreaterThan(2);
    await expect(page.getByTestId("q-dw")).toContainText(/\d+ doors? and \d+ windows? across the house/);
    await page.getByTestId("q-dw-yes").tap();
    await page.getByTestId("q-add-room").tap();
    const study = page.getByTestId("q-room-type-study");
    if (await study.count()) await study.tap(); else await page.getByTestId("q-add-room-panel").locator("button.wzm-chip").first().tap();
    await page.getByTestId("q-room-name").fill("Study");
    await page.getByTestId("q-add-room-go").tap();
    await expect(stage).toHaveAttribute("data-quote-card", /^measure:/, { timeout: 30_000 });
    await expect(page.getByTestId("q-stage")).toContainText("Study");
    await passUntil(page, (id) => id === "rooms");
    await expect(page.getByTestId("q-rooms").locator("li")).toHaveCount(listed + 1);
    await expect(page.getByTestId("q-rooms")).toContainText("Study");
    await page.getByTestId("q-next").tap();
    await card(page, "extras");
    // E2 — anything we haven't listed? a priced extra (where the rate card offers one), help with colours, a note
    await expect(page.getByTestId("wzm-h1")).toHaveText("Anything we haven’t listed?");
    const extra = page.getByTestId("q-extras").locator("button[data-testid^='q-extra-']:not([data-testid='q-extra-colour'])").first();
    if (await extra.count()) {
      await expect(extra).toContainText(/\$\d/);
      await extra.tap();
      await expect(extra).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    }
    await page.getByTestId("q-extra-colour").tap();
    await expect(page.getByTestId("q-extra-colour")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await page.getByTestId("q-extra-note").fill("The ceiling rose in the hall");
    await page.getByTestId("q-next").tap();
    await card(page, "done");
    // F — the done screen: a range, never one number; the typical rooms named; no "exact" / "±"; the one door
    await expect(page.getByTestId("gate-label")).toHaveText("Quote, your quote range");
    await shot(page, "phone-07-done");
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("gate-fine")).toContainText(/at the typical size/);
    await expect(page.getByTestId("gate-fine")).toContainText(/Repairs in 1 room are allowed for and confirmed on the day/);
    await expect(page.getByTestId("gate-tiles").locator("li").nth(1)).toContainText("Your quote range");
    // §5 (S2) — the quote in full on the done screen: every line settled → "Quote", "Your price", still a range
    const doneDoc = page.getByTestId("q-done-doc").getByTestId("q-doc");
    await expect(doneDoc).toHaveAttribute("data-title", "Quote");
    await expect(doneDoc.getByTestId("q-doc-total")).toContainText("Your price");
    await expect(doneDoc.getByTestId("q-doc-total")).toContainText(MONEY_RANGE);
    await expect(doneDoc.locator("[data-testid^='q-line-'][data-state='todo']")).toHaveCount(0);
    expect(await stage.innerText()).not.toMatch(/exact|±|within \d+%/i);
    // F (S3): a typical line taps back to that room's size card; measure it and come back through its cards
    const typicalLine = doneDoc.locator("[data-testid^='q-line-'][data-state='typical']").first();
    const typicalArea = (await typicalLine.getAttribute("data-testid"))!.replace("q-line-", "");
    await typicalLine.tap();
    await card(page, `measure:${typicalArea}`);
    await page.getByTestId("q-measure-w").fill("3.6");
    await page.getByTestId("q-measure-l").fill("3.1");
    await page.getByTestId("q-size-ok").tap();
    await passUntil(page, (id) => id === "done");
    await expect(page.getByTestId("q-done-doc").getByTestId(`q-line-${typicalArea}`)).toHaveAttribute("data-state", "measured");
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
    expect(events.some((e) => e.type === "quote_photo_added" && e.payload.kind === "prep")).toBe(true);
    expect(events.some((e) => e.type === "quote_card_answered" && e.payload.card === "attention")).toBe(true);
    // the door
    await page.getByTestId("q-book").tap();
    await expect(page).toHaveURL(/\/estimate\/visit\?id=/, { timeout: 30_000 });
    expect(events.map((e) => e.type)).toContain("quote_book_clicked");
  });
});

/**
 * Session 5 (R6, D-Q1): the plan tile shows only when a floorplan was
 * uploaded, and its sheet is the plan image with the ticked room list —
 * the plan read returns no room positions, so the list is the tap-to-jump.
 * A plan is uploaded on the desktop quick look's place screen (the phone
 * shell has no upload), then the stage is opened at phone width.
 */
test.describe("quote stage v10 — session 5: the plan tile", () => {
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment (NEXT_PUBLIC_QUOTE_STAGE_V10=0)");
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Q10P ${run}`;
  const planPaths: string[] = [];
  test.afterAll(async () => {
    if (!db) return;
    if (planPaths.length) await db.storage.from("estimate-sources").remove(planPaths);
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  test("no plan → no tile; with a plan → the tile, the sheet with the image and the ticked rooms, tap-to-jump", async ({ page }) => {
    test.setTimeout(300_000);
    // the desktop quick look to its range (the shared drive fills the gate), then the desktop door (the old editor this release) for the id
    await driveNoPlanWizard(page, { suburb, stopAtReveal: true, contactName: "Plan Tester", email: `q10p.${run}@example.com` });
    await page.getByTestId("door-tighten").click();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
    const id = new URL(page.url()).searchParams.get("id")!;
    // a plan ON FILE: the fixtures are not readable plans (the reader refuses them and the submit fails), so the plan is put on
    // file the way the upload route leaves it — the image in the bucket and its `estimate_sources` row — through the service client
    const path = `e2e/${run}/plan.png`;
    const { error: upErr } = await db!.storage.from("estimate-sources").upload(path, readFileSync("e2e/fixtures/not-a-plan-a.png"), { contentType: "image/png", upsert: true });
    expect(upErr, upErr?.message).toBeNull();
    const { error: rowErr } = await db!.from("estimate_sources").insert({ estimate_id: id, kind: "floorplan", storage_path: path, page_no: 1, mime_type: "image/png", page_class: "floorplan_interior" });
    expect(rowErr, rowErr?.message).toBeNull();
    planPaths.push(path);
    // the stage at phone width, on the same session
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/estimate/quote?id=${id}`);
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("q-tile-plan")).toBeVisible();
    await expect(page.getByTestId("q-tile-plan").locator("img")).toHaveAttribute("src", /./);
    await page.getByTestId("q-tile-plan").click();
    await expect(page.getByTestId("q-plan-sheet")).toBeVisible();
    await expect(page.getByTestId("q-plan-viewer").locator("img")).toBeVisible();
    await expect(page.getByTestId("q-plan-cap")).toHaveText("Your floorplan. Tap a room to jump to it.");
    const planRooms = page.getByTestId("q-plan-rooms").locator("li");
    expect(await planRooms.count()).toBeGreaterThan(1);
    await expect(planRooms.first()).toHaveAttribute("data-state", "todo");
    // tap a room → its size card; the sheet closes
    const target = planRooms.nth(1);
    const targetId = (await target.getAttribute("data-testid"))!.replace("q-plan-room-", "");
    await target.locator("button").click();
    await expect(page.getByTestId("q-plan-sheet")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-quote-card", `measure:${targetId}`, { timeout: 15_000 });
    // measure it → the plan list ticks it
    await page.getByTestId("q-measure-w").fill("3.4");
    await page.getByTestId("q-measure-l").fill("3.1");
    await page.getByTestId("q-size-ok").click();
    await expect(stage).toHaveAttribute("data-quote-card", `surfaces:${targetId}`, { timeout: 30_000 });
    await page.getByTestId("q-tile-plan").click();
    await expect(page.getByTestId(`q-plan-room-${targetId}`)).toHaveAttribute("data-state", "measured");
    await expect(page.getByTestId(`q-plan-room-${targetId}`).locator(".tick")).toHaveText("✓");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("q-plan-sheet")).toHaveCount(0);
  });
});

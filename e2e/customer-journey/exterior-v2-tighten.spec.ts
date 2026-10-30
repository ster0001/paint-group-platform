import { test, expect, type Page } from "@playwright/test";
import { lookAtEverySide, passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Exterior wizard v2 — Tighten my price (Tom, 21 Oct 2026, items 7–14). As an
 * anonymous customer on the drawn house:
 *
 *  - 8 · Tighten opens the CUSTOMER EDITOR, not a walk-around step;
 *  - 9 · "A few questions first" glows until it is answered;
 *  - 10 · the paintwork answers show what each looks like;
 *  - 11 · the access question is asked, after the paintwork and the rot;
 *  - 7 · with the questions answered and every side's size confirmed the
 *    range closes to within a few percent — never the wide guide band;
 *  - 12 · a side's new width is the run of its fascias, gutters and eaves;
 *  - 13 + 14 · under the windows: the sizes in words, and "+ Add a different
 *    sized window" in plain sight.
 *
 * Retired here (ruling: item 8): the walk-around step's tiles, counts, size
 * question, Check this side, See my range and the Change a side door.
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

async function toEditor(page: Page) {
  await toSides(page, "cal", ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors"]);
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-tier")).toHaveAttribute("data-tier", "guide");
  await expect(page.getByTestId("door-tighten")).toContainText(/Side by side/);
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
}

const bandPct = async (page: Page) => Number(((await page.getByTestId("range-width").first().textContent()) ?? "").replace(/[^\d]/g, ""));

async function answerQuestions(page: Page) {
  const q = page.getByTestId("sides-q");
  await q.getByRole("button", { name: "Good overall", exact: true }).click();
  await expect(q.getByTestId("sides-q-step-rot")).toBeVisible({ timeout: 30_000 });
  await q.getByRole("button", { name: "No, looks solid", exact: true }).click();
  await expect(q.getByTestId("sides-q-step-acc")).toBeVisible({ timeout: 30_000 });
  await q.getByRole("button", { name: /None of these/ }).click();
  await expect(q).toHaveClass(/done/, { timeout: 30_000 });
}

test("Tighten opens the customer editor; A few questions first glows, shows what each paintwork answer looks like, and asks the paintwork, the rot AND the access", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page);
  await expect(page.getByTestId("ext-walk")).toHaveCount(0);
  const q = page.getByTestId("sides-q");
  await expect(q).toHaveAttribute("data-side", "cond");
  await expect(q).not.toHaveClass(/done/);
  // 9 · the glow is the card's own animation until it is done.
  expect(await q.evaluate((el) => getComputedStyle(el).animationName)).toBe("sd-glow");
  // 10 · three swatches, one an answer.
  await expect(q.getByTestId("sides-q-step-cond")).toBeVisible();
  await expect(q.locator(".sd-chip-art")).toHaveCount(3);
  // 11 · paintwork → rot → access, all three asked.
  await answerQuestions(page);
  expect(await q.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(q.getByTestId("sides-q-settled")).toContainText(/nothing tricky about access/);
});

test("every side's size confirmed closes the range to within a few percent; the width flows to the trims; the window sizes in words and a visible way to add a different size", async ({ page }) => {
  test.setTimeout(300_000);
  await toEditor(page);
  const wide = await bandPct(page);
  expect(wide).toBeGreaterThanOrEqual(8);
  await answerQuestions(page);
  for (const k of ["front", "right", "back", "left"]) {
    const card = page.locator(`[data-side="${k}"]`);
    await card.locator(".sd-hd").click();
    const dims = card.getByTestId(`side-dims-${k}`);
    await dims.locator("input").nth(0).fill("12");
    await dims.locator("input").nth(1).fill("3");
    await dims.locator("input").nth(1).blur(); // Tom, 28 Oct 2026: saves on blur, no Update button
    await expect(card.getByTestId(`side-assumed-${k}`)).toContainText(/Recorded: 12 m long × 3 m high/, { timeout: 30_000 });
    if (k === "front") {
      // 12 · the fascias, gutters and eaves now run 12 m — the side's width is
      // WRITTEN into every lineal row's metres box (21 Oct, f63b59d6), not
      // merely suggested as its placeholder.
      const metres = card.locator("[data-testid^='side-metres-front-']");
      await expect(metres.first()).toHaveValue("12");
      // 13 + 14 · the sizes in words, and the add-a-size button under the windows.
      await expect(card.locator(".sd-whint").first()).toContainText(/under 50 × 50 cm/);
      const groups = card.locator(".sd-wseg");
      const before = await groups.count();
      await card.getByTestId("side-add-window-front").click();
      await expect(groups).toHaveCount(before + 1, { timeout: 30_000 });
    }
    const confirm = card.locator(".sd-confirm");
    if (await confirm.count()) { await confirm.first().click(); await expect(card).toHaveClass(/done/, { timeout: 30_000 }); }
  }
  // 7 · the band is a few percent now, not the guide's.
  await expect.poll(() => bandPct(page), { timeout: 30_000 }).toBeLessThanOrEqual(8);
  expect(await bandPct(page)).toBeLessThan(wide);
});

/**
 * EXTERIOR ON MOBILE v5 — session 6 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screen 12; prototype `w-*` / `wdone`), as an ANONYMOUS customer at
 * 390 × 780 with touch. Under 768px "Get my exact price" on an outside job
 * is THE WALK-AROUND: one screen per painted side with the house turned to
 * it — the window and door counts, the size (Looks right · Adjust it · Not
 * sure), how the paint is holding up on this side, and Check this side,
 * which waits for the size answer. Every side checked → "See my exact
 * price" → the gate reads as the exact-price stage: "your exact price",
 * "Book <estimator> to confirm it", "change a side", the side rows open.
 * The desktop keeps the editor (the tests above).
 */
test.describe("on a phone: Tighten is the walk-around, one screen per side (exterior mobile v5, session 6)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const run = Math.random().toString(16).slice(2, 8);
  /** Outside → a bungalow with walls, gable, fascias, eaves, windows, doors → the gate. */
  const toGate = async (page: Page) => {
    const { openQuickLook, fillQuickAddress, MONEY_RANGE } = await import("./drive");
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: `E2E S6 Walk ${run}` });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-cal").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "p-house");
    for (const p of ["walls", "gable", "fascias", "eaves"]) await page.getByTestId(`ext-part-${p}`).tap();
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    for (const p of ["windows", "doors"]) await page.getByTestId(`ext-part-${p}`).tap();
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    await page.getByTestId("ql-next").tap();
    await at(page, "a-walls");
    await page.getByTestId("ext-mat-weatherboards").tap();
    await at(page, "a-gable");
    await page.getByTestId("ext-gable-stucco").tap();
    await at(page, "a-win");
    await page.getByTestId("ql-ext-win-casement").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    for (const s of ["s-front", "s-right", "s-back", "s-left"]) { await at(page, s); await page.getByTestId("ql-next").tap(); }
    await at(page, "details");
    await page.getByTestId("gate-name").fill("Six Walker");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s6.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(gate).toHaveAttribute("data-variant", "exact");
  };

  test("Get my exact price → the walk: counts, size, condition per side, Check this side waits for the size; all four checked → See my exact price → the gate as the exact-price stage, change a side", async ({ page }) => {
    test.setTimeout(240_000);
    await toGate(page);
    const thumb = page.getByTestId("wzm-thumb").locator("svg.wz-elev");
    await page.getByTestId("gate-bar-exact").tap();
    // the front: the house turned to it, the tabs, the counts, the size question, the condition; the bar waits for the size
    await at(page, "w-front");
    await expect(page.getByTestId("ext-walk")).toBeVisible();
    await expect(page.getByTestId("wzm-stage")).toHaveText("Tighten · walk around");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Front");
    await expect(page.getByTestId("wzm-sub")).toContainText(/m across · \d+(\.\d)? m high/);
    await expect(thumb).toHaveAttribute("data-side", "front");
    await expect(page.getByTestId("wzm-side-front")).toHaveAttribute("data-state", "now");
    await expect(page.getByTestId("ext-win-n")).toBeVisible();
    await expect(page.getByTestId("ext-door-n")).toHaveText("1");
    await page.getByTestId("ext-door-plus").tap();
    await expect(page.getByTestId("ext-door-n")).toHaveText("2");
    await expect(page.getByTestId("ext-check-side")).toBeDisabled();
    await expect(page.getByTestId("ext-check-why")).toContainText(/Answer the size first/);
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    await page.getByTestId("ext-cond-good").tap();
    await page.getByTestId("ext-size-yes").tap();
    await expect(page.getByTestId("ext-check-side")).toBeEnabled();
    await expect(page.getByTestId("ext-walk-progress")).toHaveText("0 of 4 sides checked");
    await page.getByTestId("ext-check-side").tap();
    // the right side: checked front ticks; Adjust it opens the steppers and changes the size line
    await at(page, "w-right");
    await expect(thumb).toHaveAttribute("data-side", "right");
    await expect(page.getByTestId("wzm-side-front")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Front ✓ · Right · Back · Left");
    await expect(page.getByTestId("ext-walk-progress")).toHaveText("1 of 4 sides checked");
    await page.getByTestId("ext-size-adj").tap();
    await expect(page.getByTestId("ext-size-adjust")).toBeVisible();
    const before = await page.getByTestId("wzm-sub").textContent();
    await page.getByTestId("ext-dim-w-plus").tap();
    await expect(page.getByTestId("wzm-sub")).not.toHaveText(before ?? "");
    await expect(page.getByTestId("ext-size-tag")).toContainText("your numbers");
    await page.getByTestId("ext-cond-weathered").tap();
    await page.getByTestId("ext-check-side").tap();
    // the back and the left: Not sure keeps the typical; the done screen
    await at(page, "w-back");
    await page.getByTestId("ext-size-ns").tap();
    await page.getByTestId("ext-cond-good").tap();
    await page.getByTestId("ext-check-side").tap();
    await at(page, "w-left");
    await page.getByTestId("ext-size-yes").tap();
    await page.getByTestId("ext-cond-peeling").tap();
    await page.getByTestId("ext-check-side").tap();
    await at(page, "w-done");
    await expect(page.getByTestId("ext-walk-done")).toContainText("All 4 sides checked");
    await expect(page.getByTestId("wzm-bar")).toHaveAttribute("style", /width: 100%/);
    // See my exact price: the house re-priced; the gate as the exact-price stage
    await page.getByTestId("ext-see-range").tap();
    const gate = page.getByTestId("wzm-gate");
    await expect(gate).toBeVisible({ timeout: 90_000 });
    await expect(gate).toHaveAttribute("data-variant", "tightened");
    await expect(page.getByTestId("gate-label")).toContainText(/your exact price/);
    await expect(page.getByTestId("gate-basis")).toContainText("Every side checked.");
    await expect(page.getByTestId("gate-book")).toContainText(/Book .+ to confirm it/);
    await expect(page.getByTestId("gate-change-side")).toContainText("change a side");
    await expect(page.getByTestId("gate-tiles").locator("li").nth(1)).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("gate-tiles").locator("li").nth(2)).toHaveAttribute("data-state", "now");
    await expect(page.getByTestId("gate-included")).toHaveAttribute("data-open", "1");
    await expect(page.getByTestId("ext-range-front")).toContainText(/checked/);
    await expect(page.getByTestId("ext-range-right")).toContainText(/weathered/);
    await expect(page.getByTestId("gate-bar-book")).toBeVisible();
    await expect(page.getByTestId("gate-exact")).toHaveCount(0);
    const text = await gate.innerText();
    expect(text).not.toMatch(/±|within \d+%|Guide ·|Detailed/);
    // change a side: back into the walk, on the front, still checked; the back chevron returns to the price
    await page.getByTestId("gate-change-side").tap();
    await at(page, "w-front");
    await expect(page.getByTestId("ext-check-side")).toContainText("Checked ✓");
    await page.getByTestId("wzm-back").tap();
    await expect(gate).toBeVisible();
  });
});

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
    await dims.getByRole("button", { name: "Update" }).click();
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

import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, fillQuickAddress, openQuickLook, openScopeEditor, passGateIfShown, quickNext } from "./drive";

/**
 * Tom, 25 Oct 2026 — the wizard batch, driven as an anonymous customer:
 *   1  the place step offers a floorplan only — no listing link;
 *   2  the groups ticked as going much lighter or bold paint DEEP BLUE in the room picture;
 *   3  the guide range is never wider than its low end plus 40% (6000–10000 → 6000–8400),
 *      and a bold job still gets the Tighten door;
 *   4  nothing on the tighten screen asks about dark to light again (dark-to-light.spec.ts);
 *   5  every cupboard question starts as No — robe doors included;
 *   6  "paint inside the cupboard" is asked on its own, with the doors a No;
 *   7–10 the spots panel (room-spots.spec.ts);
 *   11 the room's NAME is the rename control — no pencil;
 *   12–16 the extras sheet: air vent $50, no picture rails, no imported custom surface;
 *   13 the air vent's count moves from the sheet's − / +, and the whole-job extras block is
 *      never drawn as a room card (that card's + was the "crashes on 1");
 *   17 the measurements are IN the size question as boxes — retype, Update size.
 */

const parseRange = (text: string) => {
  const m = text.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/);
  return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
};

test("1 + 2 + 3 · floorplan only, deep-blue bold walls, a capped guide range with the Tighten door", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  // 1 · the place step: a floorplan, and nothing about a listing.
  await expect(page.getByTestId("ql-plan")).toBeVisible();
  await expect(page.getByTestId("ql-plan")).toContainText(/Have a floorplan\?/);
  await expect(page.getByTestId("ql-plan-listing")).toHaveCount(0);
  await expect(page.getByTestId("ql-plan")).not.toContainText(/listing/i);
  await page.getByTestId("ql-bedrooms-3").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='job']")).toBeVisible();

  // 2 · bold on the walls → the walls paint deep blue; the ceilings do not.
  const pic = page.getByTestId("pic-room");
  await expect(pic).toHaveAttribute("data-bold-count", "0");
  await page.getByTestId("ql-bold-yes").click();
  await page.getByTestId("ql-bold-which-walls").click();
  await expect(pic).toHaveAttribute("data-bold-count", "1");
  await expect(pic.locator("[data-s='walls']").first()).toHaveAttribute("data-bold", "1");
  await expect(pic.locator("[data-s='ceilings']").first()).toHaveAttribute("data-bold", "0");
  await expect(page.getByTestId("ql-picture-note")).toContainText(/Deep blue/);
  // The fill really is the deep blue, once the paint transition has run.
  await expect.poll(async () => page.evaluate(() => {
    const el = document.querySelector("[data-testid='pic-room'] [data-s='walls']");
    return el ? getComputedStyle(el).fill : null;
  }), { timeout: 5_000 }).toBe("rgb(31, 58, 147)");
  // Untick it and the blue goes.
  await page.getByTestId("ql-bold-which-walls").click();
  await expect(pic).toHaveAttribute("data-bold-count", "0");
  await page.getByTestId("ql-bold-which-walls").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await page.getByTestId("ql-condition-wear").click();
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });

  // 3 · the guide range is capped at the low end + 40%, and a bold job still has the Tighten door.
  const range = parseRange(await page.getByTestId("reveal-range").innerText())!;
  expect(range).not.toBeNull();
  expect(range.hi).toBeLessThanOrEqual(Math.ceil((range.lo * 1.4) / 10) * 10);
  expect(range.hi).toBeGreaterThan(range.lo);
  await expect(page.getByTestId("door-tighten")).toBeVisible();
});

test("5 + 6 + 11 + 17 · cupboards start No with the inside asked on its own, the name renames, the size is typed in the question", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const cards = page.locator(".sc-rc[data-room]");
  const first = cards.first();
  const areaId = (await first.getAttribute("data-room"))!;

  // 11 · no pencil anywhere; the name is a button that opens the rename box.
  await expect(page.locator(".sc-pen")).toHaveCount(0);
  await first.getByTestId(`room-rename-btn-${areaId}`).click();
  await first.getByLabel("Room name").fill("Nursery");
  await first.getByLabel("Room name").press("Enter");
  await expect(first.getByTestId(`room-rename-btn-${areaId}`)).toHaveText("Nursery", { timeout: 30_000 });

  // 17 · the first card is open; its size boxes are prefilled and there is no "Adjust it".
  await expect(first.getByRole("button", { name: /Adjust it/ })).toHaveCount(0);
  const length = first.getByTestId(`size-length-${areaId}`);
  const width = first.getByTestId(`size-width-${areaId}`);
  await expect(length).toHaveValue(/^\d+(\.\d+)?$/);
  await expect(width).toHaveValue(/^\d+(\.\d+)?$/);
  await expect(first.getByTestId(`size-ok-${areaId}`)).toBeVisible();
  const before = await page.locator(".sc-r").first().innerText();
  await width.fill("3.8");
  // Tom, 28 Oct 2026: typing shows the "saves when you click out" line; clicking out saves — no Update size button.
  await expect(first.getByTestId(`size-saving-hint-${areaId}`)).toBeVisible();
  await expect(first.getByTestId(`size-save-${areaId}`)).toHaveCount(0);
  await width.blur();
  await expect(page.locator(".sc-toast")).toContainText(/3.8 m.*repriced/, { timeout: 30_000 });
  await expect(first.getByTestId(`size-inline-${areaId}`)).toContainText("3.8 m");
  await expect(first.getByTestId(`size-inline-${areaId}`)).toContainText("updated by you");
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  expect(await page.locator(".sc-r").first().innerText()).not.toBe(before);
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE);

  // 5 · a bedroom's robe doors start as NO (the 7 Oct default had them Yes) — and the
  // 6 · "walls inside the robe" question is there with the doors a No.
  const robe = first.locator(".il-cup").filter({ hasText: /robe doors\?/ });
  await expect(robe).toHaveClass(/\bok\b/);
  await expect(robe.getByRole("button", { name: "No", exact: true })).toHaveClass(/\bon\b/);
  const inside = first.getByTestId(`cup-interior-${areaId}`);
  await expect(inside).toBeVisible();
  await expect(inside).toContainText(/inside the built-in robe/);
  await inside.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(inside).toHaveClass(/\bok\b/, { timeout: 30_000 });
  await expect(page.locator(".sc-toast")).toContainText(/inside the robes/i);
  // The robe doors stay a No — the two answers are independent now.
  await expect(robe.getByRole("button", { name: "No", exact: true })).toHaveClass(/\bon\b/);

  // Every other room with a cupboard question also starts answered No.
  const n = await cards.count();
  for (let i = 1; i < n; i++) {
    const card = cards.nth(i);
    await card.locator(".sc-hd .il-pill").click();
    const cups = card.locator(".il-cup").filter({ hasText: /REQUIRED/ });
    for (let c = 0, m = await cups.count(); c < m; c++) {
      await expect(cups.nth(c)).toHaveClass(/\bok\b/);
      await expect(cups.nth(c).getByRole("button", { name: "No", exact: true })).toHaveClass(/\bon\b/);
    }
  }
});

test("12 + 13 + 15 + 16 · the extras sheet: air vent $50 with its own − / +, no picture rails, no imported row, no extras room card", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const card = page.getByTestId("extras-card");
  await card.scrollIntoViewIfNeeded();
  const vent = page.getByTestId("extra-air-vent");
  await expect(vent).toContainText(/Air vent · \$50$/);
  await expect(card.locator("[data-testid^='extra-']").filter({ hasText: /picture rail/i })).toHaveCount(0);
  await expect(card.locator("[data-testid^='extra-']").filter({ hasText: /custom surface/i })).toHaveCount(0);

  const roomsBefore = await page.locator(".sc-rc[data-room]").count();
  const before = await page.locator(".sc-r").first().innerText();
  await vent.click();
  await expect(vent).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  const one = await page.locator(".sc-r").first().innerText();
  expect(one).not.toBe(before);
  // 13 · the whole-job extras block is NOT a room card.
  await expect(page.locator(".sc-rc[data-room]")).toHaveCount(roomsBefore);
  await expect(page.locator(".sc-rc").filter({ hasText: /Interior - Extras/ })).toHaveCount(0);
  // 13 · the count moves from the sheet — two vents price more than one, and the reload agrees.
  const stepper = page.getByTestId("extra-count-air-vent");
  await expect(stepper.locator("b")).toHaveText("1");
  await stepper.getByRole("button", { name: /more/ }).click();
  await expect(stepper.locator("b")).toHaveText("2");
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".sc-toast")).toContainText(/Air Vent ×2/, { timeout: 30_000 });
  const two = page.locator(".sc-r").first();
  await expect(two).toHaveText(MONEY_RANGE);
  expect(parseRange(await two.innerText())!.hi).toBeGreaterThan(parseRange(one)!.hi);
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("extra-count-air-vent").locator("b")).toHaveText("2");
  await expect(page.getByTestId("extra-air-vent")).toContainText(/× 2/);
});

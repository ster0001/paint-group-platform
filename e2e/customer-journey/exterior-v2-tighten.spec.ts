import { test, expect, type Page } from "@playwright/test";
import { passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Exterior wizard v2 — S5: Tighten, the detailed range and the editor after
 * it (brief §7.6, §7.7; gate spec for S5). As an anonymous customer with the
 * `exteriorV2` flag ON:
 *
 *  - Tighten my price opens the walk around the house (the same four tiles,
 *    the picture turned to the side, the compass), not the editor;
 *  - per side: the counts (defaults from the width), the size tagged Typical
 *    for a …, Looks right / Adjust it / Not sure, the condition; Check this
 *    side waits for the size answer (11), turns the tile and moves on;
 *  - a change un-checks; the done card appears when the last side is checked;
 *  - See my range re-prices on the drawn house: the range reads Detailed,
 *    every side's row is marked checked, the Tighten door reads Change a side
 *    and Book a site visit is primary (⚑ 14);
 *  - Change anything else opens the sides editor with the adjusted size and
 *    the condition already answered — nothing re-asked (§7.7).
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
test.skip(!FLAG_ON, "exteriorV2 is off in this environment — set NEXT_PUBLIC_EXTERIOR_V2=1 on the test project");

async function toWalk(page: Page) {
  await toSides(page, "cal", ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors"]);
  for (let i = 0; i < 4 && !(await page.getByTestId("ext-sides-done").count()); i++) await page.getByTestId("ext-confirm-side").click();
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-tier")).toHaveAttribute("data-tier", "guide");
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.getByTestId("ext-walk")).toBeVisible({ timeout: 30_000 });
}

const picture = (page: Page) => page.getByTestId("ql-picture").getByTestId("pic-outside");
const tile = (page: Page, k: string) => page.getByTestId(`ext-side-${k}`);

test("the walk: tiles and compass, counts, the size question gates Check this side, a change un-checks, the done card", async ({ page }) => {
  test.setTimeout(240_000);
  await toWalk(page);
  await expect(page.getByRole("heading", { name: "Walk around the house" })).toBeVisible();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "cur");
  await expect(picture(page)).toHaveAttribute("data-side", "front");
  await expect(page.getByTestId("ext-compass-front")).toHaveAttribute("data-state", "cur");
  // Counts default from the width; the size is the typical.
  await expect(page.getByTestId("ext-win-n")).toHaveText(/^\d+$/);
  await expect(page.getByTestId("ext-door-n")).toHaveText("1");
  await expect(page.getByTestId("ext-size-tag")).toHaveText(/Typical for a californian bungalow/i);
  await expect(page.getByTestId("ext-check-side")).toBeDisabled();
  await expect(page.getByTestId("ext-check-why")).toContainText(/Answer the size first/);
  await expect(page.getByTestId("ext-see-range")).toBeDisabled();
  // Adjust it: 0.5 m steps across, the tag reads Your numbers, the picture narrows.
  const wallWidth = async () => Number(await picture(page).locator(".e[data-e='walls'] rect").first().getAttribute("width"));
  const before = await wallWidth();
  await page.getByTestId("ext-size-adj").click();
  await expect(page.getByTestId("ext-size-adjust")).toBeVisible();
  await page.getByTestId("ext-dim-w-minus").click();
  await page.getByTestId("ext-dim-w-minus").click();
  await expect(page.getByTestId("ext-size-tag")).toHaveText("Your numbers");
  expect(await wallWidth()).toBeLessThan(before);
  await page.getByTestId("ext-win-plus").click();
  await page.getByTestId("ext-cond-good").click();
  await expect(page.getByTestId("ext-check-side")).toBeEnabled();
  await page.getByTestId("ext-check-side").click();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "ok");
  await expect(tile(page, "right")).toHaveAttribute("data-state", "cur");
  await expect(page.getByTestId("ext-walk-progress")).toContainText("1 of 4");
  // A change on a checked side un-checks it.
  await tile(page, "front").click();
  await page.getByTestId("ext-win-minus").click();
  await expect(tile(page, "right")).toHaveAttribute("data-state", "todo");
  await tile(page, "right").click();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "todo");
  await tile(page, "front").click();
  await page.getByTestId("ext-check-side").click();
  // The rest: Looks right + a condition each; Not sure on the left keeps the typical.
  for (const k of ["right", "back"]) {
    await expect(tile(page, k)).toHaveAttribute("data-state", "cur");
    await page.getByTestId("ext-size-yes").click();
    await page.getByTestId(k === "back" ? "ext-cond-peeling" : "ext-cond-good").click();
    await page.getByTestId("ext-check-side").click();
  }
  await expect(page.getByTestId("ext-walk-done")).toHaveCount(0);
  await page.getByTestId("ext-size-ns").click();
  await page.getByTestId("ext-cond-good").click();
  await page.getByTestId("ext-check-side").click();
  await expect(page.getByTestId("ext-walk-done")).toContainText("All 4 sides checked");
  await expect(page.getByTestId("ext-see-range")).toBeEnabled();
});

test("See my range: Detailed, every row checked, Change a side, the visit primary; the editor opens with nothing re-asked", async ({ page }) => {
  test.setTimeout(300_000);
  await toWalk(page);
  // Front adjusted to 10 m, every side checked, the back peeling.
  await page.getByTestId("ext-size-adj").click();
  for (let i = 0; i < 2; i++) await page.getByTestId("ext-dim-w-minus").click();
  await expect(page.getByTestId("ext-dim-w-n")).toHaveText("10 m");
  await page.getByTestId("ext-cond-good").click();
  await page.getByTestId("ext-check-side").click();
  for (const k of ["right", "back", "left"]) {
    await expect(tile(page, k)).toHaveAttribute("data-state", "cur");
    await page.getByTestId("ext-size-yes").click();
    await page.getByTestId(k === "back" ? "ext-cond-peeling" : "ext-cond-good").click();
    await page.getByTestId("ext-check-side").click();
  }
  await expect(page.getByTestId("ext-walk-done")).toBeVisible();
  await page.getByTestId("ext-see-range").click();
  await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE);
  await expect(page.getByTestId("reveal-tier")).toHaveAttribute("data-tier", "detailed");
  await expect(page.getByTestId("reveal-kicker")).toContainText(/detailed range/i);
  for (const k of ["front", "right", "back", "left"]) await expect(page.getByTestId(`ext-range-${k}`)).toContainText("checked");
  await expect(page.getByTestId("ext-range-front")).toContainText(/^Front.*10 × 3 m/);
  await expect(page.getByTestId("ext-range-back")).toContainText(/peeling/);
  await expect(page.getByTestId("door-tighten")).toContainText("Change a side");
  await expect(page.getByTestId("door-tighten")).not.toHaveAttribute("data-hero", "1");
  await expect(page.getByTestId("door-book")).toHaveAttribute("data-hero", "1");
  // The restatement now reads the worst side's condition, not the good-to-peeling spread.
  await expect(page.getByTestId("reveal-restatement")).toContainText(/peeling paintwork/);
  // Change a side goes back to the walk; Back returns to the range.
  await page.getByTestId("door-tighten").click();
  await expect(page.getByTestId("ext-walk")).toBeVisible();
  await page.getByTestId("ext-walk-back").click();
  await expect(page.getByTestId("reveal")).toBeVisible();
  // The after-range editor: the front's size is the customer's 10 × 3 and already confirmed; the condition card is answered.
  await page.getByTestId("door-editor").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await expect(front).toContainText(/Recorded: 10 m long × 3 m high/);
  // The "A few questions first" card: the paintwork and where it is peeling are already answered from the walk,
  // so the card opens on the first UNANSWERED question (the rot) — nothing re-asked (§7.7).
  await expect(page.getByTestId("sides-q")).toBeVisible();
  await expect(page.getByTestId("sides-q-step-cond")).toHaveCount(0);
  await expect(page.getByTestId("sides-q-step-peeling")).toHaveCount(0);
  await expect(page.getByTestId("sides-q-step-rot")).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";
import { passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Exterior wizard v2 — S4: the gate and the guide range (brief §7.5; gate
 * spec for S4). As an anonymous customer with the `exteriorV2` flag ON:
 *
 *  - the range reads Guide · within N% (range-width is the number alone);
 *  - one row per painted side — `w × h m · what was counted` — and one for
 *    around the house, read off the same tree the price came from; a side
 *    marked not painting is absent (5b); a gable added on one side is on
 *    that side's row only (5a);
 *  - "Not in this number" names scaffolding and rotten timber;
 *  - the doors: Tighten my price first, then Book a site visit, then Send us
 *    a message; Tighten opens the sides editor on the drawn house.
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
test.skip(!FLAG_ON, "exteriorV2 is off in this environment — set NEXT_PUBLIC_EXTERIOR_V2=1 on the test project");

async function confirmAll(page: Page) {
  for (let i = 0; i < 4; i++) {
    const btn = page.getByTestId("ext-confirm-side");
    if (!(await btn.count())) break;
    if (await page.getByTestId("ext-sides-done").count()) break;
    await btn.click();
  }
  await expect(page.getByTestId("ext-sides-done")).toBeVisible();
}

test("the guide range on a bungalow: the pill, one row per side with the gable on the right only, around the house, not in this number, the doors in order", async ({ page }) => {
  test.setTimeout(240_000);
  await toSides(page, "cal", ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"]);
  // The right side gets a gable; the left side is not painting (5a, 5b).
  await page.getByTestId("ql-ext-side-right").click();
  await page.getByTestId("ext-side-add-open").click();
  await page.getByTestId("ext-side-addpart-gable").click();
  await page.getByTestId("ql-ext-side-left").click();
  await page.getByTestId("ext-side-np").click();
  await page.getByTestId("ql-ext-side-front").click();
  await confirmAll(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.locator(".wz-rv-pill")).toContainText(/Guide · within \d+%/);
  await expect(page.getByTestId("range-width")).toHaveText(/^\d+$/);
  // The rows.
  const rows = page.getByTestId("ext-range");
  await expect(rows).toBeVisible();
  for (const k of ["front", "right", "back"]) await expect(page.getByTestId(`ext-range-${k}`)).toBeVisible();
  await expect(page.getByTestId("ext-range-left")).toHaveCount(0);
  await expect(page.getByTestId("ext-range-front")).toContainText(/\d+(\.\d)? × 3 m · walls, gable end — stucco, barge boards/);
  await expect(page.getByTestId("ext-range-front")).toContainText(/columns/);
  await expect(page.getByTestId("ext-range-right")).toContainText(/gable end — stucco/);
  await expect(page.getByTestId("ext-range-back")).toContainText(/gable end — stucco/);
  await expect(page.getByTestId("ext-range-right")).not.toContainText(/columns|verandah/);
  await expect(page.getByTestId("ext-range-extras")).toHaveCount(0);
  await expect(page.getByTestId("ext-not-in")).toContainText(/scaffolding or a lift, rotten timber replacement/);
  // The restatement reads the drawn house: three sides, no storeys guess.
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the front, right side and back/);
  // The doors, in the brief's order.
  const doors = page.locator(".wz-doors .wz-door");
  const ids = await doors.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid ?? ""));
  expect(ids.indexOf("door-tighten")).toBe(0);
  expect(ids.indexOf("door-book")).toBeGreaterThan(ids.indexOf("door-tighten"));
  expect(ids.indexOf("door-message")).toBeGreaterThan(ids.indexOf("door-book"));
  await expect(page.getByTestId("door-tighten")).toHaveAttribute("data-hero", "1");
  await expect(page.getByTestId("door-tighten")).toContainText(/side by side/);
  // Tighten opens the walk around the drawn house (S5): front, right and back to check — the left side is not painting.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.getByTestId("ext-walk")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ext-side-front")).toHaveAttribute("data-state", "cur");
  await expect(page.getByTestId("ext-side-left")).toHaveAttribute("data-state", "skip");
});

test("a townhouse in the middle of the row prices two sides; the extras get their own row; no price before the gate", async ({ page }) => {
  test.setTimeout(240_000);
  await toSides(page, "th", ["walls", "fascias", "windows"], "mid");
  // No dollar figure on the Each-side step (8).
  await expect(page.getByTestId("range-width")).toHaveCount(0);
  await expect(page.locator(".wz-quick")).not.toContainText(/\$\s?\d/);
  // A paling fence, added on the way: back to Painting, then on.
  await page.getByTestId("ql-back").click();
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ql-back").click();
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ext-extra-paling_fence").click();
  await quickNext(page);
  await page.getByTestId("ext-size-paling_fence-input").fill("20");
  await page.getByTestId("ext-size-paling_fence-input").blur();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  await confirmAll(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("ext-range-front")).toBeVisible();
  await expect(page.getByTestId("ext-range-back")).toBeVisible();
  await expect(page.getByTestId("ext-range-left")).toHaveCount(0);
  await expect(page.getByTestId("ext-range-right")).toHaveCount(0);
  await expect(page.getByTestId("ext-range-front")).toContainText(/× 5.6 m/);
  await expect(page.getByTestId("ext-range-extras")).toContainText(/paling fence/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/double storey/);
});

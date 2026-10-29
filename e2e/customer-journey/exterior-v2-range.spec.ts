import { test, expect, type Page } from "@playwright/test";
import { passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE, lookAtEverySide } from "./drive";
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

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

test("the guide range on a bungalow: the pill, one row per side with the gable on the right only, around the house, not in this number, the doors in order", async ({ page }) => {
  test.setTimeout(240_000);
  await toSides(page, "cal", ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"]);
  // The right side gets a gable; the left side is not painting (5a, 5b).
  await page.getByTestId("ql-ext-side-right").click();
  await page.getByTestId("ext-side-add-open").click();
  await page.getByTestId("ext-side-addpart-gable").click();
  await page.getByTestId("ql-ext-side-left").click();
  await page.getByTestId("ext-side-np").click();
  await lookAtEverySide(page);
  await page.getByTestId("ql-ext-side-front").click();
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
  await expect(page.getByTestId("door-tighten")).toContainText(/Side by side/);
  // 21 Oct: Tighten opens the customer editor on the drawn house — front, right and back cards; the left side is not there.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  for (const k of ["front", "right", "back"]) await expect(page.locator(`[data-side="${k}"]`)).toBeVisible();
  await expect(page.locator('[data-side="left"]')).toHaveCount(0);
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
  await lookAtEverySide(page);
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

/**
 * EXTERIOR ON MOBILE v5 — session 5 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 10–11, D-E1, D-E4; v5 brief §4), as an ANONYMOUS customer at 390 × 780
 * with touch. Under 768px an outside job's range is the v5 gate: the range in
 * mono, the basis line, ONE small-print sentence carrying the scaffolding /
 * lifts exclusion, "Want the exact number?" with "A few minutes, side by side,
 * nothing to measure", Get my exact price, "book a time with <estimator>
 * first", the three tiles, the estimator, and "What's in the range" collapsed
 * with ONE ROW PER PAINTED SIDE and one for around the house. No picture, no
 * tolerance, no tier label anywhere.
 */
test.describe("on a phone: the outside range is the v5 gate with one row per side (exterior mobile v5, session 5)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const run = Math.random().toString(16).slice(2, 8);

  test("a bungalow with the left side off and a fence: no ± or tier word, the exclusion in the small print, A few minutes, one row per painted side, the doors", async ({ page }) => {
    test.setTimeout(240_000);
    const { openQuickLook, fillQuickAddress, MONEY_RANGE } = await import("./drive");
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: `E2E S5 Gate ${run}` });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-cal").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "p-house");
    await page.getByTestId("ext-part-walls").tap();
    await page.getByTestId("ext-part-fascias").tap();
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    await page.getByTestId("ext-extra-paling_fence").tap();
    await page.getByTestId("ql-next").tap();
    await at(page, "a-walls");
    await page.getByTestId("ext-mat-weatherboards").tap();
    await at(page, "a-extras");
    await page.getByTestId("ql-next").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-front");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-right");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-back");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-left");
    await page.getByTestId("ext-side-np").tap();
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await page.getByTestId("ql-next").tap();
    // no dollar figure before the details (acceptance)
    await at(page, "details");
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    await page.getByTestId("gate-name").fill("Five Gate");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s5.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    // the v5 gate: range, basis, the one small-print sentence with the exclusion; no ±, no tier word, no picture
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("gate-basis")).toContainText(/front, right side and back|side/i);
    await expect(page.getByTestId("gate-fine")).toContainText(/not in this number: scaffolding or a lift, rotten timber replacement/);
    const text = await gate.innerText();
    expect(text).not.toMatch(/±|within \d+%|Guide ·|Detailed/);
    await expect(gate.locator("svg.wz-elev")).toHaveCount(0);
    await expect(page.getByTestId("wzm-strip")).toHaveCount(0);
    // the one question, the brief's words, the doors
    await expect(page.getByTestId("gate-block-ask")).toContainText("Want the exact number?");
    await expect(page.getByTestId("gate-block-ask")).toContainText(/A few minutes, side by side, nothing to measure\./);
    await expect(page.getByTestId("gate-exact")).toContainText("Side by side · a few minutes");
    await expect(page.getByTestId("gate-visit")).toContainText(/book a time with .+ first/);
    await expect(page.getByTestId("gate-tiles").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("gate-estimator")).toBeVisible();
    // what's in the range: collapsed, then one row per painted side (no left) and one for around the house
    const incl = page.getByTestId("gate-included");
    await expect(incl).not.toHaveAttribute("open", "");
    await incl.locator("summary").tap();
    await expect(page.getByTestId("ext-range-front")).toBeVisible();
    await expect(page.getByTestId("ext-range-right")).toBeVisible();
    await expect(page.getByTestId("ext-range-back")).toBeVisible();
    await expect(page.getByTestId("ext-range-left")).toHaveCount(0);
    await expect(page.getByTestId("ext-range-front")).toContainText(/\d+(\.\d)? × 3 m · walls/);
    await expect(page.getByTestId("ext-range-extras")).toContainText(/paling fence/);
    await expect(page.getByTestId("gate-bar-exact")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

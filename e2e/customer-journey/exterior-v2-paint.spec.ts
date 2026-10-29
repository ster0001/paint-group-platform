import { test, expect, type Page } from "@playwright/test";
import { EXTERIOR_PARTS, EXTERIOR_EXTRAS } from "../../lib/wizard/state";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Exterior wizard v2 — S3: "Tap everything we're painting" (brief §7.2;
 * gate spec for S3). As an anonymous customer with the `exteriorV2` flag ON:
 *
 *  - the Painting step follows the home step, with the four groups and the
 *    nine things around the house, nothing ticked (C8b);
 *  - a chip lights its part on the picture; tapping the picture ticks the
 *    same chip (acceptance 9); the caption names the part;
 *  - the verandah's posts, ceiling and handrail appear once the verandah is
 *    ticked and leave with it; a brick veneer home gets the bare-brick hint;
 *  - no material question here, and no dollar figure before the gate (8);
 *  - Continue needs at least one part or extra, said in words.
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

async function toPaint(page: Page, shape = "cal") {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='home']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`ql-ext-type-${shape}`).click();
  await page.getByTestId("ql-ext-size-md").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
}

const picture = (page: Page) => page.getByTestId("ql-picture").getByTestId("pic-outside");
const partOn = (page: Page, part: string) => picture(page).locator(`.e[data-e='${part}']`);

test("the groups, nothing ticked, no materials, no price — and Continue refused in words", async ({ page }) => {
  test.setTimeout(120_000);
  await toPaint(page);
  await expect(page.getByRole("heading", { name: /Tap everything we.re painting/ })).toBeVisible();
  for (const g of ["house", "roof", "open", "verandah"]) await expect(page.getByTestId(`ext-group-${g}`)).toBeVisible();
  for (const p of EXTERIOR_PARTS.filter((k) => k !== "posts" && k !== "ceiling" && k !== "handrail")) {
    await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "false");
  }
  for (const e of EXTERIOR_EXTRAS) await expect(page.getByTestId(`ext-extra-${e}`)).toHaveAttribute("aria-pressed", "false");
  // Elements before materials (brief §4): no material question on this screen.
  await expect(page.getByTestId("ext-walls-q")).toHaveCount(0);
  await expect(page.getByTestId("ext-mat")).toHaveCount(0);
  // No dollar figure before the gate (acceptance 8).
  await expect(page.getByTestId("range-width")).toHaveCount(0);
  await expect(page.locator(".sc-num")).toHaveCount(0);
  await expect(page.locator(".wz-quick")).not.toContainText(/\$\s?\d/);
  // A Californian bungalow has no bare-brick hint; nothing ticked → refused.
  await expect(page.getByTestId("ext-brick-hint")).toHaveCount(0);
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Tick at least one thing/);
});

test("a chip lights its part on the picture; a tap on the picture ticks the chip; the caption names it", async ({ page }) => {
  test.setTimeout(120_000);
  await toPaint(page);
  expect(await picture(page).locator(".e[data-on='1']").count()).toBe(0);
  await page.getByTestId("ext-part-walls").click();
  await expect(page.getByTestId("ext-part-walls")).toHaveAttribute("aria-pressed", "true");
  await expect(partOn(page, "walls")).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/The walls.*is in/);
  await expect(page.getByTestId("ql-picture")).toContainText("1 part ticked");
  // The picture is a control too: tap the fascias on the house (the event on the part itself — a forced
  // click at the box's centre can land on whatever shape overlaps it).
  await partOn(page, "fascias").dispatchEvent("click");
  await expect(page.getByTestId("ext-part-fascias")).toHaveAttribute("aria-pressed", "true");
  await expect(partOn(page, "fascias")).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("ql-picture")).toContainText("2 parts ticked");
  // And a tap on a lit part unticks it, on the chip too.
  await partOn(page, "walls").dispatchEvent("click");
  await expect(page.getByTestId("ext-part-walls")).toHaveAttribute("aria-pressed", "false");
  await expect(partOn(page, "walls")).toHaveAttribute("data-on", "0");
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/The walls.*left off/);
});

test("the verandah family appears with the verandah and leaves with it; the gable is on a gable-roof home", async ({ page }) => {
  test.setTimeout(120_000);
  await toPaint(page, "cal");
  for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveCount(0);
  await page.getByTestId("ext-part-verandah").click();
  for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toBeVisible();
  await page.getByTestId("ext-part-posts").click();
  await expect(partOn(page, "posts")).toHaveAttribute("data-on", "1");
  await page.getByTestId("ext-part-verandah").click(); // untick: the family goes with it
  for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveCount(0);
  await expect(partOn(page, "posts")).toHaveAttribute("data-on", "0");
  // The gable chip lights the bungalow's gable; the extras draw beside the house.
  await page.getByTestId("ext-part-gable").click();
  await expect(partOn(page, "gable")).toHaveAttribute("data-on", "1");
  await page.getByTestId("ext-extra-paling_fence").click();
  await expect(picture(page).locator("[data-x='paling_fence']")).toHaveCount(1);
  await expect(page.getByTestId("ql-picture")).toContainText("2 parts ticked");
});

test("a brick veneer home says tick the walls only if the brick is painted; Continue with one extra alone is allowed", async ({ page }) => {
  test.setTimeout(120_000);
  await toPaint(page, "brick");
  await expect(page.getByTestId("ext-brick-hint")).toContainText(/left bare/i);
  await page.getByTestId("ext-extra-deck").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
});

/**
 * EXTERIOR ON MOBILE v5 — session 2 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 5a–5d; prototype `design/reference/wizard-exterior-mobile-v5-prototype.html`),
 * as an ANONYMOUS customer at 390 × 780 with touch. Under 768px Painting is
 * FOUR screens with a Continue bar each: the house and its roofline (Tom, 29 Oct),
 * windows and doors, the verandah (its family once it is ticked — D-E5),
 * around the house. Nothing is pre-ticked (C8b); the last screen's Continue
 * waits for at least one part or extra overall. The roller on the drawn house
 * is `exterior-mobile-roller.spec.ts`.
 */
test.describe("on a phone: Painting is four screens (exterior mobile v5, session 2)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const toPainting = async (page: Page, shape = "cal") => {
    await openQuickLook(page);
    await fillQuickAddress(page);
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "shape");
    await page.getByTestId(`ql-ext-type-${shape}`).tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "p-house");
  };

  test("5a–5d: one group a screen under the Painting stage, nothing pre-ticked, Continue on each, the last one waiting for something ticked", async ({ page }) => {
    test.setTimeout(150_000);
    await toPainting(page);
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible();
    await expect(page.getByTestId("wzm-stage")).toHaveText("Painting");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Tap everything we're painting");
    await expect(page.getByTestId("wzm-sub")).toContainText("Walls and roofline");
    for (const p of ["walls", "gable", "fascias", "gutters", "downpipes", "eaves"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ext-part-windows")).toHaveCount(0);
    await expect(page.getByTestId("ext-brick-hint")).toHaveCount(0);
    await expect(page.getByTestId("ext-mat")).toHaveCount(0);
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // 5b — windows and doors
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Windows and doors");
    for (const p of ["windows", "doors", "garage", "shutters"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "false");
    // 5c — the verandah: a bungalow has one, so no "tick it if there is one"; its family appears with it and leaves with it
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await expect(page.getByTestId("wzm-h1")).toHaveText("The verandah");
    await expect(page.getByTestId("wzm-sub")).toHaveCount(0);
    for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveCount(0);
    await expect(page.getByTestId("ext-verandah-hint")).toBeVisible();
    await page.getByTestId("ext-part-verandah").tap();
    for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toBeVisible();
    await page.getByTestId("ext-part-posts").tap();
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("2 parts ticked · tap to see");
    await page.getByTestId("ext-part-verandah").tap();
    for (const p of ["posts", "ceiling", "handrail"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveCount(0);
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("0 parts ticked · tap to see");
    // 5d — around the house: the extras; Continue refused until something is ticked overall
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Around the house");
    for (const e of EXTERIOR_EXTRAS) await expect(page.getByTestId(`ext-extra-${e}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await page.getByTestId("ext-extra-deck").tap();
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await page.getByTestId("ext-extra-deck").tap();
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    // back to the first screen, tick the walls, forward again: Continue goes on to About it
    await page.getByTestId("wzm-back").tap();
    await at(page, "p-ver");
    await page.getByTestId("wzm-back").tap();
    await at(page, "p-win");
    await page.getByTestId("wzm-back").tap();
    await at(page, "p-house");
    await page.getByTestId("ext-part-walls").tap();
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("1 part ticked · tap to see");
    for (const id of ["p-win", "p-ver", "p-around"]) { await page.getByTestId("ql-next").tap(); await at(page, id); }
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  });

  test("a brick veneer home carries the bare-brick hint on the first screen; a weatherboard home's verandah screen says tick it if there is one", async ({ page }) => {
    test.setTimeout(120_000);
    await toPainting(page, "brick");
    await expect(page.getByTestId("ext-brick-hint")).toContainText(/left bare/i);
    await page.getByTestId("wzm-back").tap();
    await at(page, "size");
    await page.getByTestId("wzm-back").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-wb").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "p-house");
    await expect(page.getByTestId("ext-brick-hint")).toHaveCount(0);
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await expect(page.getByTestId("wzm-sub")).toHaveText("Tick it if there is one.");
  });
});

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

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
test.skip(!FLAG_ON, "exteriorV2 is off in this environment — set NEXT_PUBLIC_EXTERIOR_V2=1 on the test project");

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
  // The picture is a control too: tap the fascias on the house.
  await partOn(page, "fascias").locator("*").first().click({ force: true });
  await expect(page.getByTestId("ext-part-fascias")).toHaveAttribute("aria-pressed", "true");
  await expect(partOn(page, "fascias")).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("ql-picture")).toContainText("2 parts ticked");
  // And a tap on a lit part unticks it, on the chip too.
  await partOn(page, "walls").locator("*").first().click({ force: true });
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

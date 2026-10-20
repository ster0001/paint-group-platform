import { test, expect, type Page } from "@playwright/test";
import { stepsFor } from "../../lib/wizard/quick-look";
import { EXTERIOR_SHAPE_KEYS, scaledLengths, typicalFor } from "../../lib/wizard/exterior-typicals";
import { fillQuickAddress, openQuickLook, passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";

/**
 * Exterior wizard v2 — S2: "What kind of home is it?" and the drawn house
 * (brief §7.1, §8; gate spec for S2). As an anonymous customer, with the
 * `exteriorV2` flag ON (NEXT_PUBLIC_EXTERIOR_V2=1 on the test project):
 *
 *  - the home step sits between the place and the outside questions, on the rail;
 *  - every shape draws: the picture carries the shape and its parts in grey;
 *  - the size scales the caption (and the picture's typical widths);
 *  - a shared-wall shape asks where it is in the row and draws "next door"
 *    on each shared side; an end of the row opens one side;
 *  - Continue needs a shape and a size, said in words;
 *  - the answers survive a reload (resume);
 *  - the rest of the outside path still reaches a range, and the sides
 *    editor's typical size is now the drawn house's, not 12 × 2.6.
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
test.skip(!FLAG_ON, "exteriorV2 is off in this environment — set NEXT_PUBLIC_EXTERIOR_V2=1 on the test project");

async function toHome(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='home']")).toBeVisible({ timeout: 20_000 });
}

const caption = (page: Page) => page.getByTestId("ql-ext-caption");
const picture = (page: Page) => page.getByTestId("ql-picture").getByTestId("pic-outside");

test("the home step is on the rail, between the place and the outside questions", async ({ page }) => {
  test.setTimeout(120_000);
  await toHome(page);
  const keys = await page.getByTestId("wz-rail").locator("li[data-step]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.step ?? ""));
  const want = stepsFor("exterior", "house", "areas", "range", "whole", keys.includes("gate"));
  expect(keys).toEqual(want);
  expect(want.indexOf("home")).toBe(want.indexOf("place") + 1);
  expect(want[want.indexOf("home") + 1]).toBe("paint"); // S3: Painting follows the home step
  await expect(page.getByRole("heading", { name: "What kind of home is it?" })).toBeVisible();
  // Nothing picked yet: the picture card asks for a shape, and the size question waits for one.
  await expect(caption(page)).toContainText(/draw it here/i);
  await expect(page.getByTestId("ext-size-q")).toHaveCount(0);
  for (const k of EXTERIOR_SHAPE_KEYS) await expect(page.getByTestId(`ql-ext-type-${k}`)).toHaveAttribute("aria-pressed", "false");
});

test("Continue needs a shape and a size, said in words", async ({ page }) => {
  test.setTimeout(120_000);
  await toHome(page);
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/closest shape/i);
  await page.getByTestId("ql-ext-type-wb").click();
  await expect(page.getByTestId("ql-ext-type-wb")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/how big/i);
  await page.getByTestId("ql-ext-size-md").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 }); // S3
});

test("every shape draws: the picture carries the shape, its parts in grey, and the typical sizes in the caption", async ({ page }) => {
  test.setTimeout(180_000);
  await toHome(page);
  for (const k of EXTERIOR_SHAPE_KEYS) {
    await page.getByTestId(`ql-ext-type-${k}`).click();
    await expect(page.getByTestId(`ql-ext-type-${k}`)).toHaveAttribute("aria-pressed", "true");
    const pic = picture(page);
    await expect(pic).toHaveAttribute("data-shape", k);
    await expect(pic).toHaveAttribute("data-side", "front");
    // The house HAS walls, a roofline, windows and a door, drawn grey — nothing is painting yet (C8b: nothing pre-ticked).
    const parts = pic.locator(".e[data-e]");
    expect(await parts.count()).toBeGreaterThanOrEqual(6);
    expect(await pic.locator(".e[data-on='1']").count()).toBe(0);
    const t = typicalFor(k);
    await expect(page.getByTestId("ql-picture")).toContainText(t.name);
    const lengths = scaledLengths(t, "ns");
    await expect(caption(page)).toHaveAttribute("data-front", String(lengths.frontM));
    await expect(caption(page)).toHaveAttribute("data-side", String(lengths.sideM));
    // The gable shape shows a gable; the terrace a parapet; the shared shapes their neighbours.
    if (t.roof === "gable") await expect(pic.locator(".e[data-e='gable']")).toHaveCount(1);
    if (t.roof === "parapet") await expect(caption(page)).toContainText(/to the parapet/);
    await expect(pic.locator("[data-testid='pic-nextdoor']")).toHaveCount(t.sharedSides.length);
  }
});

test("the size scales the caption and the picture: Small is narrower than Very large, Not sure is Medium", async ({ page }) => {
  test.setTimeout(120_000);
  await toHome(page);
  await page.getByTestId("ql-ext-type-cal").click();
  await expect(page.getByTestId("ext-size-q")).toBeVisible();
  const front = async () => Number(await caption(page).getAttribute("data-front"));
  await page.getByTestId("ql-ext-size-sm").click();
  const small = await front();
  await expect(page.getByTestId("ql-picture")).toContainText("Small · single storey");
  await page.getByTestId("ql-ext-size-xl").click();
  const large = await front();
  expect(large).toBeGreaterThan(small);
  expect(small).toBe(scaledLengths(typicalFor("cal"), "sm").frontM);
  expect(large).toBe(scaledLengths(typicalFor("cal"), "xl").frontM);
  await page.getByTestId("ql-ext-size-ns").click();
  expect(await front()).toBe(scaledLengths(typicalFor("cal"), "md").frontM);
  await expect(caption(page)).toContainText(/sized from the type/i);
  // The drawing scales too: the wall is wider on a larger house.
  const wallWidth = async () => Number(await picture(page).locator(".e[data-e='walls'] rect").first().getAttribute("width"));
  await page.getByTestId("ql-ext-size-sm").click();
  const wSmall = await wallWidth();
  await page.getByTestId("ql-ext-size-xl").click();
  expect(await wallWidth()).toBeGreaterThan(wSmall);
});

test("a shared-wall shape asks where it is in the row; next door is drawn on each shared side; an end of the row opens one", async ({ page }) => {
  test.setTimeout(120_000);
  await toHome(page);
  await page.getByTestId("ql-ext-type-wb").click();
  await expect(page.getByTestId("ext-endof-q")).toHaveCount(0);
  await page.getByTestId("ql-ext-type-th").click();
  await expect(page.getByTestId("ext-endof-q")).toBeVisible();
  await expect(page.getByTestId("ql-ext-row-mid")).toHaveAttribute("aria-pressed", "true");
  await expect(picture(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(2);
  await expect(caption(page)).toContainText(/shared with next door/i);
  await page.getByTestId("ql-ext-row-left").click();
  await expect(picture(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(1);
  await page.getByTestId("ql-ext-row-both").click();
  await expect(picture(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(0);
  await expect(caption(page)).toContainText(/standing alone/i);
  // A unit shares one wall: the middle answer names it.
  await page.getByTestId("ql-ext-type-unit").click();
  await expect(page.getByTestId("ql-ext-row-mid")).toContainText(/shares the left wall/i);
  await expect(page.getByTestId("ql-ext-row-right")).toHaveCount(0);
  await expect(picture(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(1);
});

test("the answers survive a reload, and Your job so far names the home", async ({ page }) => {
  test.setTimeout(120_000);
  await toHome(page);
  await page.getByTestId("ql-ext-type-terrace").click();
  await page.getByTestId("ql-ext-size-sm").click();
  await page.getByTestId("ql-ext-row-right").click();
  // The autosave is debounced; give it a beat, as a person would.
  await page.waitForTimeout(3_000);
  await page.reload();
  await expect(page.locator("[data-quick-step='home']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ql-ext-type-terrace")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ql-ext-size-sm")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ql-ext-row-right")).toHaveAttribute("aria-pressed", "true");
  await expect(picture(page)).toHaveAttribute("data-shape", "terrace");
});

test("the rest of the outside path still reaches a range, and the sides editor's typical size is the drawn house's", async ({ page }) => {
  test.setTimeout(240_000);
  await toHome(page);
  await page.getByTestId("ql-ext-type-th").click();
  await page.getByTestId("ql-ext-size-sm").click();
  await quickNext(page);
  // S3: Painting and About it; S4: each side confirmed.
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ext-part-walls").click();
  await page.getByTestId("ext-part-fascias").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ext-mat-render").click();
  await page.getByTestId("ql-ext-colour-new").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 4 && !(await page.getByTestId("ext-sides-done").count()); i++) await page.getByTestId("ext-confirm-side").click();
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // S5: Tighten opens the walk; the front's size is the drawn house's — 5 m across, 5.6 m high on a small
  // townhouse — not the 12 × 2.6 the old scaffold assumed.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.getByTestId("ext-walk")).toBeVisible({ timeout: 60_000 });
  const { frontM } = scaledLengths(typicalFor("th"), "sm");
  await expect(page.getByTestId("ext-size-line")).toContainText(new RegExp(`${frontM} m across × ${typicalFor("th").wallHM} m high`));
  await expect(page.getByTestId("ext-size-tag")).toContainText(/Typical for a townhouse/i);
});

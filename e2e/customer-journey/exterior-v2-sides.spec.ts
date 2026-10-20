import { test, expect, type Page } from "@playwright/test";
import { quickNext } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Exterior wizard v2 — S4: "Check each side of the house" (brief §7.4; gate
 * spec for S4). As an anonymous customer with the `exteriorV2` flag ON:
 *
 *  - four step tiles, the picture turned to the current side with a compass;
 *  - each side starts with the whole-house parts that land there (the gable on
 *    the gable sides, the verandah on the front); a part can be taken off a
 *    side, and anything added from the full list — it appears on the picture;
 *  - a side can take its own wall material, tagged Different from the rest;
 *  - "Looks right — next side" confirms and moves on; the tile turns; every
 *    painted side must be confirmed to continue (8a); a change un-confirms;
 *  - shared sides start not painting and can be added back;
 *  - no sizes, counts or dollars here (8).
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 === "1";
test.skip(!FLAG_ON, "exteriorV2 is off in this environment — set NEXT_PUBLIC_EXTERIOR_V2=1 on the test project");

const picture = (page: Page) => page.getByTestId("ql-picture").getByTestId("pic-outside");
const tile = (page: Page, k: string) => page.getByTestId(`ql-ext-side-${k}`);

test("four tiles, the picture turned to the side, the compass; each side starts with the parts that land there", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page);
  await expect(page.getByRole("heading", { name: "Check each side of the house" })).toBeVisible();
  for (const k of ["front", "right", "back", "left"]) await expect(tile(page, k)).toBeVisible();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "cur");
  await expect(picture(page)).toHaveAttribute("data-side", "front");
  await expect(page.getByTestId("ext-compass-front")).toHaveAttribute("data-state", "cur");
  // The front of a bungalow: the walls, the gable, the verandah and its posts are here; nothing about sizes or counts, no dollars.
  for (const p of ["walls", "gable", "fascias", "verandah", "posts"]) await expect(page.getByTestId(`ext-sidepart-${p}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ext-side-count")).toHaveText("9 of 9");
  await expect(page.locator(".wz-quick")).not.toContainText(/m across|How many|\$\s?\d/);
  await expect(page.getByTestId("range-width")).toHaveCount(0);
  // The right side: no gable, no verandah — the picture agrees.
  await tile(page, "right").click();
  await expect(picture(page)).toHaveAttribute("data-side", "right");
  await expect(page.getByTestId("ext-side-name")).toHaveText("Right side");
  await expect(page.getByTestId("ext-sidepart-gable")).toHaveCount(0);
  await expect(page.getByTestId("ext-sidepart-verandah")).toHaveCount(0);
  await expect(picture(page).locator(".e[data-e='gable']")).toHaveCount(0);
  // The compass jumps too.
  await page.getByTestId("ext-compass-back").click();
  await expect(picture(page)).toHaveAttribute("data-side", "back");
  await expect(tile(page, "back")).toHaveAttribute("data-state", "cur");
});

test("a gable added on the right side appears on the picture; a side's own material is tagged Different from the rest; a part taken off goes grey", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page);
  await tile(page, "right").click();
  await page.getByTestId("ext-side-add-open").click();
  await expect(page.getByTestId("ext-side-add")).toBeVisible();
  await page.getByTestId("ext-side-addpart-gable").click();
  await expect(page.getByTestId("ext-sidepart-gable")).toHaveAttribute("aria-pressed", "true");
  await expect(picture(page).locator(".e[data-e='gable']")).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("ext-side-count")).toHaveText("7 of 7"); // the six that land here, plus the gable
  // Its own material.
  await expect(page.getByTestId("ext-side-mat-tag")).toHaveText("Same as the house");
  await expect(page.getByTestId("ext-side-mat-weatherboards")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ext-side-mat-render").click();
  await expect(page.getByTestId("ext-side-mat-tag")).toHaveText("Different from the rest");
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/render on this side/);
  await expect(picture(page).locator(".e[data-e='walls'] rect[fill='url(#p-render)']")).toHaveCount(1);
  // Back to the house's material: Same as the house again.
  await page.getByTestId("ext-side-mat-weatherboards").click();
  await expect(page.getByTestId("ext-side-mat-tag")).toHaveText("Same as the house");
  // A part taken off this side goes grey on the picture; the other sides keep it.
  await page.getByTestId("ext-sidepart-eaves").click();
  await expect(page.getByTestId("ext-sidepart-eaves")).toHaveAttribute("aria-pressed", "false");
  await expect(picture(page).locator(".e[data-e='eaves']")).toHaveAttribute("data-on", "0");
  await tile(page, "back").click();
  await expect(page.getByTestId("ext-sidepart-eaves")).toHaveAttribute("aria-pressed", "true");
});

test("Looks right confirms and moves on; every painted side must be confirmed; a change un-confirms", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page);
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Looks right.*4 to go/);
  await page.getByTestId("ext-confirm-side").click();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "ok");
  await expect(tile(page, "right")).toHaveAttribute("data-state", "cur");
  await expect(page.getByTestId("ext-sides-progress")).toContainText("1 of 4");
  await page.getByTestId("ext-confirm-side").click();
  await page.getByTestId("ext-confirm-side").click();
  await expect(page.getByTestId("ext-sides-done")).toHaveCount(0);
  await page.getByTestId("ext-confirm-side").click();
  await expect(page.getByTestId("ext-sides-done")).toContainText("All 4 sides confirmed");
  for (const k of ["front", "right", "back"]) await expect(tile(page, k)).toHaveAttribute("data-state", "ok");
  // A change on a confirmed side un-confirms it (8a).
  await tile(page, "front").click();
  await page.getByTestId("ext-sidepart-gutters").click();
  await expect(page.getByTestId("ext-sides-done")).toHaveCount(0);
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/1 to go/);
  await page.getByTestId("ext-confirm-side").click();
  await expect(page.getByTestId("ext-sides-done")).toBeVisible();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='gate'], [data-testid='reveal']").first()).toBeVisible({ timeout: 90_000 });
});

test("a townhouse's shared sides start not painting with a note, and can be added back; Not painting takes a side off", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page, "th", ["walls", "fascias"], "mid");
  await expect(tile(page, "left")).toHaveAttribute("data-state", "skip");
  await expect(tile(page, "right")).toHaveAttribute("data-state", "skip");
  await tile(page, "left").click();
  await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ext-side-np-note")).toContainText(/shared wall on a townhouse/);
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/not painting/i);
  await expect(page.getByTestId("ext-side-parts")).toHaveCount(0);
  // Add it back: it is a painted side with its parts.
  await page.getByTestId("ext-side-np").click();
  await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("ext-sidepart-walls")).toHaveAttribute("aria-pressed", "true");
  await expect(tile(page, "left")).toHaveAttribute("data-state", "cur");
  // And the front can be taken off — then the progress counts three painted sides.
  await tile(page, "front").click();
  await page.getByTestId("ext-side-np").click();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "skip");
  await expect(page.getByTestId("ext-sides-progress")).toContainText("of 2");
});

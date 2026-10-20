import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, openQuickLook, passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";

/**
 * Exterior wizard v2 — S3: "Tell us about what you ticked" (brief §7.3;
 * gate spec for S3). As an anonymous customer with the `exteriorV2` flag ON:
 *
 *  - a card only for a ticked part that needs more; a single storey is never
 *    offered a second material (acceptance 8); a double storey asks
 *    downstairs and upstairs with "Same as downstairs" first (⚑ 18);
 *  - brick anywhere asks painted or bare (⚑ 5); vertical timber says it is
 *    stained; the picture's texture follows the material; the window type
 *    changes the drawing;
 *  - the colours and access are here, before the gate; no storeys question;
 *  - Continue needs the walls' material, said in words;
 *  - then Which sides?, the gate and a range with the exterior words, priced
 *    on the drawn house; the sides editor opens on it.
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

async function toAbout(page: Page, shape: string, parts: string[]) {
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
  for (const p of parts) await page.getByTestId(`ext-part-${p}`).click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
}

const picture = (page: Page) => page.getByTestId("ql-picture").getByTestId("pic-outside");
const wallFill = (page: Page) => picture(page).locator(".e[data-e='walls'] rect").nth(1).getAttribute("fill");

test("cards only for what was ticked; one material on a single storey; the picture's texture follows; Continue needs the material", async ({ page }) => {
  test.setTimeout(180_000);
  await toAbout(page, "cal", ["walls", "fascias", "gutters"]);
  await expect(page.getByRole("heading", { name: "Tell us about what you ticked" })).toBeVisible();
  await expect(page.getByTestId("ext-walls-q")).toBeVisible();
  for (const q of ["ext-gable-q", "ext-windows-q", "ext-garage-q", "ext-posts-q", "ext-sizes-q"]) await expect(page.getByTestId(q)).toHaveCount(0);
  // A single storey is never offered a second material; no storeys question anywhere.
  await expect(page.getByTestId("ext-mat-up")).toHaveCount(0);
  await expect(page.getByTestId("ql-ext-storeys")).toHaveCount(0);
  await expect(page.locator(".wz-quick")).not.toContainText(/Single or double storey/);
  // Colours and access are here, before the gate.
  await expect(page.getByTestId("ql-ext-colour")).toBeVisible();
  await expect(page.getByTestId("ql-ext-access")).toBeVisible();
  // Nothing chosen: refused in words.
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/What are the walls made of/);
  // Weatherboards, then render: the texture on the picture follows (the pattern fill changes).
  await page.getByTestId("ext-mat-weatherboards").click();
  await expect(page.getByTestId("ext-mat-weatherboards")).toHaveAttribute("aria-pressed", "true");
  expect(await wallFill(page)).toBe("url(#p-boards)");
  await page.getByTestId("ext-mat-render").click();
  expect(await wallFill(page)).toBe("url(#p-render)");
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/The walls are render/);
  // Brick anywhere asks painted or bare; vertical timber says stained.
  await expect(page.getByTestId("ext-brick-q")).toHaveCount(0);
  await page.getByTestId("ext-mat-brick").click();
  await expect(page.getByTestId("ext-brick-q")).toBeVisible();
  await page.getByTestId("ext-brick-no").click();
  await page.getByTestId("ext-mat-vertical_timber").click();
  await expect(page.getByTestId("ext-brick-q")).toHaveCount(0);
  await expect(page.getByTestId("ext-timber-note")).toContainText(/stained/i);
  await page.getByTestId("ext-mat-weatherboards").click();
  await page.getByTestId("ql-ext-access-lift").click();
  await expect(page.getByTestId("ext-lift-note")).toContainText(/separate line/i);
  await page.getByTestId("ql-ext-access-none").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
});

test("a double storey asks downstairs and upstairs, Same as downstairs first; the window type changes the drawing; the gable, garage and posts cards", async ({ page }) => {
  test.setTimeout(180_000);
  await toAbout(page, "ds", ["walls", "windows", "garage", "verandah", "posts"]);
  await expect(page.getByTestId("ext-mat-up")).toBeVisible();
  await expect(page.getByTestId("ext-mat-up").locator("button").first()).toHaveText("Same as downstairs");
  await expect(page.getByTestId("ext-mat-up-same")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ext-mat-render").click();
  await page.getByTestId("ext-mat-up-weatherboards").click();
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/render.*downstairs.*weatherboards.*upstairs/);
  // Two materials on the picture: the upper half carries the boards pattern.
  await expect(picture(page).locator(".e[data-e='walls'] rect[fill='url(#p-boards)']")).toHaveCount(1);
  await expect(picture(page).locator(".e[data-e='walls'] rect[fill='url(#p-render)']")).toHaveCount(1);
  // Windows: the type changes the glyph (a sash has a horizontal bar, a casement a vertical one).
  await expect(page.getByTestId("ext-windows-q")).toBeVisible();
  await page.getByTestId("ql-ext-win-sash").click();
  const bars = async () => picture(page).locator(".e[data-e='windows'] path").first().getAttribute("d");
  const sash = await bars();
  await page.getByTestId("ql-ext-win-casement").click();
  expect(await bars()).not.toBe(sash);
  // Garage and posts.
  await expect(page.getByTestId("ext-garage-q")).toBeVisible();
  await page.getByTestId("ext-garage-2").click();
  await expect(picture(page).locator(".e[data-e='garage']")).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("ext-posts-q")).toBeVisible();
  await page.getByTestId("ext-posts-columns").click();
  await expect(page.getByTestId("ext-gable-q")).toHaveCount(0); // no gable ticked
});

test("the extras ask their sizes; a ticked pergola needs its top; then the range reads the drawn house and the sides editor opens", async ({ page }) => {
  test.setTimeout(240_000);
  await toAbout(page, "wb", ["walls", "fascias", "windows", "doors"]);
  // Back to Painting for the extras, then on again.
  await page.getByTestId("ql-back").click();
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ext-extra-paling_fence").click();
  await page.getByTestId("ext-extra-pergola").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ext-mat-weatherboards").click();
  await page.getByTestId("ql-ext-win-colonial").click();
  await page.getByTestId("ql-ext-colour-new").click();
  await expect(page.getByTestId("ext-size-paling_fence")).toBeVisible();
  await page.getByTestId("ext-size-paling_fence-input").fill("20");
  await page.getByTestId("ext-size-paling_fence-input").blur();
  // The pergola's top is required.
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/pergola top/i);
  await page.getByTestId("ext-size-pergola-l").fill("6");
  await page.getByTestId("ext-size-pergola-l").blur();
  await page.getByTestId("ext-size-pergola-w").fill("4");
  await page.getByTestId("ext-size-pergola-w").blur();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  // Each side (S4): the right side is not painting; Looks right on the other three.
  await page.getByTestId("ql-ext-side-right").click();
  await page.getByTestId("ext-side-np").click();
  await expect(page.getByTestId("ql-ext-side-right")).toHaveAttribute("data-state", "skip");
  await page.getByTestId("ql-ext-side-front").click(); // a side not painting has no Looks right; confirm from the front round
  for (let i = 0; i < 4 && !(await page.getByTestId("ext-sides-done").count()); i++) await page.getByTestId("ext-confirm-side").click();
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // The restatement reads the drawn house: the parts, the material, the windows, the sides, no storeys guess.
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the walls, windows, doors, fascias, paling fence and pergola \(weatherboard\)/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/colonial windows/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the front, back and left side/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/single storey/);
  // And Tighten opens the walk on the drawn house's sides (S5) — the right side is not there to check at all (8 Sep ruling).
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.getByTestId("ext-walk")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ext-side-right")).toHaveAttribute("data-state", "skip");
  await expect(page.getByTestId("ext-side-front")).toHaveAttribute("data-state", "cur");
  await expect(page.getByTestId("ql-ext-caption")).toContainText(/weatherboards/i);
});

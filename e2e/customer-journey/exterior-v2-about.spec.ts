import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, openQuickLook, passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE, lookAtEverySide } from "./drive";

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
  // Each side (21 Oct): the right side is not painting — its tile goes; look at the other three.
  await page.getByTestId("ql-ext-side-right").click();
  await page.getByTestId("ext-side-np").click();
  await expect(page.getByTestId("ql-ext-side-right")).toHaveCount(0);
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // The restatement reads the drawn house: the parts, the material, the windows, the sides, no storeys guess.
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the walls, windows, doors, fascias, paling fence and pergola \(weatherboard\)/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/colonial windows/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the front, back and left side/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/single storey/);
  // And Tighten opens the customer editor (21 Oct, item 8) — the right side is not there at all (8 Sep ruling).
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-side="right"]')).toHaveCount(0);
  await expect(page.locator('[data-side="front"]')).toBeVisible();
});

test("Which sides are we painting? is asked on About it: all four ticked on a bungalow, untick one and it is not on Each side; none ticked is refused", async ({ page }) => {
  test.setTimeout(180_000);
  await toAbout(page, "wb", ["walls", "fascias"]);
  await page.getByTestId("ext-mat-weatherboards").click();
  const q = page.getByTestId("ext-about-sides");
  await expect(q).toBeVisible();
  for (const k of ["front", "right", "back", "left"]) await expect(page.getByTestId(`ext-about-side-${k}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ext-about-side-right").click();
  await expect(page.getByTestId("ext-about-side-right")).toHaveAttribute("aria-pressed", "false");
  // None ticked: Continue refused in words.
  for (const k of ["front", "back", "left"]) await page.getByTestId(`ext-about-side-${k}`).click();
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/at least one side/i);
  await page.getByTestId("ext-about-side-front").click();
  await page.getByTestId("ext-about-side-back").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ql-ext-side-front")).toBeVisible();
  await expect(page.getByTestId("ql-ext-side-back")).toBeVisible();
  await expect(page.getByTestId("ql-ext-side-right")).toHaveCount(0);
  await expect(page.getByTestId("ql-ext-side-left")).toHaveCount(0);
});

/**
 * EXTERIOR ON MOBILE v5 — session 3 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 6a–6n, 7 and 8; prototype `design/reference/wizard-exterior-mobile-v5-prototype.html`),
 * as an ANONYMOUS customer at 390 × 780 with touch. Under 768px About it is
 * ONE CARD PER SCREEN, only for the parts that were ticked: the walls'
 * material (downstairs then upstairs on a double storey, "Same as
 * downstairs" first), painted or bare brick, the vertical-timber stain,
 * the gable's fill, the window type (the drawn house's windows change), the
 * garage door, the posts, the extras' rough sizes as steppers; then the
 * colours and the access. Single choices advance themselves; the sizes and
 * the access carry Continue. The desktop step is untouched (the tests above).
 */
test.describe("on a phone: About it is one card per screen (exterior mobile v5, session 3)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const thumb = (page: Page) => page.getByTestId("wzm-thumb").locator("svg.wz-elev");
  /** Outside → a shape, medium → through Painting with these parts and extras → the first About it screen. */
  const toAbout = async (page: Page, shape: string, parts: string[], extras: string[] = []) => {
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
    const tick = async (p: string) => { if (parts.includes(p)) await page.getByTestId(`ext-part-${p}`).tap(); };
    for (const p of ["walls", "gable", "fascias", "gutters", "downpipes", "eaves"]) await tick(p);
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    for (const p of ["windows", "doors", "garage", "shutters"]) await tick(p);
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    for (const p of ["verandah", "posts", "ceiling", "handrail"]) await tick(p);
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    for (const e of extras) await page.getByTestId(`ext-extra-${e}`).tap();
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  };

  test("a bungalow with everything: material → gable → windows (the drawn house's windows change) → garage → posts → sizes as steppers → colours → access → Each side", async ({ page }) => {
    test.setTimeout(180_000);
    await toAbout(page, "cal", ["walls", "gable", "windows", "garage", "verandah", "posts"], ["paling_fence", "pergola"]);
    await at(page, "a-walls");
    await expect(page.getByTestId("wzm-stage")).toHaveText("About it");
    await expect(page.getByTestId("wzm-h1")).toHaveText("What are the walls made of?");
    await expect(page.getByTestId("ext-mat").locator("button")).toHaveCount(8);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    await page.getByTestId("ext-mat-render").tap();
    // render is not brick: no brick screen; the gable next
    await at(page, "a-gable");
    await expect(page.getByTestId("wzm-h1")).toHaveText("What's in the gable?");
    await page.getByTestId("ext-gable-stucco").tap();
    await at(page, "a-win");
    await expect(page.getByTestId("wzm-h1")).toHaveText("What kind of windows?");
    await expect(page.getByTestId("ql-ext-win").locator("button")).toHaveCount(6);
    const before = await thumb(page).locator(".e-windows").first().innerHTML();
    await page.getByTestId("ql-ext-win-sash").tap();
    await at(page, "a-garage");
    expect(await thumb(page).locator(".e-windows").first().innerHTML(), "the drawn house's windows follow the type").not.toBe(before);
    await expect(page.getByTestId("wzm-h1")).toHaveText("Garage door");
    await page.getByTestId("ext-garage-2").tap();
    await at(page, "a-posts");
    await page.getByTestId("ext-posts-columns").tap();
    // the sizes: steppers with a default, Continue
    await at(page, "a-extras");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Roughly how big?");
    await expect(page.getByTestId("ext-size-fence-value")).toHaveText("20");
    await page.getByTestId("ext-size-fence-plus").tap();
    await expect(page.getByTestId("ext-size-fence-value")).toHaveText("21");
    await expect(page.getByTestId("ext-size-pergola_l-value")).toHaveText("4");
    await expect(page.getByTestId("ext-size-pergola_w-value")).toHaveText("3");
    await page.getByTestId("ext-size-pergola_w-minus").tap();
    await expect(page.getByTestId("ext-size-pergola_w-value")).toHaveText("2.5");
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await page.getByTestId("ql-next").tap();
    // colours, then access with the lift note, then Each side
    await at(page, "a-colours");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Colours?");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Getting around the house");
    await expect(page.getByTestId("ext-lift-note")).toHaveCount(0);
    await page.getByTestId("ql-ext-access-lift").tap();
    await expect(page.getByTestId("ext-lift-note")).toContainText(/separate line/i);
    await page.getByTestId("ql-ext-access-none").tap();
    await expect(page.getByTestId("ext-lift-note")).toHaveCount(0);
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
    // back lands on the last About it screen
    await page.getByTestId("wzm-back").tap();
    await at(page, "a-access");
    await expect(page.getByTestId("ql-ext-access-none")).toHaveAttribute("aria-pressed", "true");
  });

  test("a double storey asks downstairs then upstairs (Same as downstairs first); brick anywhere asks painted or bare; vertical timber asks about the stain", async ({ page }) => {
    test.setTimeout(150_000);
    await toAbout(page, "ds", ["walls"]);
    await at(page, "a-walls");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Downstairs walls — what are they made of?");
    await page.getByTestId("ext-mat-render").tap();
    await at(page, "a-wallsUp");
    await expect(page.getByTestId("wzm-h1")).toHaveText("And upstairs?");
    await expect(page.getByTestId("ext-mat-up").locator("button").first()).toHaveText("Same as downstairs");
    await expect(page.getByTestId("ext-mat-up-same")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ext-mat-up-brick").tap();
    // brick upstairs: the brick question, then (no gable, windows, garage or posts ticked) straight to the colours
    await at(page, "a-brick");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Has the brick been painted before?");
    await page.getByTestId("ext-brick-no").tap();
    await at(page, "a-colours");
    await page.getByTestId("wzm-back").tap();
    await at(page, "a-brick");
    await page.getByTestId("wzm-back").tap();
    await at(page, "a-wallsUp");
    await page.getByTestId("ext-mat-up-vertical_timber").tap();
    await at(page, "a-timber");
    await expect(page.getByTestId("wzm-sub")).toContainText(/stained/i);
    await expect(page.getByTestId("ext-timber-no")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ext-timber-yes").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-same").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  });

  test("nothing more to ask about the roofline alone: About it is the colours and the access only", async ({ page }) => {
    test.setTimeout(120_000);
    await toAbout(page, "wb", ["fascias", "gutters"]);
    await at(page, "a-colours");
    await expect(page.getByTestId("wzm-stage")).toHaveText("About it");
    await expect(page.locator("[data-mobile-screen='a-walls']")).toHaveCount(0);
    await page.getByTestId("wzm-back").tap();
    await at(page, "p-around");
    await page.getByTestId("ql-next").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-bold").tap();
    await at(page, "a-access");
    await expect(page.getByTestId("ql-ext-access-none")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  });
});

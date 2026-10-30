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
 *  - (21 Oct) which sides is asked on About it; only the ticked sides have a
 *    tile; looking at a side ticks it, and Continue needs every ticked side
 *    seen; the window and door counts have + and − here, and the picture
 *    follows them;
 *  - a shared side starts unticked and is added back on About it;
 *  - no sizes or dollars here (8).
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

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

test("no Looks right tap: a side ticks once you have looked at it, the counts have + and − here, and Continue needs every ticked side seen", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page);
  // 4 · the window / door counts live here now, and the picture follows them.
  const glass = picture(page).locator('g[data-e="windows"] rect[fill="#CFE3EA"]');
  const before = await glass.count();
  await expect(page.getByTestId("ext-win-count")).toBeVisible();
  await expect(page.getByTestId("ext-door-count")).toBeVisible();
  await page.getByTestId("ext-win-plus").click();
  await page.getByTestId("ext-win-plus").click();
  await expect(glass).toHaveCount(before + 2);
  await page.getByTestId("ext-door-plus").click();
  await expect(page.getByTestId("ext-door-n")).toHaveText("2");
  // 6 · no confirm button; looking at a side ticks it; Continue waits for the rest.
  await expect(page.getByTestId("ext-confirm-side")).toHaveCount(0);
  await tile(page, "right").click();
  await expect(tile(page, "front")).toHaveAttribute("data-state", "ok");
  await expect(tile(page, "right")).toHaveAttribute("data-state", "cur");
  await expect(tile(page, "back")).toHaveAttribute("data-state", "todo");
  await expect(page.getByTestId("ext-sides-progress")).toContainText("2 of 4 sides looked at");
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Tap each side.*2 to go/);
  await tile(page, "back").click();
  await tile(page, "left").click();
  await expect(page.getByTestId("ext-sides-progress")).toContainText("4 of 4 sides looked at");
  await quickNext(page);
  await expect(page.locator("[data-quick-step='gate'], [data-testid='reveal']").first()).toBeVisible({ timeout: 90_000 });
});

test("a townhouse's shared sides are not on Each side at all; Not painting takes a side off the tiles; a side added back on About it comes back", async ({ page }) => {
  test.setTimeout(180_000);
  await toSides(page, "th", ["walls", "fascias"], "mid");
  // 6 · only the ticked sides have a tile: the front and the back.
  await expect(tile(page, "front")).toHaveAttribute("data-state", "cur");
  await expect(tile(page, "back")).toBeVisible();
  await expect(tile(page, "left")).toHaveCount(0);
  await expect(tile(page, "right")).toHaveCount(0);
  await expect(page.getByTestId("ext-sides-progress")).toContainText("1 of 2 sides looked at");
  // Not painting the front: its tile goes, the back is shown and counted.
  await page.getByTestId("ext-side-np").click();
  await expect(tile(page, "front")).toHaveCount(0);
  await expect(tile(page, "back")).toHaveAttribute("data-state", "cur");
  await expect(page.getByTestId("ext-sides-progress")).toContainText("1 of 1 side looked at");
  // Back to About it: the question shows the back ticked, the front and the shared sides not; tick the left — it is on Each side again.
  await page.getByTestId("ql-back").click();
  await expect(page.getByTestId("ext-about-sides")).toBeVisible();
  await expect(page.getByTestId("ext-about-side-back")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ext-about-side-front")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("ext-about-side-left")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("ext-about-side-left")).toContainText(/usually a shared wall/);
  await page.getByTestId("ext-about-side-left").click();
  await quickNext(page);
  await expect(tile(page, "left")).toBeVisible();
  await expect(tile(page, "front")).toHaveCount(0);
});

/**
 * EXTERIOR ON MOBILE v5 — session 4 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 9a–9d, §3; prototype `design/reference/wizard-exterior-mobile-v5-prototype.html`),
 * as an ANONYMOUS customer at 390 × 780 with touch. Under 768px Each side is
 * ONE SCREEN PER SIDE — Front · Right · Back · Left — with the strip's
 * thumbnail turned to that side: the whole-house parts that land here as
 * removable chips, "+ Add something on this side", this side's wall
 * material, "Not painting this side" (a shared side starts that way), and
 * the bar reading "Looks right — next side". Looking at a side checks it.
 * The sheet shows that side full width with a compass to turn it. The
 * desktop step is untouched (the tests above).
 */
test.describe("on a phone: Each side is one screen per side, the house turned to it (exterior mobile v5, session 4)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const thumb = (page: Page) => page.getByTestId("wzm-thumb").locator("svg.wz-elev");
  /** Outside → shape, medium (→ row) → Painting with these parts → About it (material, colours, access) → the first side. */
  const toEachSide = async (page: Page, shape: string, parts: string[], row?: string) => {
    const { openQuickLook, fillQuickAddress } = await import("./drive");
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
    if (row) { await at(page, "row"); await page.getByTestId(`ql-ext-row-${row}`).tap(); }
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
    await page.getByTestId("ql-next").tap();
    if (parts.includes("walls")) {
      await at(page, "a-walls"); await page.getByTestId("ext-mat-weatherboards").tap();
      if (shape === "ds" || shape === "th") { await at(page, "a-wallsUp"); await page.getByTestId("ext-mat-up-same").tap(); }
    }
    if (parts.includes("gable")) { await at(page, "a-gable"); await page.getByTestId("ext-gable-stucco").tap(); }
    if (parts.includes("windows")) { await at(page, "a-win"); await page.getByTestId("ql-ext-win-casement").tap(); }
    if (parts.includes("posts")) { await at(page, "a-posts"); await page.getByTestId("ext-posts-posts").tap(); }
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
    await at(page, "s-front");
  };

  test("a bungalow: four screens, the thumbnail turned to each side, the side's parts as chips, a gable added on the right, this side's material, Looks right — next side, then the details", async ({ page }) => {
    test.setTimeout(180_000);
    await toEachSide(page, "cal", ["walls", "gable", "fascias", "eaves", "windows", "doors", "verandah", "posts"]);
    await expect(page.getByTestId("wzm-stage")).toHaveText("Each side");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Front");
    await expect(page.getByTestId("wzm-sub")).toContainText("Untick what isn't on this side");
    await expect(page.getByTestId("wzm-side-front")).toHaveAttribute("data-state", "now");
    await expect(thumb(page)).toHaveAttribute("data-side", "front");
    // the whole-house parts that land on the front, each ticked; no counts, no sizes, no price
    for (const p of ["walls", "gable", "fascias", "eaves", "windows", "doors", "verandah", "posts"]) await expect(page.getByTestId(`ext-sidepart-${p}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ext-win-count")).toHaveCount(0);
    await expect(page.locator(".wzm")).not.toContainText(/m across|\$\s?\d/);
    await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ext-side-matup")).toHaveCount(0); // a single storey is never offered a second material
    await expect(page.getByTestId("ql-next")).toHaveText("Looks right — next side");
    // looking at a side checks it: the front ticks as soon as it is shown
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Front ✓ · Right · Back · Left");
    // the right side: the house turns; no gable or verandah land here; add a gable; this side's walls are render
    await page.getByTestId("ql-next").tap();
    await at(page, "s-right");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Right side");
    await expect(thumb(page)).toHaveAttribute("data-side", "right");
    await expect(page.getByTestId("wzm-side-front")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Front ✓ · Right ✓ · Back · Left");
    await expect(page.getByTestId("ext-sidepart-gable")).toHaveCount(0);
    await expect(page.getByTestId("ext-sidepart-verandah")).toHaveCount(0);
    await expect(page.getByTestId("ext-side-add")).toHaveCount(0);
    await page.getByTestId("ext-side-add-open").tap();
    await page.getByTestId("ext-side-addpart-gable").tap();
    await expect(page.getByTestId("ext-sidepart-gable")).toHaveAttribute("aria-pressed", "true");
    await expect(thumb(page).locator(".e-gable").first()).toHaveAttribute("data-on", "1");
    await expect(page.getByTestId("ext-side-mat-weatherboards")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ext-side-mat-render").tap();
    await expect(page.getByTestId("ext-side-mat-render")).toHaveAttribute("aria-pressed", "true");
    // a part taken off this side goes grey on the house
    await page.getByTestId("ext-sidepart-eaves").tap();
    await expect(page.getByTestId("ext-sidepart-eaves")).toHaveAttribute("aria-pressed", "false");
    await expect(thumb(page).locator(".e-eaves").first()).toHaveAttribute("data-on", "0");
    // the sheet: this side full width, the compass turns it, a tap on a part there is this side's
    await page.getByTestId("wzm-strip").tap();
    const big = page.getByTestId("wzm-bigpic").locator("svg.wz-elev");
    await expect(big).toHaveAttribute("data-side", "right");
    await expect(page.getByTestId("wzm-compass-right")).toHaveAttribute("data-state", "now");
    await page.getByTestId("wzm-compass-back").tap();
    await expect(big).toHaveAttribute("data-side", "back");
    await page.getByTestId("wzm-compass-right").tap();
    await expect(big).toHaveAttribute("data-side", "right");
    await page.getByTestId("wzm-sheet-chip-eaves").tap();
    await expect(page.getByTestId("wzm-sheet-chip-eaves")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ext-sidepart-eaves")).toHaveAttribute("aria-pressed", "true");
    // back, then the last two sides; the last bar reads Looks right and goes on to the details
    await page.getByTestId("ql-next").tap();
    await at(page, "s-back");
    await expect(thumb(page)).toHaveAttribute("data-side", "back");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-left");
    await expect(page.getByTestId("ql-next")).toHaveText("Looks right — next side");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Front ✓ · Right ✓ · Back ✓ · Left ✓");
    await page.getByTestId("ql-next").tap();
    await at(page, "details");
    await page.getByTestId("wzm-back").tap();
    await at(page, "s-left");
    await expect(page.getByTestId("wzm-side-left")).toHaveAttribute("data-state", "now");
  });

  test("a townhouse in the middle of the row: the shared sides start as Not painting with the bar reading Next side; tapping the toggle brings one back", async ({ page }) => {
    test.setTimeout(150_000);
    await toEachSide(page, "th", ["walls", "fascias"], "mid");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-right");
    await expect(page.getByTestId("wzm-sub")).toContainText("Usually a shared wall");
    await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ext-side-parts")).toHaveCount(0);
    await expect(page.getByTestId("ql-next")).toHaveText("Next side");
    await expect(page.getByTestId("wzm-side-right")).toHaveAttribute("data-state", "np");
    await page.getByTestId("ext-side-np").tap();
    await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ext-sidepart-walls")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ql-next")).toHaveText("Looks right — next side");
    await page.getByTestId("ext-side-np").tap();
    await expect(page.getByTestId("ql-next")).toHaveText("Next side");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-back");
    await page.getByTestId("ql-next").tap();
    await at(page, "s-left");
    await expect(page.getByTestId("ext-side-np")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Front ✓ · Right – · Back ✓ · Left –");
    await page.getByTestId("ql-next").tap();
    await at(page, "details");
  });
});

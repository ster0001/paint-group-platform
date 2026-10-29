import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { stepsFor } from "../../lib/wizard/quick-look";
import { EXTERIOR_SHAPE_KEYS, scaledLengths, typicalFor } from "../../lib/wizard/exterior-typicals";
import { fillQuickAddress, openQuickLook, passDetailsSheetIfShown, passGateIfShown, quickNext, MONEY_RANGE, lookAtEverySide } from "./drive";

/**
 * Exterior wizard v2 — S2: "What kind of home is it?" and the drawn house
 * (brief §7.1, §8; gate spec for S2). As an anonymous customer, with the
 * `exteriorV2` flag ON (the default since 21 Oct; `NEXT_PUBLIC_EXTERIOR_V2=0` turns it off):
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

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

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
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // 21 Oct: Tighten opens the customer editor; the front's size there is the drawn house's — 5 m across,
  // 5.6 m high on a small townhouse — not the 12 × 2.6 the old scaffold assumed.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  const { frontM } = scaledLengths(typicalFor("th"), "sm");
  await expect(front.getByTestId("side-assumed-front")).toContainText(new RegExp(`${frontM} m × ${typicalFor("th").wallHM} m`));
});

/**
 * EXTERIOR ON MOBILE v5 — session 1 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 screens 2–4, §3; prototype `design/reference/wizard-exterior-mobile-v5-prototype.html`
 * at 390px), as an ANONYMOUS customer at 390 × 780 with touch.
 *
 * Under 768px the Your home step is three of the phone's screens, one
 * question each: the nine shape cards with their silhouettes two per row
 * (auto-advance), the five size pills with the m² / bedroom hint
 * (auto-advance), and — only for a shape that usually shares a wall — where
 * it is in the row (auto-advance). The strip's thumbnail is the DRAWN HOUSE
 * (`Elevation`, the front) from the first shape tap, redrawn on every
 * answer, with dashed next-door blocks on the shared sides; the sheet shows
 * it full width with the typical sizes in the caption. The desktop step is
 * untouched (the tests above). Screenshots with EXTERIOR_MOBILE_SHOTS=1.
 */
const SHOTS = process.env.EXTERIOR_MOBILE_SHOTS ? "docs/wizard-mobile/exterior" : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe("on a phone: Your home is three screens, the drawn house in the strip (exterior mobile v5, session 1)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const thumbHouse = (page: Page) => page.getByTestId("wzm-thumb").locator("svg.wz-elev");
  const shot = async (page: Page, name: string) => {
    if (!SHOTS) return;
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
  };
  /** Outside → a house → the shape screen. */
  const toShape = async (page: Page) => {
    await openQuickLook(page);
    await fillQuickAddress(page);
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "shape");
  };

  test("screens 2–4: one question each, the shape cards two per row with silhouettes, the size pills, auto-advance, the row question only for a shared shape", async ({ page }) => {
    test.setTimeout(150_000);
    await toShape(page);
    // screen 2 — the shape: its own screen of the home step, no Continue bar, the stage kicker, nine cards
    await expect(page.locator("[data-quick-step='home']")).toBeVisible();
    await expect(page.getByTestId("wzm-h1")).toHaveText("What kind of home is it?");
    await expect(page.getByTestId("wzm-stage")).toHaveText("Your home");
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    const cards = page.getByTestId("ql-ext-type").locator("button");
    await expect(cards).toHaveCount(9);
    for (const k of EXTERIOR_SHAPE_KEYS) {
      const card = page.getByTestId(`ql-ext-type-${k}`);
      await expect(card.locator("svg").first(), "a silhouette on the card").toBeVisible();
      await expect(card).toContainText(typicalFor(k).name);
    }
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
    expect(Math.abs(a!.y - b!.y), "two cards per row").toBeLessThan(2);
    expect(c!.y, "the third card starts the second row").toBeGreaterThan(a!.y + a!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "nothing wider than the phone").toBeLessThanOrEqual(390);
    await shot(page, "02-shape");
    // tap a bungalow: it advances itself to the size
    await page.getByTestId("ql-ext-type-cal").tap();
    await at(page, "size");
    await expect(page.getByTestId("wzm-h1")).toHaveText("About how big is it?");
    await expect(page.getByTestId("ql-ext-size").locator("button")).toHaveCount(5);
    await expect(page.getByTestId("ql-ext-size-md")).toContainText(/120–200 m²/);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await shot(page, "03-size");
    // a bungalow shares no wall: the size is the last question of the step, and it advances to Painting
    await page.getByTestId("ql-ext-size-md").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-mobile-screen='row']")).toHaveCount(0);
    // back lands on the step's LAST screen, then the first
    await page.getByTestId("wzm-back").tap();
    await at(page, "size");
    await expect(page.getByTestId("ql-ext-size-md")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("wzm-back").tap();
    await at(page, "shape");
    await expect(page.getByTestId("ql-ext-type-cal")).toHaveAttribute("aria-pressed", "true");
    // a townhouse shares both side walls: a third screen, in the middle by default, each answer advancing
    await page.getByTestId("ql-ext-type-th").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-sm").tap();
    await at(page, "row");
    await expect(page.getByTestId("wzm-h1")).toHaveText("Where is it in the row?");
    await expect(page.getByTestId("ql-ext-row-mid")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ql-ext-row-left")).toBeVisible();
    await expect(page.getByTestId("ql-ext-row-right")).toBeVisible();
    await expect(page.getByTestId("ql-ext-row-both")).toBeVisible();
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await shot(page, "04-row");
    await page.getByTestId("ql-ext-row-left").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    // a unit shares the left wall only: the row screen offers no "right side open"
    await page.getByTestId("wzm-back").tap();
    await at(page, "row");
    await page.getByTestId("wzm-back").tap();
    await at(page, "size");
    await page.getByTestId("wzm-back").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-unit").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-sm").tap();
    await at(page, "row");
    await expect(page.getByTestId("ql-ext-row-mid")).toContainText(/shares the left wall/i);
    await expect(page.getByTestId("ql-ext-row-right")).toHaveCount(0);
  });

  test("the strip's thumbnail is the drawn house: it follows the shape, the size and the row position; the sheet shows it full width with the typical sizes", async ({ page }) => {
    test.setTimeout(150_000);
    await toShape(page);
    // before a shape: the placeholder house of session 3, no drawn house yet
    await expect(page.getByTestId("wzm-thumb").locator("svg[data-testid='wzm-pic']")).toHaveAttribute("data-kind", "house");
    await expect(thumbHouse(page)).toHaveCount(0);
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · House");
    // the first tap draws it — the front elevation of that shape — and the ribbon names the shape
    await page.getByTestId("ql-ext-type-cal").tap();
    await at(page, "size");
    await expect(thumbHouse(page)).toHaveAttribute("data-shape", "cal");
    await expect(thumbHouse(page)).toHaveAttribute("data-side", "front");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · Californian bungalow");
    const tb = (await page.getByTestId("wzm-thumb").boundingBox())!;
    expect(Math.round(tb.width)).toBe(76);
    expect(Math.round(tb.height)).toBe(52);
    // the size scales the drawn house and the sheet's caption says the typical sizes
    await page.getByTestId("ql-ext-size-sm").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · Californian bungalow · Small");
    const small = scaledLengths(typicalFor("cal"), "sm");
    await page.getByTestId("wzm-strip").tap();
    const big = page.getByTestId("wzm-bigpic").locator("svg.wz-elev");
    await expect(big).toHaveAttribute("data-shape", "cal");
    const bb = (await page.getByTestId("wzm-bigpic").boundingBox())!;
    expect(bb.width, "the sheet's house is full width").toBeGreaterThan(300);
    await expect(page.getByTestId("wzm-cap")).toContainText("Californian bungalow · Small · single storey");
    await expect(page.getByTestId("wzm-cap")).toContainText(`${small.frontM} m across`);
    await shot(page, "03-sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wzm-sheet")).toHaveCount(0);
    // a townhouse in the middle of the row: next door drawn on both sides; an end of the row opens one; standing alone, none
    await page.getByTestId("wzm-back").tap();
    await at(page, "size");
    await page.getByTestId("wzm-back").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-th").tap();
    await at(page, "size");
    await expect(thumbHouse(page)).toHaveAttribute("data-shape", "th");
    await expect(thumbHouse(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(2);
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "row");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · Townhouse · Medium");
    await page.getByTestId("ql-ext-row-left").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    await expect(thumbHouse(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(1);
    await shot(page, "04-thumb-row");
    await page.getByTestId("wzm-back").tap();
    await at(page, "row");
    await page.getByTestId("ql-ext-row-both").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    await expect(thumbHouse(page).locator("[data-testid='pic-nextdoor']")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "nothing wider than the phone").toBeLessThanOrEqual(390);
  });

  test("a reload lands on the same screen with the house kept, and the sheet's chips still tick the parts on the drawn house", async ({ page }) => {
    test.setTimeout(120_000);
    await toShape(page);
    await page.getByTestId("ql-ext-type-wb").tap();
    await at(page, "size");
    await page.waitForTimeout(3_500); // the autosave (2.5s debounce) and its request — 3s was one save short (C1, 29 Oct)
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toContainText("Welcome back", { timeout: 20_000 });
    await at(page, "size");
    await expect(thumbHouse(page)).toHaveAttribute("data-shape", "wb");
    await page.getByTestId("ql-ext-size-lg").tap();
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    // session 3's sheet chips tick the exterior brief's parts; the drawn house lights the part
    await page.getByTestId("wzm-strip").tap();
    await page.getByTestId("wzm-sheet-chip-walls").tap();
    await expect(page.getByTestId("wzm-bigpic").locator("svg.wz-elev .e-walls")).toHaveAttribute("data-on", "1");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ext-part-walls")).toHaveAttribute("aria-pressed", "true");
    await expect(thumbHouse(page).locator(".e-walls")).toHaveAttribute("data-on", "1");
  });
});

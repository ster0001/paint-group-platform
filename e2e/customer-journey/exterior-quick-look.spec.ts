import { test, expect, type Page } from "@playwright/test";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext, passGateIfShown, passDetailsSheetIfShown } from "./drive";

/**
 * The EXTERIOR quick look — rewritten to the drawn house (Exterior wizard v2,
 * S6; was C8b's one outside screen). Tom's checks, as they stand on the new
 * screens: nothing pre-ticked; the questions that appear are only the ones
 * you asked for (a material only for ticked walls, a window type only for
 * ticked windows — elements before materials, brief §4); colonial windows
 * price higher than casements (the rate row, not a multiplier); unticking
 * the walls removes them everywhere — the question, What we'll do, the walk.
 *
 * Retired from C8b's version, each with the ruling behind it (listed in the
 * S6 PR): the whole-house window and door counts and their "8 / 2" defaults
 * (counts are per side, defaulted from the width — brief §7.6, ⚑ 12); the
 * storeys question asked once on the outside screen (the shape knows — §7.3);
 * the pergola's size and Confirm on the painting screen (sizes are asked on
 * About it — §7.3); the sides editor as the Tighten door (the walk is the
 * tighten step — §7.6, ⚑ 0).
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

async function toHome(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  // Screen 2 is the place: kind only — no bedrooms, no storeys on an outside job.
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await expect(page.getByTestId("ql-bedrooms")).toHaveCount(0);
  await expect(page.getByTestId("ql-storeys")).toHaveCount(0);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='home']")).toBeVisible();
}

async function toPaint(page: Page, shape = "wb") {
  await toHome(page);
  await page.getByTestId(`ql-ext-type-${shape}`).click();
  await page.getByTestId("ql-ext-size-md").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible();
}

const range = async (page: Page) => {
  const text = (await page.getByTestId("reveal-range").textContent()) ?? "";
  const m = text.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/);
  return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
};

test("nothing pre-ticked, the questions follow the ticks, no storeys question, and no bedrooms anywhere", async ({ page }) => {
  test.setTimeout(240_000);
  await toPaint(page);
  await expect(page.getByRole("heading", { name: /Tap everything we.re painting/ })).toBeVisible();
  await expect(page.getByText(/bedrooms/i)).toHaveCount(0);
  // Nothing pre-ticked on the parts or the things around the house.
  for (const p of ["walls", "windows", "doors", "fascias", "gutters", "eaves"]) {
    await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "false");
  }
  for (const e of ["paling_fence", "picket_fence", "deck", "pergola", "shed", "wall"]) {
    await expect(page.getByTestId(`ext-extra-${e}`)).toHaveAttribute("aria-pressed", "false");
  }
  // Tom, 5 Oct: the wizard is LIGHT, like the rest of the customer surfaces.
  const bg = await page.locator(".wz").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(244, 246, 248)");
  // No material question here, and no storeys question anywhere (the shape knows).
  await expect(page.getByTestId("ext-walls-q")).toHaveCount(0);
  await expect(page.getByTestId("ql-ext-storeys")).toHaveCount(0);
  await expect(page.locator(".wz-quick")).not.toContainText(/Single or double storey/);

  // Continue with nothing ticked is refused, in words.
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Tick at least one thing/);

  // Tom, 5 Oct: a ticked pergola asks for its top's size and will not continue without it — on About it.
  await page.getByTestId("ext-extra-pergola").click();
  await page.getByTestId("ext-part-fascias").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible();
  await expect(page.getByTestId("ext-size-pergola")).toBeVisible();
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/how big is the pergola top/i);
  // The gated questions are absent until their part is ticked.
  await expect(page.getByTestId("ext-walls-q")).toHaveCount(0);
  await expect(page.getByTestId("ext-windows-q")).toHaveCount(0);
  await page.getByTestId("ql-back").click();
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible();
  await page.getByTestId("ext-extra-pergola").click(); // untick — the question goes with it
  // Tick the walls → the material card appears on About it, nothing pre-ticked; windows → the type.
  await page.getByTestId("ext-part-walls").click();
  await page.getByTestId("ext-part-windows").click();
  await quickNext(page);
  await expect(page.getByTestId("ext-walls-q")).toBeVisible();
  for (const m of ["weatherboards", "brick", "render", "stucco", "cement_sheet", "colorbond", "vertical_timber", "concrete"]) {
    await expect(page.getByTestId(`ext-mat-${m}`)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByTestId("ext-windows-q")).toBeVisible();
  await expect(page.getByTestId("ext-size-pergola")).toHaveCount(0);
  // Access: scaffolding is an EXCLUSION, said the moment they tick it; "nothing tricky" is exclusive.
  await page.getByTestId("ql-ext-access-lift").click();
  await expect(page.getByTestId("ext-lift-note")).toContainText(/separate line/i);
  await page.getByTestId("ql-ext-access-none").click();
  await expect(page.getByTestId("ql-ext-access-lift")).toHaveAttribute("aria-pressed", "false");
});

/**
 * Tom's check, as three walks in order — each a fresh anonymous customer, so
 * nothing resumes between them. The casement range is kept for the colonial
 * comparison.
 */
test.describe.configure({ mode: "serial" });
let casement: { lo: number; hi: number } | null = null;

async function walkTypical(page: Page, windowType: "casement" | "colonial", walls = true) {
  await toPaint(page, "wb");
  if (walls) await page.getByTestId("ext-part-walls").click();
  await page.getByTestId("ext-part-windows").click();
  await page.getByTestId("ext-part-doors").click();
  await page.getByTestId("ext-part-fascias").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible();
  if (walls) await page.getByTestId("ext-mat-weatherboards").click();
  await page.getByTestId(`ql-ext-win-${windowType}`).click();
  await page.getByTestId("ql-ext-colour-new").click();
  // Condition is not asked before the gate (Tom, 15 Sep): the range spans good to peeling.
  await expect(page.getByTestId("ql-ext-condition")).toHaveCount(0);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range|Continue to the last question/);
  await quickNext(page);
  await passGateIfShown(page); // S6: the details-first question sits before the range
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
}

test("Tom's check 1: walls + windows + doors + fascias, casement, new colours → a range with exterior words", async ({ page }) => {
  test.setTimeout(240_000);
  await walkTypical(page, "casement");
  casement = await range(page);
  expect(casement).not.toBeNull();
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the walls, windows, doors and fascias \(weatherboard\), \d+ casement windows, 2 doors, new colours, the paintwork priced from good to peeling, single storey/);
  const doLines = page.getByTestId("what-we-do");
  await expect(doLines).toContainText(/Walls — weatherboard/);
  await expect(doLines).toContainText(/\d+ casement windows/);
  await expect(doLines).toContainText(/2 doors/);
  await expect(doLines).toContainText(/Fascias/);
  await expect(doLines).toContainText(/Not included/);
  await expect(doLines).not.toContainText(/Skirtings|Ceilings and cornices/);
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed")).not.toContainText(/bedroom/i);
  await expect(page.getByTestId("reveal-assumed-windows")).toContainText(/About \d+ windows at the casement rate/);
});

test("Tom's check 2: colonial windows price higher than casements — the rate row, not a multiplier", async ({ page }) => {
  test.setTimeout(240_000);
  expect(casement, "the casement walk must have run first").not.toBeNull();
  await walkTypical(page, "colonial");
  const colonial = (await range(page))!;
  expect(colonial.lo, `colonial ${JSON.stringify(colonial)} vs casement ${JSON.stringify(casement)}`).toBeGreaterThan(casement!.lo);
  await expect(page.getByTestId("what-we-do")).toContainText(/cut in by hand, bar by bar/);
});

test("Tom's check 3: unticking the walls removes them everywhere — the question, What we'll do, the editor", async ({ page }) => {
  test.setTimeout(240_000);
  await walkTypical(page, "casement", false);
  await expect(page.getByTestId("what-we-do")).not.toContainText(/Walls/);
  await expect(page.getByTestId("reveal-restatement")).not.toContainText(/the walls/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/^Based on windows, doors and fascias, \d+ casement windows/);
  await expect(page.getByTestId("ext-range-front")).not.toContainText(/walls/);
  // 21 Oct: Tighten opens the customer editor — the front card carries no wall line.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await expect(front).not.toContainText(/Weatherboards/);
});

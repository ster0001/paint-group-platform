import { test, expect, type Page } from "@playwright/test";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * C8b — the EXTERIOR quick look rebuilt, elements first (prototype `s-ext-job`
 * v2.6). Tom's check: walk it on the phone — nothing pre-ticked; the questions
 * that appear are only the ones you asked for; eight colonial windows price
 * higher than eight casements; unticking the body removes the walls everywhere.
 *
 * The brief's e2e: tick body + windows + doors + fascias, choose colonial, 8
 * windows, 2 doors, new colours, weathered → a range; then untick the body and
 * watch the wall line and the materials question both go.
 */

async function toOutside(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  // Screen 2 is the place: kind only — no bedrooms, no storeys on an outside job.
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await expect(page.getByTestId("ql-bedrooms")).toHaveCount(0);
  await expect(page.getByTestId("ql-storeys")).toHaveCount(0);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible();
}

const range = async (page: Page) => {
  const text = (await page.getByTestId("reveal-range").textContent()) ?? "";
  const m = text.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/);
  return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
};

test("nothing pre-ticked, the questions follow the ticks, storeys once, and no bedrooms anywhere", async ({ page }) => {
  test.setTimeout(240_000);
  await toOutside(page);
  await expect(page.getByRole("heading", { name: "What are we painting?" })).toBeVisible();
  await expect(page.getByText(/confirmed by your estimator/i)).toBeVisible();
  await expect(page.getByText(/bedrooms/i)).toHaveCount(0);

  // Nothing pre-ticked on the elements, the freestanding things, or (once shown) the materials.
  for (const el of ["body", "windows", "doors", "fascias", "gutters", "eaves"]) {
    await expect(page.getByTestId(`ql-ext-el-${el}`)).toHaveAttribute("aria-pressed", "false");
  }
  for (const s of ["fence", "deck", "garage", "wall"]) {
    await expect(page.getByTestId(`ql-ext-sep-${s}`)).toHaveAttribute("aria-pressed", "false");
  }
  // The gated questions are absent until their element is ticked.
  await expect(page.getByTestId("ext-body-q")).toHaveCount(0);
  await expect(page.getByTestId("ext-windows-q")).toHaveCount(0);
  await expect(page.getByTestId("ext-door-count")).toHaveCount(0);
  // Storeys is asked exactly once, here.
  await expect(page.getByTestId("ql-ext-storeys")).toHaveCount(1);
  await expect(page.locator("[data-testid='ql-storeys']")).toHaveCount(0);

  // Continue with nothing ticked is refused, in words.
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Tick at least one thing/);

  // Tick the body → materials appear, nothing pre-ticked.
  await page.getByTestId("ql-ext-el-body").click();
  await expect(page.getByTestId("ext-body-q")).toBeVisible();
  for (const m of ["weatherboards", "brick", "render", "stucco", "cement_sheet", "panelling", "unsure"]) {
    await expect(page.getByTestId(`ql-ext-mat-${m}`)).toHaveAttribute("aria-pressed", "false");
  }
  // Windows → type and count; doors → count. Untick → they go.
  await page.getByTestId("ql-ext-el-windows").click();
  await expect(page.getByTestId("ext-windows-q")).toBeVisible();
  await expect(page.getByTestId("ext-win-n")).toHaveText("8");
  await page.getByTestId("ql-ext-el-doors").click();
  await expect(page.getByTestId("ext-door-n")).toHaveText("2");
  await page.getByTestId("ql-ext-el-windows").click();
  await expect(page.getByTestId("ext-windows-q")).toHaveCount(0);
  await page.getByTestId("ql-ext-el-doors").click();
  await expect(page.getByTestId("ext-door-count")).toHaveCount(0);
  await page.getByTestId("ql-ext-el-body").click();
  await expect(page.getByTestId("ext-body-q")).toHaveCount(0);

  // Access: scaffolding is an EXCLUSION, said the moment they tick it; "nothing tricky" is exclusive.
  await page.getByTestId("ql-ext-el-fascias").click();
  await page.getByTestId("ql-ext-access-lift").click();
  await expect(page.getByTestId("ext-lift-note")).toContainText(/separate line/i);
  await page.getByTestId("ql-ext-access-none").click();
  await expect(page.getByTestId("ql-ext-access-lift")).not.toHaveClass(/\bon\b/);
});

/**
 * Tom's check, as three walks in order — each a fresh anonymous customer, so
 * nothing resumes between them. The casement range is kept for the colonial
 * comparison.
 */
test.describe.configure({ mode: "serial" });
let casement: { lo: number; hi: number } | null = null;

async function walkTypical(page: Page, windowType: "casement" | "colonial", body = true) {
  await toOutside(page);
  if (body) await page.getByTestId("ql-ext-el-body").click();
  await page.getByTestId("ql-ext-el-windows").click();
  await page.getByTestId("ql-ext-el-doors").click();
  await page.getByTestId("ql-ext-el-fascias").click();
  if (body) await page.getByTestId("ql-ext-mat-weatherboards").click();
  await page.getByTestId(`ql-ext-win-${windowType}`).click();
  await expect(page.getByTestId("ext-win-n")).toHaveText("8");
  await expect(page.getByTestId("ext-door-n")).toHaveText("2");
  await page.getByTestId("ql-ext-colour-new").click();
  await page.getByTestId("ql-ext-condition-weathered").click();
  await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range/);
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
}

test("Tom's check 1: body + windows + doors + fascias, casement ×8, doors ×2, new colours, weathered → a range with exterior words", async ({ page }) => {
  test.setTimeout(240_000);
  await walkTypical(page, "casement");
  casement = await range(page);
  expect(casement).not.toBeNull();
  await expect(page.getByTestId("reveal-restatement")).toContainText(/the walls, windows, doors and fascias \(weatherboard\), 8 casement windows, 2 doors, new colours, weathered paintwork, single storey/);
  await expect(page.getByTestId("reveal-restatement")).not.toContainText(/bedroom/);
  // What we'll do is the EXTERIOR derivation — never the interior lines.
  const doLines = page.getByTestId("what-we-do");
  await expect(doLines).toContainText(/Walls — weatherboard/);
  await expect(doLines).toContainText(/8 casement windows/);
  await expect(doLines).toContainText(/2 doors/);
  await expect(doLines).toContainText(/Fascias/);
  await expect(doLines).toContainText(/Not included/);
  await expect(doLines).not.toContainText(/Skirtings|Ceilings and cornices/);
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed")).not.toContainText(/bedroom/i);
  await expect(page.getByTestId("reveal-assumed-windows")).toContainText(/8 windows at the casement rate/);
});

test("Tom's check 2: eight colonial windows price higher than eight casements — the rate row, not a multiplier", async ({ page }) => {
  test.setTimeout(240_000);
  expect(casement, "the casement walk must have run first").not.toBeNull();
  await walkTypical(page, "colonial");
  const colonial = (await range(page))!;
  expect(colonial.lo, `colonial ${JSON.stringify(colonial)} vs casement ${JSON.stringify(casement)}`).toBeGreaterThan(casement!.lo);
  await expect(page.getByTestId("what-we-do")).toContainText(/cut in by hand, bar by bar/);
});

test("Tom's check 3: unticking the body removes the walls everywhere — the question, What we'll do, the sides", async ({ page }) => {
  test.setTimeout(240_000);
  await walkTypical(page, "casement", false);
  await expect(page.getByTestId("what-we-do")).not.toContainText(/Walls/);
  await expect(page.getByTestId("reveal-restatement")).not.toContainText(/the walls/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/^Based on windows, doors and fascias, 8 casement windows/);
  await page.getByTestId("door-tighten").click();
  await expect(page.locator('[data-side="front"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-side="front"] .sd-wall')).toHaveCount(0);
});

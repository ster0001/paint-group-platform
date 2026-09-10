import { test, expect } from "@playwright/test";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * The EXTERIOR quick look — prototype `s-ext-job`, "About the house" (§3's
 * exterior branch, §9.7). Five answers on one screen, then a guide range.
 *
 * It replaced the five-page exterior question set, and it could not be built
 * until the per-elevation allowances existed — every answer in the access row
 * feeds one.
 */
test("an outside job answers five things on one screen and gets a range", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);

  // Screen 2 is the place; an outside job skips the rooms entirely.
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await quickNext(page);

  // Screen 3 — the exterior quick look, not the old five pages.
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "About the house" })).toBeVisible();
  // A person confirms every outside price, and we say so before the number.
  await expect(page.getByText(/confirmed by your estimator/i)).toBeVisible();
  // No interior questions anywhere — there are no rooms to ask about.
  await expect(page.getByText(/bedrooms/i)).toHaveCount(0);
  await expect(page.getByText(/ceiling height/i)).toHaveCount(0);

  await page.getByTestId("ql-ext-storeys-double").click();
  await page.getByTestId("ql-ext-substrate-render").click();
  await page.getByTestId("ql-ext-target-fence").click();
  await page.getByTestId("ql-ext-condition-weathered").click();
  await page.getByTestId("ql-ext-access-steep").click();

  // Scaffolding is an EXCLUSION, said the moment they tick it — never a
  // surprise on the invoice, and never an hours allowance.
  await page.getByTestId("ql-ext-access-lift").click();
  await expect(page.getByTestId("ext-lift-note")).toContainText(/separate line/i);
  // "Nothing tricky" is exclusive both ways.
  await page.getByTestId("ql-ext-access-none").click();
  await expect(page.getByTestId("ql-ext-access-steep")).not.toHaveClass(/\bon\b/);
  await page.getByTestId("ql-ext-access-steep").click();
  await expect(page.getByTestId("ql-ext-access-none")).not.toHaveClass(/\bon\b/);

  await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range/);
  await quickNext(page);

  // The reveal, then the sides editor — which is where "walk around the house"
  // lives (prototype s-ext-sides), and where a side becomes NOT PAINTING.
  await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE);
  await page.getByTestId("door-tighten").click();
  await expect(page.locator('[data-side="sweep"]')).toBeVisible({ timeout: 60_000 });
  // Four sides, all assumed until the customer walks them — and saying no to
  // one here is what makes it an explicit exclusion on the quote.
  await expect(page.locator('[data-side="front"]')).toBeVisible();

  /**
   * Folded in from exterior-no-photos.spec.ts, which this supersedes. Its
   * subject was "the old gate demanded a listing or two facades; the third way
   * is explicit" — there is no gate left to prove absent, because walking the
   * quick look as an outside job IS that third way. What still matters is the
   * half that was never about the gate: a job built from answers alone arrives
   * with typical side sizes to CONFIRM, not an empty screen.
   */
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  // ⚑ Tom, 10 Sep: the size is ASKED, not read back for agreement — the boxes
  // are there from the start, with what we assumed shown as what we USED.
  await expect(front.getByTestId("side-assumed-front")).toContainText(/5\.5 m/);
  await expect(front.getByTestId("side-dims-front")).toBeVisible();

  /**
   * Tom, 10 Sep: "the walls % isn't sitting in the box cleanly." It is a wall
   * ROW now, spanning the grid, with the four percent buttons sharing the width
   * — so the measurable claim is that they sit INSIDE the tile rather than
   * spilling past its rounded corner. Asserted rather than eyeballed, at the
   * width where it broke.
   */
  const wall = front.locator(".sd-wall").first();
  await wall.scrollIntoViewIfNeeded();
  const tile = await wall.boundingBox();
  const pcts = await wall.locator(".sd-pcts").boundingBox();
  expect(pcts!.x).toBeGreaterThanOrEqual(tile!.x - 1);
  expect(pcts!.x + pcts!.width).toBeLessThanOrEqual(tile!.x + tile!.width + 1);
  // And the four buttons are on ONE row — the ragged wrap was the complaint.
  const rows = new Set(await wall.locator(".sd-pc").evaluateAll(
    (els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().top)),
  ));
  expect(rows.size, "the four percent buttons must sit on one row").toBe(1);
  // And at PHONE width, which is where it broke: a 150px grid column could not
  // hold four 36px buttons plus the label, so they wrapped raggedly and spilled
  // past the tile's corner.
  await page.setViewportSize({ width: 390, height: 1500 });
  await wall.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const narrow = await wall.boundingBox();
  const narrowPcts = await wall.locator(".sd-pcts").boundingBox();
  expect(narrowPcts!.x + narrowPcts!.width).toBeLessThanOrEqual(narrow!.x + narrow!.width + 1);
  const phoneRows = new Set(await wall.locator(".sd-pc").evaluateAll(
    (els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().top)),
  ));
  expect(phoneRows.size, "one row on a phone too").toBe(1);
});

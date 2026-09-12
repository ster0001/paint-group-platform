import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

/**
 * C13 — the warehouse pattern (addendum S6b, prototype `s-com-warehouse`).
 *
 * Tom's check: Warehouse → 1,000–2,500 m², 4–6 m, some racking → a range with
 * the scissor-lift line shown. The brief's e2e: 1,000–2,500 m², 4–6 m,
 * precast, some racking, operating → range → tighten the warehouse floor → send.
 * Accept: flagged items appear as "priced on confirmation"; no beds or
 * storeys on the path.
 */

async function toWarehouse(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ql-segment-warehouse").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_warehouse']")).toBeVisible({ timeout: 30_000 });
}

test("the warehouse screen: area and height, no beds or storeys, counted doors, materials only if walls, three access answers", async ({ page }) => {
  test.setTimeout(240_000);
  await toWarehouse(page);
  await expect(page.getByRole("heading", { name: "Tell us about the space" })).toBeVisible();
  await expect(page.getByText(/bedroom/i)).toHaveCount(0);
  await expect(page.getByText(/storey/i)).toHaveCount(0);
  // The prototype's defaults: 500–1,000, 4–6 m, walls + roller ×2 + personnel ×4 + offices ×2; nothing pre-ticked on the materials.
  await expect(page.getByTestId("wh-area-1000")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("wh-height-6")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("wh-count-rollerDoors-n")).toHaveText("2");
  await expect(page.getByTestId("wh-count-personnelDoors-n")).toHaveText("4");
  await expect(page.getByTestId("wh-count-offices-n")).toHaveText("2");
  for (const m of ["precast", "blockwork", "sheeting", "cement_sheet", "plasterboard", "unsure"]) {
    await expect(page.getByTestId(`wh-mat-${m}`)).toHaveAttribute("aria-pressed", "false");
  }
  // Flagged rows say so on the tile.
  await expect(page.getByTestId("wh-surf-roof")).toContainText(/priced on confirmation/);
  // Materials go when the walls go.
  await page.getByTestId("wh-surf-walls").click();
  await expect(page.getByTestId("wh-materials-q")).toHaveCount(0);
  await page.getByTestId("wh-surf-walls").click();
  await expect(page.getByTestId("wh-materials-q")).toBeVisible();
  // The steppers count.
  await page.getByTestId("wh-count-rollerDoors-plus").click();
  await expect(page.getByTestId("wh-count-rollerDoors-n")).toHaveText("3");
  // Nothing ticked is refused, in words. (Tap the label — the counted cards
  // carry a stepper in their middle, which is its own control.)
  for (const k of ["walls", "roller", "personnel", "offices"]) await page.getByTestId(`wh-surf-${k}`).locator("b").click();
  await expect(page.getByTestId("wh-surf-offices")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("ql-error")).toContainText(/Tick at least one thing/);
});

test("Tom's check: 1,000–2,500 m², 4–6 m, precast, some racking, operating → a range with the scissor-lift line; tighten the warehouse floor", async ({ page }) => {
  test.setTimeout(300_000);
  await toWarehouse(page);
  await page.getByTestId("wh-area-2500").click();
  await page.getByTestId("wh-height-6").click();
  await page.getByTestId("wh-mat-precast").click();
  await page.getByTestId("wh-rack-some").click();
  await page.getByTestId("wh-op-yes").click();
  await quickNext(page);

  // The shared job screen, with the warehouse row's own words and no surface tiles.
  await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-surf")).toHaveCount(0);
  await expect(page.getByTestId("ql-condition-wear")).toContainText(/forklift/i);
  await expect(page.getByTestId("com-occ")).toHaveCount(0);
  await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range/);
  await quickNext(page);

  // The reveal — the warehouse words and the scissor-lift line on the assume list.
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-kicker")).toContainText(/Industrial or warehouse/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/a large warehouse, 4–6 m high, racking against some walls/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/operating during the works/);
  await expect(page.getByTestId("reveal-restatement")).not.toContainText(/bedroom|storey/);
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed-height")).toContainText(/Scissor lift hire allowed for, shown as its own line/);
  await expect(page.getByTestId("reveal-assumed-racking")).toContainText(/paint above the racking/);
  // Never fix-online.
  await expect(page.locator("body")).not.toContainText(/Fix (my )?price online|Fix online/i);

  // Tighten: the warehouse floor is a room card; the scissor-lift and the
  // precast prep are on the settle list as "priced on confirmation" flags.
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible({ timeout: 60_000 });
  const body = await page.locator("body").innerText();
  expect(body).toContain("Warehouse floor");
  expect(body).toContain("Office 1");
  const settle = page.locator(".wz-confirmonsite");
  await expect(settle).toContainText(/Scissor lift for walls to 5 m/, { timeout: 60_000 });
  await expect(settle).toContainText(/precast \/ tilt slab — preparation/);
  await expect(settle).toContainText(/racking against some walls/);
  await expect(page.locator("body")).not.toContainText(/Fix (my )?price online|Fix online|Accept estimate/i);
});

test("a lift on site removes the scissor-lift line; up to 4 m never has one", async ({ page }) => {
  test.setTimeout(240_000);
  await toWarehouse(page);
  await page.getByTestId("wh-mat-sheeting").click();
  await page.getByTestId("wh-lift-yes").click();
  await quickNext(page);
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed-height")).toContainText(/Your lift used — no hire allowed for/);
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText(/Scissor lift for walls/);
});

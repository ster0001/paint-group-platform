import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Parity PR — loop mechanics (Inventory A3, B4/B5, C1 + exterior $ toasts):
 *  - interior cards COLLAPSE; confirming auto-opens the next unconfirmed
 *    card and scrolls it into view (mockup openRoom behaviour)
 *  - window GROUPS render as their own tiles with the S/M/L seg INSIDE the
 *    tile (not a row under the grid)
 *  - the sides visual panel carries the geometry chips + "Not right? Tell
 *    us", which flips the job to the visit tier
 *  - exterior delta toasts carry $ amounts like the mockup's
 */

test("interior: cards collapse, confirm auto-advances + scrolls, window groups in-tile", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const cards = page.locator(".sc-rc[data-room]");
  const first = cards.first();
  const second = cards.nth(1);

  // Only the first unconfirmed card starts open; the second is collapsed.
  await expect(first.locator(".il-q").first()).toBeVisible();
  await expect(second.locator(".il-q")).toHaveCount(0);

  // Window groups are tiles with S/M/L INSIDE (never a row below the grid):
  // add one from the panel and assert the seg sits inside the tile.
  await expect(page.locator(".il-wingroups")).toHaveCount(0);
  await first.getByRole("button", { name: /\+ Add a surface/ }).click();
  await first.getByRole("button", { name: /More windows — a different size/ }).click();
  const winTile = first.locator(".sc-tl", { hasText: "More windows" }).first();
  await expect(winTile).toBeVisible({ timeout: 15_000 });
  await expect(winTile.locator(".sd-wseg")).toBeVisible();
  await expect(winTile.locator(".sc-st")).toBeVisible();

  // Confirm the first room → it collapses, the SECOND opens and is scrolled
  // into view.
  await first.getByRole("button", { name: /Looks right/ }).click();
  const cup = first.locator(".il-cup");
  if (await cup.count()) await cup.getByRole("button", { name: "No", exact: true }).click();
  await first.locator(".il-confirm").click();
  await expect(first).toHaveClass(/done/, { timeout: 15_000 });
  await expect(second.locator(".il-q").first()).toBeVisible({ timeout: 15_000 });
  await expect(second).toBeInViewport();
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

test("exterior: geometry chips + flag flip the tier; toasts carry $ amounts", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/estimate");
  await page.getByRole("button", { name: "Exterior", exact: true }).click();
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400031");
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page.locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("Heritage listed", "No");
  await answer("What kind of property", "House");
  const next = async () => page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
  await next(); await next(); await next();
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await next(); await next();
  const email = page.locator("input[type=email]");
  if (await email.count()) await email.fill(`e2e-mech-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  await expect(page.locator(".wz-r")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: /Open the editor/i }).click();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });

  // Geometry chips read from the answers; the flag button is right there.
  const visual = page.locator(".sd-visual");
  await expect(visual).toContainText(/SINGLE STOREY/i);
  await expect(visual).toContainText(/WEATHERBOARD/i);

  // A priced change toasts a $ amount (mockup: "Windows ×3 — +$120").
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  const winTile = front.locator(".sd-tl", { hasText: "Windows" }).first();
  await winTile.locator(".sd-st button", { hasText: "+" }).click();
  await expect(page.locator(".sd-toast")).toContainText(/[+−-]\$\d/, { timeout: 15_000 });

  // "Not right? Tell us" flags geometry → visit tier with the named reason.
  await visual.getByRole("button", { name: /Not right\? Tell us/ }).click();
  await expect(page.locator(".sd-toast")).toContainText(/estimator will confirm this on site/i, { timeout: 15_000 });
  await expect(page.locator(".sd-tier")).toHaveClass(/visit/, { timeout: 15_000 });
});

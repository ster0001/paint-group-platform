import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./customer-journey/drive";

/**
 * PR screenshot capture — not a test of behaviour (the journey suite owns
 * that); drives each editor to a photogenic state and saves full-page shots
 * to test-results/pr-shots/ for the PR description. Run on demand:
 *   npx playwright test e2e/pr-screenshots.spec.ts
 */

const shot = (page: import("@playwright/test").Page, name: string) =>
  page.screenshot({ path: `test-results/pr-shots/${name}.png`, fullPage: true });

test("capture: interior confirm loop", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  await shot(page, "interior-01-loop-start");
  const cards = page.locator(".sc-rc[data-room]");
  const first = cards.first();
  await first.getByRole("button", { name: /Looks right/ }).click();
  const cup = first.locator(".il-cup");
  if (await cup.count()) await cup.getByRole("button", { name: "No", exact: true }).click();
  await first.locator(".il-confirm").click();
  await expect(first).toHaveClass(/done/, { timeout: 15_000 });
  await shot(page, "interior-02-first-room-confirmed");
});

test("capture: exterior sides loop", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/estimate");
  await page.getByRole("button", { name: "Exterior", exact: true }).click();
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400009");
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
  if (await email.count()) await email.fill(`e2e-shots-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  // 28 Aug: the wizard lands straight in the editor.
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 90_000 });
  await shot(page, "exterior-01-sides-start");
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  await front.getByRole("button", { name: /Looks right/ }).click();
  await front.getByRole("button", { name: /Add a surface/ }).click();
  await front.getByRole("button", { name: /Render — wall surface/ }).click();
  await expect(front.locator(".sd-wall")).toHaveCount(2, { timeout: 15_000 });
  await shot(page, "exterior-02-front-walls-mix");
  await front.getByRole("button", { name: /Confirm front/i }).click();
  await expect(front).toHaveClass(/done/, { timeout: 15_000 });
  await shot(page, "exterior-03-front-confirmed");
  await expect(page.locator(".sc-r, .sd-range").first()).toHaveText(MONEY_RANGE);
});

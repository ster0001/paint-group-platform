import { test, expect } from "@playwright/test";
import { MONEY_RANGE, fillContactStep } from "./drive";

/**
 * Batch 4 — "Both" jobs get the STACKED editor (Tom's ruling on the parity
 * audit): the interior confirm loop first, then the four sides + exterior
 * meta cards, ONE combined progress count, ONE CTA — and always the visit
 * tier in v1 (mixed scope needs eyes). The old element-grouped exterior
 * editor is DELETED — no estimate renders it any more; pre-rebuild
 * estimates get a polite start-again holding message instead.
 */

test("Both job: interior cards then sides, combined progress, single visit CTA", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/estimate");
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400051");
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
  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // → page 2: surfaces (Inside + Outside)
  await next(); // condition
  await next(); // details
  await answer(/built before 1970/, "No");
  await next(); // paint
  await next(); // → contact, the LAST page (Tom, 31 Aug)
  await fillContactStep(page, `e2e-both-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  // 28 Aug: the wizard lands straight in the confirm-loop editor.
  await expect(page.locator(".sc-r").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });

  // BOTH structures on one page: interior room cards AND the four sides.
  const roomCards = page.locator(".sc-rc[data-room]");
  expect(await roomCards.count()).toBeGreaterThan(2);
  await expect(page.locator(".sd-card", { hasText: "Front" })).toBeVisible();
  await expect(page.locator(".sd-card", { hasText: /anything we haven.t listed/i })).toBeVisible();

  // ONE combined progress: rooms + dw + sweep + 8 exterior items.
  const rooms = await roomCards.count();
  await expect(page.locator(".il-prog")).toContainText(`0 OF ${rooms + 2 + 8}`);

  // The old element-grouped exterior editor is GONE.
  await expect(page.locator(".sc-grouplbl")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Whole house" })).toHaveCount(0);

  // Single CTA; mixed scope is ALWAYS the visit tier, and it says so.
  const cta = page.locator(".il-cta");
  await expect(cta).toBeDisabled();
  await expect(page.locator(".sc-tier")).toContainText(/visit/i);
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

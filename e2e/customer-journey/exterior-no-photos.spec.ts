import { test, expect } from "@playwright/test";
import { MONEY_RANGE, fillContactStep } from "./drive";

/**
 * Tom, 31 Aug: exterior FROM SCRATCH — no listing, no floorplan, no photos.
 * Page 1 offers "No photos to hand? We'll size it from your answers"; the
 * elevations arrive at typical sizes (tagged assumed) and the confirm loop
 * settles them side by side, exactly like every other exterior.
 */
test("an exterior job builds from answers alone — no listing, no photos", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/estimate");
  await page.getByRole("button", { name: "Exterior", exact: true }).click();

  // The old gate demanded a listing or two facades; the third way is explicit.
  await page.getByRole("button", { name: /No photos to hand/ }).click();
  await expect(page.getByText(/size it from your answers. Tap to undo/i)).toBeVisible();

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
  await next(); // → the house (the gate accepted the no-photos path)
  await next(); // → scope
  await next(); // → condition
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await next(); // → extras + paint
  await next(); // → contact, the LAST page
  await fillContactStep(page, `e2e-nophotos-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();

  // A priced range, organised by sides — the same editor as every exterior.
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".sc-r, .sd-range").first()).toHaveText(MONEY_RANGE, { timeout: 30_000 });
  // The sides carry the typical sizes to confirm — the front card opens with
  // a size question, not an empty screen.
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(front.locator(".sd-size")).toContainText(/m long/i);
});

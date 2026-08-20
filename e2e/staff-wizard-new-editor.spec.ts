import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom (20 Aug): "new estimate → start with the wizard" must land in the NEW
 * confirm-loop editor, not the old W3 internal editor (point price + margin
 * + confirm chips). Staff land on /estimate/scope — the same view the
 * customer gets (R1.1 parity); margin stays where it belongs, in /quote.
 */

test("staff wizard submit lands in the new confirm-loop editor", async ({ page }) => {
  const staff = credentials("STAFF");
  test.skip(!staff, missingCreds("STAFF"));
  test.setTimeout(240_000);
  await signIn(page, staff!, /estimates/);

  await page.goto("/estimates");
  await page.getByRole("button", { name: /New estimate/i }).click();
  await page.getByRole("link", { name: /Start with the wizard/i }).click();
  await expect(page).toHaveURL(/\/wizard/);

  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  const next = async () => {
    await page.getByRole("button", { name: /Continue|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // surfaces
  await next(); // condition
  await next(); // details
  await next(); // paint
  await page.getByRole("button", { name: "See my estimate" }).click();

  // The NEW editor: confirm-loop chrome, amber cards — and no margin.
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 90_000 });
  await expect(page.locator(".il-prog")).toContainText(/0 OF \d+/, { timeout: 30_000 });
  await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/MARGIN/i);
});

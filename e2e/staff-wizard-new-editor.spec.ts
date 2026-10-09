import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { fillQuickAddress, passGateIfShown, quickNext, MONEY_RANGE } from "./customer-journey/drive";

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
  await signIn(page, staff!, /\/(home|estimates)/);

  await page.goto("/estimates");
  // Exact name: the list's own rows can be titled "New estimate (assistant)", and their
  // Duplicate / Delete buttons carry that title in their labels — a pattern matched 39 of them.
  await page.getByRole("button", { name: "+ New estimate", exact: true }).click();
  await page.getByRole("link", { name: /Start with the wizard/i }).click();
  // Since 6 Sep (6ac528dd) "Start with the wizard" is the CUSTOMER estimator, run by staff —
  // the quick look at /estimate, not the old five-page /wizard this spec used to walk.
  await expect(page).toHaveURL(/\/estimate(\?|$)/);
  await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });

  await fillQuickAddress(page);
  await quickNext(page); // address
  await quickNext(page); // the place
  await quickNext(page); // the job
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page); // the rooms
  await quickNext(page); // condition
  await passGateIfShown(page, { email: `staff.wizard.${Date.now()}@example.com` });
  await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();

  // The NEW editor: confirm-loop chrome, amber cards — and no margin.
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 90_000 });
  await expect(page.locator(".il-prog")).toContainText(/0 OF \d+/, { timeout: 30_000 });
  await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/MARGIN/i);
});

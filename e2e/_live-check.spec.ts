import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
const staff = credentials("STAFF");
test("live: invoice preview wears invoice dress", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  await signIn(page, staff!, /\/estimates/);
  await page.goto("/invoices");
  await page.locator('[data-testid^="revise-"]').first().click();
  await expect(page.getByTestId("revision-badge")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("view-invoice").click();
  const preview = page.getByTestId("invoice-preview");
  await expect(preview).toContainText(/Invoice\s+EST-/, { timeout: 20_000 });
  await expect(preview).toContainText("Your invoice · incl. GST");
  await expect(preview).not.toContainText("Accept estimate");
  await page.screenshot({ path: "test-results/live-invoice-dress.png", fullPage: false });
});

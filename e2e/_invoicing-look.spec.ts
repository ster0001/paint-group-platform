import { test } from "@playwright/test";
import { credentials, signIn } from "./helpers";
const OUT = process.env.LOOK_OUT ?? "test-results/invoicing-look";

test("invoicing screens on a phone", async ({ page }) => {
  test.skip(!credentials("STAFF"), "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  await signIn(page, credentials("STAFF")!, /\/estimates/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/invoicing");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/dashboard.png`, fullPage: true });
  // first row → invoice doc
  const row = page.locator(".r").first();
  if (await row.count()) {
    const jobLink = row.locator(".job a");
    const jobHref = await jobLink.getAttribute("href");
    await row.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/document.png`, fullPage: true });
    if (jobHref) {
      await page.goto(jobHref);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/money-view.png`, fullPage: true });
      await page.getByRole("button", { name: "Request payment" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/request-sheet.png` });
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Invoices" }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/invoices-tab.png`, fullPage: true });
    }
  }
});

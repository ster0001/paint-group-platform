import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Post-deploy smoke on the LIVE site (read-only): the two money tabs and the
 * contractor claim card.
 * Run: E2E_BASE_URL=https://paint-group-platform.vercel.app npx playwright test e2e/_live-tabs-check.spec.ts
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

test("staff: /invoices (Invoicing) + /invoicing (Payments) both render", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  await signIn(page, staff!, /\/estimates/);

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Invoicing" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Payments dashboard/ })).toBeVisible();
  await page.screenshot({ path: "test-results/live-invoices-tab.png", fullPage: true });

  await page.goto("/invoicing?tab=pay");
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByTestId("tile-to-approve")).toBeVisible();
  await page.screenshot({ path: "test-results/live-payments-tab.png", fullPage: true });
});

test("contractor: the Money tab carries the claim card", async ({ page }) => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  await signIn(page, contractor!, /\/portal/);
  await page.goto("/portal/money");
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  await page.screenshot({ path: "test-results/live-portal-claims.png", fullPage: true });
});

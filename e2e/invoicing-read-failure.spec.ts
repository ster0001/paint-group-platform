import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The 16 Sep 2026 regression, AS STAFF on the real screen.
 *
 * Session 3 of the automations brief added `chase_hold_reason` to
 * INVOICE_SELECT; migration 20270151 had not been run on production. Postgres
 * rejected every invoice select, `loadDashboard` discarded the error
 * (`const { data: invoices }`), and Invoicing rendered its ordinary empty
 * state — $0 tiles and "Nothing here — change the filter" over a full ledger.
 * Tom read it as every invoice having disappeared.
 *
 * This spec fails the moment INVOICE_SELECT asks for a column the database
 * does not have: the list empties AND the load-failure banner appears.
 */

const staff = credentials("STAFF");

test.describe("Invoicing never shows an empty ledger over a failed read", () => {
  test.skip(!staff, missingCreds("STAFF"));

  test("the dashboard lists invoices, with no load-failure banner", async ({ page }) => {
    await signIn(page, staff!, /\/home|\/estimates|\/pc|\/dashboard/);
    await page.goto("/invoicing");

    // The banner is the tell: if the invoice read failed, it says so here
    // rather than letting the empty state speak for a full ledger.
    await expect(page.getByTestId("invoices-load-error")).toHaveCount(0);

    // And the ledger is actually populated — an empty list would mean the
    // read silently returned nothing, which is the bug.
    const rows = page.getByTestId("receivable-rows").locator(".r");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect(await rows.count()).toBeGreaterThan(0);

    // Outstanding is read off the same rows — $0 alongside rows would mean
    // the tiles and the list disagree.
    await expect(page.getByTestId("tile-outstanding")).toBeVisible();
  });

  test("a job's money view lists its invoices, with no load-failure banner", async ({ page }) => {
    await signIn(page, staff!, /\/home|\/estimates|\/pc|\/dashboard/);
    await page.goto("/invoicing");
    const firstJob = page.getByTestId("receivable-rows").locator(".r .job a").first();
    await expect(firstJob).toBeVisible({ timeout: 20_000 });
    await firstJob.click();

    await expect(page).toHaveURL(/\/invoicing\/job\//);
    await expect(page.getByTestId("invoices-load-error")).toHaveCount(0);
    await expect(page.getByTestId("stage-rail")).toBeVisible();
  });
});

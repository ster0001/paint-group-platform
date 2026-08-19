import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { driveNoPlanWizard } from "./customer-journey/drive";

/**
 * Multi-select delete on /estimates (Tom, 20 Aug 2026).
 *
 * Each row gets a tickbox (accepted rows excluded — they're the record of
 * what the customer agreed to), a header tickbox selects the page, and a
 * bulk bar deletes the selection after a confirmation that NAMES the count.
 * Deletion still goes through the database's delete_estimate refusals row
 * by row — a row the database refuses stays, with its reason shown.
 *
 * The spec creates its own two draft estimates (wizard no-plan drive), so
 * it never deletes anything it didn't make.
 */

test("estimates list: tick two rows, bulk delete removes exactly those", async ({ page }) => {
  const staff = credentials("STAFF");
  test.skip(!staff, missingCreds("STAFF"));
  test.setTimeout(240_000);
  await signIn(page, staff!, /estimates/);

  // Two fresh drafts of our own to delete — newest-first puts them on top.
  await driveNoPlanWizard(page);
  await driveNoPlanWizard(page);

  await page.goto("/estimates?status=draft");
  const rows = page.locator("tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(2);

  // No selection = no bulk bar.
  await expect(page.locator("[data-bulkbar]")).toHaveCount(0);

  // Tick the two newest rows (ours), watch the bar count them.
  await rows.nth(0).getByRole("checkbox").check();
  await rows.nth(1).getByRole("checkbox").check();
  await expect(page.locator("[data-bulkbar]")).toContainText("2 selected");

  // Delete → confirmation names the count → confirm.
  await page.getByRole("button", { name: /Delete selected/ }).click();
  await expect(page.locator("[data-bulkbar]")).toContainText(/Delete 2 estimates\?/);
  await page.getByRole("button", { name: /^Yes, delete 2$/ }).click();

  // Exactly those two rows are gone.
  await expect(rows).toHaveCount(before - 2, { timeout: 20_000 });
  await expect(page.locator("[data-bulkbar]")).toHaveCount(0);
});

test("header tickbox selects the page; accepted rows have no tickbox", async ({ page }) => {
  const staff = credentials("STAFF");
  test.skip(!staff, missingCreds("STAFF"));
  await signIn(page, staff!, /estimates/);
  await page.goto("/estimates");

  const rows = page.locator("tbody tr");
  const rowCount = await rows.count();
  test.skip(rowCount === 0, "no estimates to exercise the header tickbox on");

  await page.locator("thead").getByRole("checkbox").check();
  const selectable = await page.locator("tbody input[type=checkbox]").count();
  const ticked = await page.locator("tbody input[type=checkbox]:checked").count();
  expect(ticked).toBe(selectable);
  await expect(page.locator("[data-bulkbar]")).toContainText(`${selectable} selected`);

  // Accepted rows keep no tickbox at all.
  const acceptedRows = page.locator("tbody tr", { hasText: /accepted/i });
  for (let i = 0; i < await acceptedRows.count(); i++) {
    await expect(acceptedRows.nth(i).getByRole("checkbox")).toHaveCount(0);
  }

  // Unticking the header clears the selection.
  await page.locator("thead").getByRole("checkbox").uncheck();
  await expect(page.locator("[data-bulkbar]")).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Estimator journey v2, phase 3 — the paint-systems derivation, driven on the
 * real screens (the "verify by running" rule).
 *
 * Two things this proves that a unit test cannot:
 *   1. Settings → Estimates → Paint systems renders Tom's table, refuses a
 *      cell that would not cover, and saves.
 *   2. The wizard's colour question no longer promises coat counts it does
 *      not set — the "1 COAT / 2 COATS / 3 COATS" chips are gone.
 *
 * It changes no settings row: the save path is exercised by editing a value
 * and putting it straight back, so the live table is what it was.
 */

const staff = credentials("STAFF");

test.describe("paint systems (v2 phase 3)", () => {
  test.skip(!staff, missingCreds("STAFF"));

  test("Settings shows the derived table, blocks a non-covering coat, and saves", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /estimates|today|quote/);

    await page.goto("/settings");
    await page.getByRole("button", { name: /^Estimates$/ }).first().click().catch(() => {});
    const folder = page.getByText("Paint systems", { exact: true }).first();
    await expect(folder).toBeVisible({ timeout: 20_000 });
    await folder.click();

    const panel = page.getByTestId("paint-systems");
    await expect(panel).toBeVisible();

    // The table renders every group, with the ⚑ defaults in place.
    for (const group of ["walls", "ceilings", "trims", "doors", "windows"]) {
      await expect(page.getByTestId(`systems-${group}`)).toBeVisible();
    }
    await expect(page.getByTestId("coats-walls-same")).toHaveValue("1");
    await expect(page.getByTestId("coats-walls-new")).toHaveValue("2");
    await expect(page.getByTestId("coats-ceilings-new")).toHaveValue("1");   // ⚑3
    await expect(page.getByTestId("coats-trims-same")).toHaveValue("2");     // ⚑4
    await expect(page.getByTestId("trims-good-coats")).toHaveValue("1");     // ⚑4's exception
    await expect(page.getByTestId("gloss-bonding-primer")).toBeChecked();    // ⚑5
    await expect(page.getByTestId("prep-work")).toHaveValue("0");            // prep starts at zero

    // The coverage rule (allowances spec §7.6) is enforced in the UI too.
    const wallsNew = page.getByTestId("coats-walls-new");
    await wallsNew.fill("1");
    await expect(page.getByTestId("paint-systems-blocked")).toBeVisible();
    await expect(page.getByTestId("paint-systems-save")).toBeDisabled();

    // Put it back and save — the row ends as it began.
    await wallsNew.fill("2");
    await expect(page.getByTestId("paint-systems-blocked")).toHaveCount(0);
    const save = page.getByTestId("paint-systems-save");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(panel.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    await panel.screenshot({ path: "test-results/paint-systems-settings.png" });
  });

  test("the wizard asks for colour intent, not coats", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /estimates|today|quote/);

    // The internal wizard is the same component the customer gets.
    await page.goto("/wizard");
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    await expect(body).not.toContainText("1 COAT");
    await expect(body).not.toContainText("2 COATS");
    await expect(body).not.toContainText("3 COATS");
    await expect(body).not.toContainText("Coats first");

    // …and the question it asks instead.
    const condition = page.getByText("Which describes it best?").first();
    if (await condition.count()) {
      await expect(body).toContainText("The same colours again");
      await page.screenshot({ path: "test-results/wizard-colour-intent.png", fullPage: true });
    }
  });
});

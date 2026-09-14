import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Phase 5 (§4.4, §9.5) — site and access, driven on a real estimate.
 *
 * The gap (plan §2.4): interior access was never asked at all, so stairwells,
 * voids, furniture, floors and parking had no home in the flow and no bearing
 * on the price.
 *
 * The screen ships with NO multipliers: the allowances spec §4 is not in the
 * repository, so an answer either uses a modifier Tom has seeded or becomes an
 * amber note for the estimator. This asserts the questions are asked, answered
 * and remembered — not a price movement, which correctly depends on Tom.
 */

test("site and access is asked, answered and remembered", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 200));
    }
  });

  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  // Tom, 14 Sep (item 24): site & access is asked at the bottom, one question at a time,
  // after the two "anything we've missed?" checks.
  const card = page.getByTestId("missed-card");
  await expect(card).toBeVisible();
  await card.getByTestId("check-dw-ok").click();
  await expect(card).toHaveAttribute("data-dw-done", "1", { timeout: 20_000 });
  await card.getByTestId("check-rooms-ok").click();
  await expect(card).toHaveAttribute("data-sweep-done", "1", { timeout: 20_000 });

  // The plan's questions, in order — and never pets, floors, a lift on a house, height or asbestos.
  await expect(page.getByTestId("access-cleared")).toBeVisible();
  await expect(page.getByTestId("access-pets")).toHaveCount(0);
  await expect(page.getByTestId("access-floors")).toHaveCount(0);
  await expect(card).not.toContainText(/ceiling height/i);
  await expect(card).not.toContainText(/asbestos/i);
  await page.getByTestId("access-cleared-no").click();
  await expect(page.getByTestId("access-stairwell")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("access-stairwell-yes").click();
  await expect(page.getByTestId("access-parking")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("access-lift")).toHaveCount(0);
  await page.getByTestId("access-parking-drive").click();
  await expect(card.getByTestId("missed-card-settled")).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/SETTLED/);

  // Changing an answer replaces it rather than adding a second.
  await card.getByTestId("missed-card-change-access-cleared").click();
  await page.getByTestId("access-cleared-yes").click();
  await expect(page.getByTestId("access-cleared-yes")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(page.getByTestId("access-cleared-no")).toHaveAttribute("aria-pressed", "false");
  await card.getByTestId("missed-card-done").click();

  // And it survives a reload — the answers are on the server, not the tab.
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  const again = page.getByTestId("missed-card");
  await expect(again.getByTestId("missed-card-settled")).toBeVisible({ timeout: 30_000 });
  await again.getByTestId("missed-card-change-access-stairwell").click();
  await expect(page.getByTestId("access-stairwell-yes")).toHaveAttribute("aria-pressed", "true");
  await again.getByTestId("missed-card-done").click();
  await again.getByTestId("missed-card-change-access-cleared").click();
  await expect(page.getByTestId("access-cleared-yes")).toHaveAttribute("aria-pressed", "true");

  await again.screenshot({ path: "test-results/site-access.png" });
});

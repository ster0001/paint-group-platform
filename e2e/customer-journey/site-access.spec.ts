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

  const card = page.getByTestId("access-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/None of these are a problem/i);

  // The plan's questions, all present.
  for (const q of ["cleared", "stairwell", "parking", "pets"]) {
    await expect(page.getByTestId(`access-${q}`)).toBeVisible();
  }
  // A house is never asked about a lift booking (units and apartments only).
  await expect(page.getByTestId("access-lift")).toHaveCount(0);
  // Floors is gone: Tom prices it inside the empty/furnished allowance, and a
  // question that changes nothing wastes the customer's patience.
  await expect(page.getByTestId("access-floors")).toHaveCount(0);

  // Height and asbestos are NOT re-asked here — they belong to the details
  // card and the policy ladder, and asking twice invites two answers.
  await expect(card).not.toContainText(/ceiling height/i);
  await expect(card).not.toContainText(/asbestos/i);

  // Nothing is answered to begin with.
  await expect(card).toContainText("0 OF 4");

  await page.getByTestId("access-cleared-no").click();
  await expect(page.getByTestId("access-cleared-no")).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("1 OF 4", { timeout: 30_000 });

  await page.getByTestId("access-stairwell-yes").click();
  await page.getByTestId("access-parking-drive").click();
  await page.getByTestId("access-pets-yes").click();
  await expect(card).toContainText("ANSWERED ✓", { timeout: 30_000 });

  // Changing an answer replaces it rather than adding a second.
  await page.getByTestId("access-cleared-yes").click();
  await expect(page.getByTestId("access-cleared-yes")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(page.getByTestId("access-cleared-no")).toHaveAttribute("aria-pressed", "false");

  // And it survives a reload — the answers are on the server, not the tab.
  // The chip lights optimistically, so the tap being pressed does NOT mean the
  // save has landed. Wait for the editor's own "SAVING…" flag to clear, or the
  // reload races the last write and the test flakes on a real bug it hasn't found.
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("access-stairwell-yes")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("access-cleared-yes")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("access-card").screenshot({ path: "test-results/site-access.png" });
});

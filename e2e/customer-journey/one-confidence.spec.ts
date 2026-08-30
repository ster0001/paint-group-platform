import { test, expect, type Page } from "@playwright/test";
import { driveNoPlanWizard } from "./drive";

/**
 * R1.4 — ONE confidence function (diagnostic #5, the 90%-vs-41% split).
 *
 * The bug this encodes: the header ring and the room cards once came from
 * DIFFERENT functions — cards said 90% while the ring said 41%. The unifying
 * function is pinned in lib/wizard's accuracy tests; what a CUSTOMER can see
 * has since changed shape (28 Aug: reveals land in the scope editor, which
 * shows one header score and per-room confirm STATES, not per-card
 * percentages). So this spec pins the two promises the current surface makes:
 *
 *   · a no-plan, nothing-confirmed estimate is CAPPED — honest-low (~65%)
 *     always beats fake-high;
 *   · confirming a room moves the one score UP, because the ramp is the
 *     reason a customer bothers confirming at all (the R5 frozen-18% bug).
 */

async function headerPct(page: Page): Promise<number> {
  return parseInt((await page.locator(".sc-num").innerText()).replace("%", ""), 10);
}

test("R1.4 one score: no-plan capped, and confirming a room ramps it", async ({ page }) => {
  test.setTimeout(180_000);
  await driveNoPlanWizard(page);

  // Honesty cap: a starter-list estimate (nothing extracted, nothing
  // confirmed) can never open above 65%.
  const header0 = await headerPct(page);
  expect(header0, "an unconfirmed no-plan estimate must open capped").toBeLessThanOrEqual(65);

  // Confirm the first room: the size question first — its button reads
  // "Looks right" — then the room's confirm button.
  await page.locator(".sc-rc").first().click();
  await page.getByRole("button", { name: "Looks right" }).first().click();
  const confirm = page.getByRole("button", { name: /^Confirm / }).first();
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();
  await expect(page.getByRole("button", { name: /Confirmed ✓/ }).first()).toBeVisible({ timeout: 20_000 });

  // The ramp: the score a customer worked for must move.
  await expect(async () => {
    expect(await headerPct(page)).toBeGreaterThan(header0);
  }).toPass({ timeout: 20_000 });
});

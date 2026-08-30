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

  // Confirm the first room. The loop asks its REQUIRED questions in order:
  // the size ("Looks right"), then whatever this room type carries — a
  // cupboard/robe question on bedrooms, a doors/windows check — each with a
  // "No" that is a real answer. Confirm refuses until all are answered, so
  // the spec answers what the card actually asks rather than assuming.
  const card = page.locator(".sc-rc").first();
  await card.click();
  await card.getByRole("button", { name: "Looks right" }).click();
  const no = card.getByRole("button", { name: /^No\b/ });
  for (let i = 0; i < (await no.count()); i++) await no.nth(i).click();
  const confirm = card.getByRole("button", { name: /^Confirm / });
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();

  // Outcome, not chrome: a confirmed card collapses, taking its button with
  // it — waiting for a "Confirmed ✓" label races the collapse. What must be
  // true afterwards is the card wearing its done state and the score moving.
  await expect(page.locator(".sc-rc.done").first()).toBeVisible({ timeout: 25_000 });
  await expect(async () => {
    expect(await headerPct(page)).toBeGreaterThan(header0);
  }).toPass({ timeout: 25_000 });
});

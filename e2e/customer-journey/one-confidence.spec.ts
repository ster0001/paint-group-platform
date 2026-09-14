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

/** 14 Sep: the customer's one number is the range width ("±N%"), not the accuracy score. */
async function headerPct(page: Page): Promise<number> {
  return parseInt((await page.getByTestId("range-width").innerText()).replace(/[±%]/g, ""), 10);
}
const widthOf = (t: string) => { const m = t.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/); return m ? Number(m[2]) - Number(m[1]) : NaN; };

test("R1.4 one score: no-plan capped, and confirming a room ramps it", async ({ page }) => {
  test.setTimeout(180_000);
  await driveNoPlanWizard(page);

  // Honesty: a starter-list estimate (nothing extracted, nothing confirmed)
  // opens WIDE — above the tight band — never as if it were nearly certain.
  const header0 = await headerPct(page);
  expect(header0, "an unconfirmed no-plan estimate must open wide").toBeGreaterThan(4);
  const dollars0 = widthOf((await page.locator(".sc-r").first().textContent()) ?? "");

  // Confirm the first room. The loop asks its REQUIRED questions in order:
  // the size ("Looks right"), then whatever this room type carries — a
  // cupboard/robe question on bedrooms, a doors/windows check — each with a
  // "No" that is a real answer. Confirm refuses until all are answered, so
  // the spec answers what the card actually asks rather than assuming.
  const card = page.locator(".sc-rc[data-room]").first(); // the details card is the first .sc-rc since 7 Sep
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
  // The one number never grows on a confirm, and the range itself narrows.
  await expect(async () => {
    expect(await headerPct(page)).toBeLessThanOrEqual(header0);
    expect(widthOf((await page.locator(".sc-r").first().textContent()) ?? "")).toBeLessThan(dollars0);
  }).toPass({ timeout: 25_000 });
});

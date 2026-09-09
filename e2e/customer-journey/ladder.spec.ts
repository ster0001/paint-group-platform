import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * R4 — the sign-off ladder (v2 ruling): interior self-serve <= $6k at >= 90%,
 * straightforward exterior <= $12k at >= 85%, everything else "Confirm my
 * price — book the visit" — an OFFER with the calendar right there, never a
 * blocked state. A no-plan estimate is honesty-capped at 65%, so this
 * journey always lands on the visit tier: complete the loop, book the visit.
 */

test("R4 ladder: below the accuracy bar lands the visit tier — slots offered, booking sticks", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  // Complete the whole confirm loop quickly.
  const cards = page.locator(".sc-rc[data-room]");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /Looks right/ }).click();
    // Every cupboard question the room carries, one at a time (doors first, 7 Sep).
    for (let i = 0; i < 4 && (await card.locator(".il-cup:not(.ok)").count()); i++) {
      await card.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click();
      await page.waitForTimeout(300);
    }
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 15_000 });
  }
  const dw = page.locator(".il-card", { hasText: /doors & windows/i });
  await dw.getByRole("button", { name: /That.s right/ }).click();
  await dw.getByRole("button", { name: /Confirm counts/ }).click();
  const sweep = page.locator('[data-card="sweep"]');
  await sweep.getByRole("button", { name: /No — that.s everything/ }).click();
  await sweep.getByRole("button", { name: /Confirm — nothing missing/ }).click();

  // The loop is complete; the honesty cap keeps a no-plan estimate below the
  // 90% bar, so the CTA is the visit offer, enabled — never blocked.
  const cta = page.locator(".il-cta");
  await expect(cta).toBeEnabled({ timeout: 45_000 }); // production queue drain
  await expect(cta).toContainText(/finalise my price/i);

  // Tom, 5 Sep: call us / call back / site visit with availability — a
  // person schedules it. Requesting sticks.
  //
  // Since v2 screen 10 the completed loop's CTA opens the FINISH LINE, which
  // is where the plan puts this decision: the range, the answers read back,
  // and the two options the ladder chose. The contact card lives on that
  // screen rather than bouncing back here.
  await cta.click();
  await expect(page.getByTestId("finish")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("finish-book_visit").click();
  await expect(page.getByTestId("contact-card")).toBeVisible();
  await page.getByTestId("contact-visit").click();
  await page.getByTestId("contact-phone").fill("0400 000 000");
  await page.getByTestId("contact-when").fill("weekday mornings, not Wednesdays");
  await page.getByTestId("contact-send").click();
  await expect(page.getByTestId("finish-requested")).toContainText(/visit time that suits/i, { timeout: 15_000 });
});

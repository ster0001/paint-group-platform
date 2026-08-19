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
    const cup = card.locator(".il-cup");
    if (await cup.count()) await cup.getByRole("button", { name: "No", exact: true }).click();
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 15_000 });
  }
  const dw = page.locator(".il-card", { hasText: /doors & windows/i });
  await dw.getByRole("button", { name: /That.s right/ }).click();
  await dw.getByRole("button", { name: /Confirm counts/ }).click();
  const sweep = page.locator(".il-card", { hasText: /anything we haven.t listed/i });
  await sweep.getByRole("button", { name: /No — that.s everything/ }).click();
  await sweep.getByRole("button", { name: /Confirm — nothing missing/ }).click();

  // The loop is complete; the honesty cap keeps a no-plan estimate below the
  // 90% bar, so the CTA is the visit offer, enabled — never blocked.
  const cta = page.locator(".il-cta");
  await expect(cta).toBeEnabled({ timeout: 45_000 }); // production queue drain
  await expect(cta).toContainText(/book the visit/i);

  // Slots are the server's own offer; booking sticks.
  await cta.click();
  const slots = page.locator(".sc-slots button");
  expect(await slots.count()).toBeGreaterThan(0);
  await slots.first().click();
  await expect(page.locator(".sc-tier")).toContainText(/Visit booked/i, { timeout: 15_000 });
});

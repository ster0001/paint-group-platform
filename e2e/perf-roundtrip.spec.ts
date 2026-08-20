import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./customer-journey/drive";

/**
 * Round-trip probe: measures real wizard-edit response times on whatever
 * E2E_BASE_URL points at (run it against production for the honest number).
 * The optimistic-tap + SAVING… work exists BECAUSE these round-trips are
 * 1–3s on production; this records the actual figure alongside the UX
 * guards so a regression in either direction is visible.
 *
 *   E2E_BASE_URL=https://<prod> npx playwright test e2e/perf-roundtrip.spec.ts
 */

test("measure wizard-edit round-trips (5 taps)", async ({ page }) => {
  test.setTimeout(300_000);
  const timings: number[] = [];
  page.on("requestfinished", async (req) => {
    if (!req.url().includes("wizard-edit")) return;
    const t = req.timing();
    if (t.responseEnd > 0) timings.push(Math.round(t.responseEnd - t.requestStart));
  });

  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const first = page.locator(".sc-rc[data-room]").first();
  await first.getByRole("button", { name: /Looks right/ }).click();
  const tiles = first.locator(".sc-tl.on");
  await tiles.nth(0).click(); // toggle off
  await expect(tiles).not.toHaveCount(await tiles.count(), { timeout: 20_000 }).catch(() => undefined);
  await first.getByRole("button", { name: /\+ Add a surface/ }).click();
  const chip = first.locator(".sd-addpanel .sd-chip").first();
  if (await chip.count()) await chip.click();
  await page.waitForTimeout(4000); // let the queue drain fully

  expect(timings.length).toBeGreaterThanOrEqual(3);
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`WIZARD-EDIT ROUND-TRIPS ms: n=${timings.length} median=${median} min=${sorted[0]} max=${sorted[sorted.length - 1]} all=[${timings.join(", ")}]`);
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

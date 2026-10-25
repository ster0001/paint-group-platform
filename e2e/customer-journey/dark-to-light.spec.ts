import { test, expect } from "@playwright/test";
import { driveNoPlanWizard } from "./drive";

/**
 * ⚑ REPLACES paint-systems-card.spec.ts, which tested a screen that is gone —
 * and, since 25 Oct 2026, the dark-to-light card that replaced it is gone too.
 *
 * Tom, 10 Sep: *"'How we'll paint each surface' needs to go."* Tom, 25 Oct
 * (item 4): *"the customer has already answered in the wizard which areas are
 * going from dark to light, it doesn't need to be answered again"* — so the
 * tighten screen asks NOTHING about coats: no job-wide card, no ceilings row, no
 * per-room ceiling tick. The quick look's "Which ones?" is the one answer, and it
 * prices the third coat (tom-batch-15sep-evening.spec.ts proves the walls land
 * in `condition.darkToLightSurfaces` and "3 coats + undercoat" on the reveal).
 *
 * The DERIVATION is untouched — lib/pricing/systems.ts still works the coats out
 * per surface group, and its unit tests still cover that.
 */

test("a bold job is asked nothing about coats on the tighten screen — the quick look already asked", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "bold" });

  // The cards that went.
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
  await expect(page.getByText(/How we.ll paint each surface/i)).toHaveCount(0);
  await expect(page.getByTestId("darklight-card")).toHaveCount(0);
  await expect(page.getByTestId("darklight-ceilings-row")).toHaveCount(0);
  await expect(page.getByText(/Which surfaces are going from dark to light/i)).toHaveCount(0);

  // The per-room ceiling tick is gone too — checked with a room card OPEN, so an
  // absent tick is the answer rather than a collapsed card.
  await page.locator(".sc-rc[data-room]").first().locator(".sc-hd .il-pill").click();
  await expect(page.locator('[data-testid^="room-ceiling-d2l-"]')).toHaveCount(0);
  await expect(page.getByText(/Is this ceiling going from dark to light/i)).toHaveCount(0);
});

test("a same-colour job is never asked which surfaces are going dark to light", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "same" });
  await expect(page.getByTestId("darklight-card")).toHaveCount(0);
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
});

test("the per-room prep question is worded by the job's colour intent, and its panel asks for photos in one line", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "same" });
  const areaId = await page.locator("[data-room]").first().getAttribute("data-room");
  await page.locator(`[data-room="${areaId}"] .il-hd .il-pill`).click();
  // A colour match asks about COVERAGE — what will not cover in one.
  await expect(page.getByTestId(`spot-open-${areaId}`)).toContainText(/extra work/i);
  await page.getByTestId(`spot-open-${areaId}`).click();
  // Tom, 25 Oct 2026 (item 8): the paragraph on coats and the "photo and a tap" line are gone.
  await expect(page.getByTestId(`spot-intro-${areaId}`)).toHaveText(/Attach photos of areas that need attention/i);
  await expect(page.getByTestId(`spot-panel-${areaId}`)).not.toContainText(/photo and a tap|two coats over sound|won.t cover in one/i);
});

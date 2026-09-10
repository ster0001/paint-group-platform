import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, MONEY_RANGE } from "./drive";

/**
 * ⚑ REPLACES paint-systems-card.spec.ts, which tested a screen that is gone.
 *
 * Tom, 10 Sep: *"'How we'll paint each surface' needs to go — it doesn't provide
 * a great deal of value, the client has already confirmed if they want a colour
 * change, colour match or dark to light."* What survived is the one job-wide
 * question that genuinely changes coats, and the per-room prep question that
 * the exceptions actually live in.
 *
 * The DERIVATION is untouched — lib/pricing/systems.ts still works the coats out
 * per surface group, and its unit tests still cover that. This spec is about
 * what the customer is asked.
 */

test("a bold job picks its dark-to-light surfaces, and nothing else asks about coats", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "bold" });

  // The card that went.
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
  await expect(page.getByText(/How we.ll paint each surface/i)).toHaveCount(0);

  // The one that replaced it — and only because this job is going bold.
  const card = page.getByTestId("darklight-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/dark to light/i);

  await page.getByTestId("darklight-ceilings").click();
  await expect(page.getByTestId("darklight-ceilings")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE);

  /**
   * ⚑ NOT asserting that the range MOVES, and the reason is a conflict worth
   * seeing rather than papering over. Tom's 9 Sep coat table already gives a
   * bold job the heavier system on most groups — walls 3 (undercoat + 2), trims
   * 3, doors 3 — so ticking "walls are going dark to light" changes nothing,
   * because walls were already three coats. His 10 Sep instruction reads the
   * other way: ticked = 3, "everything else 2".
   *
   * Both cannot be true. Until Tom rules, the card records the answer honestly
   * and the table prices it — which is the safe direction, because it can only
   * ever quote the heavier system rather than the lighter one.
   */
});

test("a same-colour job is never asked which surfaces are going dark to light", async ({ page }) => {
  test.setTimeout(240_000);
  // There is nothing to pick on a colour match, and offering the choice would
  // invent a question the customer has already answered.
  await driveNoPlanWizard(page, { colour: "same" });
  await expect(page.getByTestId("darklight-card")).toHaveCount(0);
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
});

test("the per-room prep question is worded by the job's colour intent", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "same" });
  const areaId = await page.locator("[data-room]").first().getAttribute("data-room");
  await page.locator(`[data-room="${areaId}"] .il-hd`).click();
  // A colour match asks about COVERAGE — what will not cover in one.
  await expect(page.getByTestId(`spot-open-${areaId}`)).toContainText(/extra work/i);
  await page.getByTestId(`spot-open-${areaId}`).click();
  await expect(page.getByTestId(`spot-panel-${areaId}`)).toContainText(/won.t cover in one/i);
});

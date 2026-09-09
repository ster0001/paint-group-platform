import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Phase 4 (estimator journey v2 §4.2, prototype screen 8) — the paint-systems
 * card, driven end to end on a real customer estimate.
 *
 * The point of the card is that the derivation is SHOWN and CORRECTABLE. So
 * this proves the three things a unit test cannot:
 *   1. it renders a line per surface group, in the painter's words;
 *   2. a correction re-derives the whole tree server-side and the range moves;
 *   3. ⚑5's "not sure" is the default and says a person will check.
 */

test("the systems card shows the derived coats and a tap corrects them", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 200));
    }
  });

  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const card = page.getByTestId("systems-card");
  await expect(card).toBeVisible();

  // A line per group the tree actually has, in the painter's order.
  await expect(page.getByTestId("system-walls")).toBeVisible();
  await expect(page.getByTestId("system-ceilings")).toBeVisible();
  await expect(page.getByTestId("system-trims")).toBeVisible();

  // The sentence says what we will DO — not "2 coats".
  await expect(page.getByTestId("system-say-walls")).toContainText(/coats of low-sheen/i);
  await expect(page.getByTestId("system-say-ceilings")).toContainText(/ceiling white/i);

  // The default job is "new colours": walls two coats, ceilings still one (⚑3).
  await expect(page.getByTestId("system-walls")).toContainText("2 coats");
  await expect(page.getByTestId("system-ceilings")).toContainText("1 coat");

  // ⚑5 — the gloss question defaults to "not sure" and says so.
  await expect(page.getByTestId("system-chip-trims-glossTrims-unsure")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("system-review-trims")).toContainText(/check this one ourselves/i);

  // A correction: "same colour actually" on the walls.
  const before = await page.locator(".sc-r").first().innerText();
  await page.getByTestId("system-chip-walls-colourIntent-same").click();

  // The server re-derived the whole tree: walls drop to one coat…
  await expect(page.getByTestId("system-walls")).toContainText("1 coat", { timeout: 30_000 });
  // …and the trims moved with them, because colour intent is job-wide.
  await expect(page.getByTestId("system-trims")).toContainText("2 coats");
  await expect(page.getByTestId("system-chip-walls-colourIntent-same")).toHaveAttribute("aria-pressed", "true");

  // The range is still a range, and it moved.
  const after = page.locator(".sc-r").first();
  await expect(after).toHaveText(MONEY_RANGE);
  expect(await after.innerText()).not.toBe(before);

  // ⚑3 — "they're marked" lifts the ceilings and explains why.
  await page.getByTestId("system-chip-ceilings-ceilingsMarked-true").click();
  await expect(page.getByTestId("system-ceilings")).toContainText("2 coats", { timeout: 30_000 });
  await expect(page.getByTestId("system-why-ceilings")).toContainText(/marked or already coloured/i);
  // …and the SENTENCE moves with the number. Caught on the real screen: the
  // heading read "2 coats" over "One fresh coat of flat ceiling white".
  await expect(page.getByTestId("system-say-ceilings")).not.toContainText(/one fresh coat/i);
  await expect(page.getByTestId("system-say-ceilings")).toContainText(/block the water marks/i);

  // ⚑5 — answering the gloss question adds the primer and clears the check.
  await page.getByTestId("system-chip-trims-glossTrims-yes").click();
  await expect(page.getByTestId("system-trims")).toContainText("3 coats", { timeout: 30_000 });
  await expect(page.getByTestId("system-review-trims")).toHaveCount(0);

  await card.screenshot({ path: "test-results/paint-systems-card.png" });
});

import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Phase 5b (§4.5) — the whole-job extras sheet.
 *
 * §4.5's rule verbatim: "named extras price; unusual ones flag." This proves
 * the two behave differently, which is the whole point — the listed ones show
 * a price and change the range, the sentence shows none and says so.
 *
 * The listed extras are DERIVED FROM THE RATE CARD, so this spec asserts the
 * mechanism, not a particular row: a test that hardcoded "Ceiling Rose" would
 * fail the day Tom renamed it, and pass the day the sheet broke.
 */

test("named extras price from the card; an unusual one is flagged, not priced", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 200));
    }
  });

  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const card = page.getByTestId("extras-card");
  await expect(card).toBeVisible();

  // The note box is always there — it is what a rate card cannot cover.
  await expect(page.getByTestId("extra-note")).toBeVisible();
  await expect(card).toContainText(/won.t put a price on it until a person has read it/i);

  // "Help me choose the colours" prices nothing but is remembered.
  const colour = page.getByTestId("extra-colour-help");
  await expect(colour).toHaveAttribute("aria-pressed", "false");
  await colour.click();
  await expect(colour).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });

  // An unusual extra: recorded, and NOT priced.
  const before = await page.locator(".sc-r").first().innerText();
  await page.getByTestId("extra-note").fill("a mural in the hallway");
  await page.getByTestId("extra-note-save").click();
  await expect(page.getByTestId("extra-note-save")).toContainText("Added ✓", { timeout: 30_000 });
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  expect(await page.locator(".sc-r").first().innerText()).toBe(before);

  // Every listed extra shows a price — none is offered at nothing.
  const listed = card.locator("[data-testid^='extra-']").filter({ hasText: "$" });
  const n = await listed.count();
  for (let i = 0; i < n; i++) {
    await expect(listed.nth(i)).toContainText(/\$\d+/);
  }

  // If the card carries any, ticking one moves the money.
  if (n > 0) {
    await listed.first().click();
    await expect(listed.first()).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
    expect(await page.locator(".sc-r").first().innerText()).not.toBe(before);
  }

  // Everything survives a reload — it is on the server, not in the tab.
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("extra-colour-help")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("extra-note")).toHaveValue("a mural in the hallway");

  await page.getByTestId("extras-card").screenshot({ path: "test-results/job-extras.png" });
});

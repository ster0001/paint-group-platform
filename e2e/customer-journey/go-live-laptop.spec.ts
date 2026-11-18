import { expect } from "@playwright/test";
import { test } from "../helpers";
import { driveNoPlanWizard } from "./drive";

/**
 * Go-live brief Session 3 (C2), as an anonymous customer on a LAPTOP (1470 × 900):
 *   · the range screen names no tolerance — no "±", no "within N%", no "exact";
 *   · the first door lands on the quote stage, and nothing a customer can press on the range screen
 *     or the stage links to the old /estimate/scope editor;
 *   · the stage's rendered text is as clean as the range screen's.
 */
const BANNED = /±|within \d+%|\bexact\b/i;

test.describe("Go-live S3 — the laptop catches up (C2)", () => {
  test.use({ viewport: { width: 1470, height: 900 } });

  test("no tolerance words at 1470 px; the door is the quote stage; no press opens /estimate/scope", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page, { stopAtReveal: true, contactName: "Laptop Tester", email: `golive.laptop.${Date.now()}@example.com` });
    const reveal = page.getByTestId("reveal");
    await expect(reveal).toBeVisible();
    expect(await reveal.innerText()).not.toMatch(BANNED);
    await expect(page.getByTestId("reveal-tier")).toHaveCount(0);
    await expect(page.getByTestId("reveal-tiers")).toHaveCount(0);
    await expect(page.getByTestId("reveal-fine")).toContainText("Price is subject to change");
    await expect(page.getByTestId("reveal-tiles").locator("li")).toHaveCount(3);
    const scopeLinks = await page.locator("a[href*='/estimate/scope']").count();
    expect(scopeLinks, "no customer link to the old editor").toBe(0);
    await page.getByTestId("door-tighten").click();
    // range-first asks for the details on the way (drive handles both orders)
    const sheet = page.getByTestId("talk-sheet");
    const stage = page.getByTestId("quote-stage");
    await expect(sheet.or(stage)).toBeVisible({ timeout: 60_000 });
    if (await sheet.count()) {
      await page.getByTestId("talk-name").fill("Laptop Tester");
      await page.getByTestId("talk-email").fill(`golive.laptop.${Date.now()}@example.com`);
      await page.getByTestId("talk-mobile").fill(`04${String(Date.now()).slice(-8)}`);
      await page.getByTestId("talk-go").click();
    }
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(stage).toBeVisible({ timeout: 30_000 });
    expect(await stage.innerText()).not.toMatch(BANNED);
    expect(await page.locator("a[href*='/estimate/scope']").count(), "no link to the old editor from the stage").toBe(0);
  });
});

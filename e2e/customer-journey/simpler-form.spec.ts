import { test, expect, devices } from "@playwright/test";
import { driveNoPlanWizard, MONEY_RANGE } from "./drive";

/**
 * The QUICK LOOK — estimator journey v2 §3, phase 2.
 *
 * This file used to describe the five-page form the plan replaced ("three
 * ways in, five honest steps, paint with the contact details"). §1's target
 * is now the thing under test instead: **under a minute, under ten taps, and
 * the price before the contact form.**
 *
 *  1. Four screens, and the last button says "See my guide range" — then a
 *     range appears with the customer's own answers read back under it, with
 *     no name, email or phone asked for anywhere along the way (⚑1).
 *  2. The answers really do drive the room tree: a 5-bedroom home prices
 *     above a 2-bedroom one, from the same four screens.
 *  3. The door style, which the quick look deliberately never asks, is still
 *     answerable in the editor and still clears the amber lines.
 */

test.describe("the quick look", () => {
  test("four screens to a guide range, and not one contact field on the way", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });

    // Screen 1 — no route choice in the way of the first question (§2.1);
    // the other two ways in are offers, not a gate.
    await expect(page.locator("[data-quick-step='start']")).toBeVisible();
    await expect(page.getByTestId("ql-jobtype-interior")).toBeVisible();
    const ways = page.getByTestId("wz-entry");
    await expect(ways.getByTestId("entry-describe")).toBeVisible();
    await expect(ways.getByTestId("entry-upload")).toBeVisible();

    // An address is the one thing screen 1 insists on — without a postcode
    // the service-area check would hand the job off for our own reasons.
    await page.getByTestId("ql-next").click();
    await expect(page.getByTestId("ql-error")).toContainText(/address/i);
    await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("ql-next").click();

    await expect(page.locator("[data-quick-step='place']")).toBeVisible();
    await page.getByTestId("ql-bedrooms-4").click();
    await page.getByTestId("ql-next").click();

    await expect(page.locator("[data-quick-step='job']")).toBeVisible();
    await page.getByTestId("ql-colour-same").click();
    await page.getByTestId("ql-next").click();

    await expect(page.locator("[data-quick-step='condition']")).toBeVisible();
    await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range/);

    // ⚑1: nothing has asked who they are. That is the whole point.
    await expect(page.locator(".wz-crow input")).toHaveCount(0);
    await expect(page.getByText(/Who should we send your estimate to/)).toHaveCount(0);

    await page.getByTestId("ql-next").click();

    // The reveal: a RANGE, their own answers read back, and three doors.
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("reveal-restatement")).toContainText("4-bedroom");
    await expect(page.getByTestId("reveal-restatement")).toContainText("the same colours");
    for (const door of ["door-tighten", "door-book", "door-keep"]) {
      await expect(page.getByTestId(door)).toBeVisible();
    }
    // Every assumption we made for them is listed, not hidden.
    await page.getByTestId("reveal-assumed-toggle").click();
    await expect(page.getByTestId("reveal-assumed-hazards")).toBeVisible();
    await expect(page.getByTestId("reveal-assumed-rooms")).toBeVisible();
    await ctx.close();
  });

  test("the answers scale the starter rooms", async ({ browser }) => {
    test.setTimeout(240_000);
    const totals: Record<string, number> = {};
    for (const bedrooms of [2, 5] as const) {
      const ctx = await browser.newContext({ ...devices["iPhone 13"] });
      const page = await ctx.newPage();
      await driveNoPlanWizard(page, { bedrooms, stopAtReveal: true });
      const text = await page.getByTestId("reveal-range").innerText();
      totals[bedrooms] = Number(text.split("–")[0].replace(/[^0-9]/g, ""));
      await expect(page.getByTestId("reveal-restatement")).toContainText(`${bedrooms}-bedroom`);
      await ctx.close();
    }
    expect(totals[5]).toBeGreaterThan(totals[2]);
  });

  test("the door style is answerable in the editor and clears the amber lines", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page); // door style left "Not sure" on purpose
    const flags = page.locator(".wz-confirmonsite");
    await expect(flags).toContainText(/door style to confirm/);
    const before = await page.locator(".sc-r").first().innerText();
    const details = page.getByTestId("details-card");
    await expect(details).toBeVisible();
    await details.getByRole("button", { name: "Panel", exact: true }).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/door style to confirm/)).toHaveCount(0); // the whole amber list may go
    await expect(page.locator(".sc-r").first()).not.toHaveText(before, { timeout: 20_000 });
    await expect(page.getByTestId("last-change")).toContainText(/Panel doors/);
  });
});

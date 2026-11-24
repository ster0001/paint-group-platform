import { test, expect, devices } from "@playwright/test";
import { driveNoPlanWizard, MONEY_RANGE, passGateIfShown } from "./drive";

/**
 * The QUICK LOOK — estimator journey v2 §3, phase 2.
 *
 * This file used to describe the five-page form the plan replaced ("three
 * ways in, five honest steps, paint with the contact details"). §1's target
 * is now the thing under test instead: **under a minute, under ten taps, and
 * the price before the contact form.**
 *
 *  1. Four screens with no name, email or phone asked for on the way (⚑1).
 *     Since S6 (7 Oct 2026, "details first", the default) the last button
 *     leads to ONE contact question — name, email, mobile — and the range
 *     follows it; under "range first" the button says "See my guide range"
 *     and the range comes straight away. Either way the customer's own
 *     answers are read back under the range.
 *  2. The answers really do drive the room tree: a 5-bedroom home prices
 *     above a 2-bedroom one, from the same four screens.
 *  3. The door style, which the quick look deliberately never asks, is still
 *     answerable in the editor and still clears the amber lines.
 */

test.describe("the quick look", () => {
  test("four screens with not one contact field on the way, then the details question, then a guide range", async ({ browser }) => {
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
    // Tom, 15 Sep: "describe it" left screen 1 (the chat bubble is the describe door).
    await expect(ways.getByTestId("entry-describe")).toHaveCount(0);
    // 14 Sep: the floorplan upload lives ON the place screen for an inside
    // job; the screen-1 upload link is only offered for an outside job.
    await expect(ways.getByTestId("entry-upload")).toHaveCount(0);

    // Wizard mobile v5 / desktop one-press (19 Nov 2026): an iPhone is the phone's one-question shell — a single
    // choice advances itself, so the walk is taps, not Continues. An address is the one thing screen 1 insists on:
    // without a postcode the job stays on screen 1 (the service-area check would hand it off for our own reasons).
    await page.getByTestId("ql-jobtype-interior").click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-quick-step='start']")).toBeVisible();
    await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("ql-jobtype-interior").click();

    await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-kind-house").click();
    await page.getByTestId("ql-bedrooms-4").click();
    await page.getByTestId("ql-storeys-single").click();

    await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-scope-whole").click();
    await page.getByTestId("ql-next").click(); // the surfaces screen, as it is
    // 14 Sep (evening): confirm the rooms before the gate — the starter list, as it is.
    await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("ql-next").click();

    await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 20_000 });
    // C9: "the same colours" is one tap on the shell (the grouped laptop unticked four tiles).
    await page.getByTestId("ql-colours-same").click();
    await page.getByTestId("ql-condition-wear").click();
    await page.getByTestId("ql-occupied-no").click();

    // ⚑1: nothing on the screens so far has asked who they are.
    await expect(page.locator(".wz-crow input")).toHaveCount(0);
    await expect(page.getByText(/Who should we send your estimate to/)).toHaveCount(0);

    // S6: under "details first" the one contact question comes here, then the range.
    const gateShown = await passGateIfShown(page);

    // The range: on a phone it is the gate screen — a RANGE, the answers read back as the basis, and the doors.
    const reveal = page.getByTestId("reveal").or(page.getByTestId("wzm-gate"));
    await expect(reveal).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("reveal-range").or(page.getByTestId("gate-range"))).toHaveText(MONEY_RANGE);
    const basis = page.getByTestId("reveal-restatement").or(page.getByTestId("gate-basis"));
    await expect(basis).toContainText(/4.bedroom/i);
    await expect(basis).toContainText(/same colours/i);
    await expect(page.getByTestId("gate-exact").or(page.getByTestId("door-tighten")).first()).toBeVisible();
    // the gate's "Or book a time with … first" (gate-visit) on the ask variant; Book a visit on the bigger one
    await expect(page.getByTestId("gate-visit").or(page.getByTestId("gate-book")).or(page.getByTestId("door-book")).first()).toBeVisible();
    // "Keep this estimate" asks for an email — so it is offered only when the
    // details question did not already take one (range first).
    if (gateShown) await expect(page.getByTestId("door-keep")).toHaveCount(0);
    await ctx.close();
  });

  test("the answers scale the starter rooms", async ({ browser }) => {
    test.setTimeout(240_000);
    const totals: Record<string, number> = {};
    for (const bedrooms of [2, 5] as const) {
      const ctx = await browser.newContext({ ...devices["iPhone 13"] });
      const page = await ctx.newPage();
      await driveNoPlanWizard(page, { bedrooms, stopAtReveal: true });
      const text = await page.getByTestId("reveal-range").or(page.getByTestId("gate-range")).first().innerText(); // a phone: the gate
      totals[bedrooms] = Number(text.split("–")[0].replace(/[^0-9]/g, ""));
      await expect(page.getByTestId("reveal-restatement").or(page.getByTestId("gate-basis")).first()).toContainText(`${bedrooms}-bedroom`);
      await ctx.close();
    }
    expect(totals[5]).toBeGreaterThan(totals[2]);
  });

  test("the door style is answerable in the editor and clears the amber lines", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page); // door style left "Not sure" on purpose
    // Tom, 14 Sep (item 26): no amber list — the door question itself is the signal.
    await expect(page.locator(".wz-confirmonsite")).toHaveCount(0);
    const before = await page.locator(".sc-r").first().innerText();
    const details = page.getByTestId("details-card");
    await expect(details).toBeVisible();
    // Tom, 14 Sep (evening): cornices are the first question; the door tile follows.
    await details.getByTestId("details-cornices").getByRole("button", { name: "No", exact: true }).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 20_000 });
    await details.getByRole("button", { name: "Panel", exact: true }).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/door style to confirm/)).toHaveCount(0); // the whole amber list may go
    await expect(page.locator(".sc-r").first()).not.toHaveText(before, { timeout: 20_000 });
    await expect(page.getByTestId("last-change")).toContainText(/Panel doors/);
  });
});

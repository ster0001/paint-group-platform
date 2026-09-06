import { test, expect, devices } from "@playwright/test";
import { driveNoPlanWizard, MONEY_RANGE } from "./drive";

/**
 * Phase 2 of the 6 Sep estimator plan — the simpler form, as an anonymous
 * customer on a phone.
 *
 *  1. Page 1 offers three ways in — Describe it · Answer a few questions ·
 *     Upload the plan or listing — and the kicker counts FIVE steps for an
 *     interior job (paint preferences ride the last page with the contact
 *     details; condition and damage are one page).
 *  2. "Roughly how big" changes the typical room sizes the starter list
 *     prices: a 200+ home's Bed 1 is bigger than a <120 home's.
 *  3. In the editor, the door style left "Not sure" is answerable: a
 *     Details-to-confirm card with Panel / Flat; tapping Panel clears the
 *     amber "door style to confirm" lines and moves the range.
 */
const gate = (page: import("@playwright/test").Page) => page.locator(".wz-err");

async function toBasics(page: import("@playwright/test").Page, sizeBand: string) {
  await page.goto("/estimate");
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByText("Step 1 of 5", { exact: false })).toBeVisible();
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  // The three ways in.
  const ways = page.getByTestId("wz-entry");
  await expect(ways.getByRole("button", { name: /Describe it/ })).toBeVisible();
  await expect(ways.getByRole("button", { name: /Upload the floorplan or listing/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(gate(page)).toContainText(/How would you like/);
  await ways.getByRole("button", { name: /Answer a few questions/ }).click();
  await expect(page.getByText(/thirty seconds of basics/i)).toBeVisible();
  await page.getByRole("button", { name: sizeBand, exact: true }).click();
}

test.describe("the simpler form", () => {
  test("three ways in, five honest steps, condition + damage on one page, paint with the contact details", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await toBasics(page, "120–200");
    const next = () => page.getByRole("button", { name: /Continue|Nearly there/ }).first().click();
    await next();
    await expect(page.getByText("Step 2 of 5", { exact: false })).toBeVisible();
    await next();
    await expect(page.getByText("Step 3 of 5", { exact: false })).toBeVisible();
    await expect(page.getByText("Which describes it best?")).toBeVisible();
    await expect(page.getByText("Any damage we should know about?")).toBeVisible();
    await next();
    await expect(page.getByText("Step 4 of 5", { exact: false })).toBeVisible();
    await expect(page.getByText("Any damage we should know about?")).toHaveCount(0);
    for (const q of [/built before 1970/, /asbestos/, /living there/]) {
      await page.locator(".wz-qhead", { hasText: q }).locator("xpath=following-sibling::div[1]").getByRole("button", { name: /^No(\s|$)/ }).click();
    }
    await next();
    await expect(page.getByText("Step 5 of 5", { exact: false })).toBeVisible();
    await expect(page.getByText("Who should we send your estimate to?")).toBeVisible();
    await expect(page.getByText("Paint preferences", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "See my estimate" })).toBeVisible();
    await ctx.close();
  });

  test("the size band scales the starter rooms", async ({ browser }) => {
    test.setTimeout(240_000);
    const sizes: Record<string, string> = {};
    for (const band of ["<120 m²", "200+"]) {
      const ctx = await browser.newContext({ ...devices["iPhone 13"] });
      const page = await ctx.newPage();
      await toBasics(page, band);
      if (band === "200+") {
        // Phase 3: the extra rooms the list used to assume away.
        await page.getByRole("button", { name: "2", exact: true }).last().click(); // bathrooms
        await page.getByTestId("basics-extras").getByRole("button", { name: "Garage" }).click();
      }
      const next = () => page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
      await next(); await next(); await next();
      for (const q of [/built before 1970/, /asbestos/, /living there/]) {
        await page.locator(".wz-qhead", { hasText: q }).locator("xpath=following-sibling::div[1]").getByRole("button", { name: /^No(\s|$)/ }).click();
      }
      await next();
      const contact = page.locator(".wz-crow input");
      await contact.nth(0).fill("E2E Size Band");
      await contact.nth(1).fill(`e2e-size-${Date.now()}@example.com`);
      await contact.nth(2).fill("0400 000 111");
      await page.getByRole("button", { name: "See my estimate" }).click();
      await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 90_000 });
      sizes[band] = await page.locator('[data-card^="room:"] .sc-hd').first().innerText();
      if (band === "200+") {
        const names = await page.locator('[data-card^="room:"] .sc-hd').allInnerTexts();
        expect(names.join(" | ")).toMatch(/Ensuite/);
        expect(names.join(" | ")).toMatch(/Garage/);
      }
      await ctx.close();
    }
    const dims = (s: string) => { const m = s.match(/([\d.]+) × ([\d.]+) m/); return m ? Number(m[1]) * Number(m[2]) : 0; };
    expect(dims(sizes["200+"])).toBeGreaterThan(dims(sizes["<120 m²"]));
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

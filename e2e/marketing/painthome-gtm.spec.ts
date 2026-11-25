import { test, expect } from "@playwright/test";

/**
 * Google Tag Manager on Paint Home (Tom, 25 Nov 2026: GTM-MRW23TH), as an
 * ANONYMOUS visitor:
 *  1. painthome.localhost: no container before a choice or after "Only
 *     what's needed"; after "Allow analytics" it loads once, and on the next
 *     page (the quote wizard at /estimate, outside the marketing shell) it is there from the
 *     cookie alone
 *  2. the Paint Group host never loads it, even after "Allow analytics"
 * Google is never actually called: the container request is answered here.
 */
const GTM = 'script[src^="https://www.googletagmanager.com/gtm.js"]';

test.describe("Paint Home — Tag Manager after consent", () => {
  let phRoot = "";
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.beforeEach(async ({ page }) => {
    await page.route("https://www.googletagmanager.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  });

  test("1 · loads only after Allow analytics, then on every page", async ({ page }) => {
    await page.goto(`${phRoot}/`);
    await expect(page.getByTestId("consent-sheet")).toBeVisible();
    await expect(page.locator(GTM)).toHaveCount(0);

    await page.getByTestId("consent-decline").click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-audience", "painthome");
    await expect(page.locator(GTM)).toHaveCount(0);

    await page.getByTestId("cookie-settings").click();
    await page.getByTestId("consent-allow").click();
    await expect(page.locator(GTM)).toHaveCount(1);
    await expect(page.locator(GTM)).toHaveAttribute("src", /[?&]id=GTM-MRW23TH(&|$)/);
    expect(await page.evaluate(() => (window as Window & { dataLayer?: { event?: string }[] }).dataLayer?.some((e) => e?.event === "gtm.js"))).toBe(true);

    await page.goto(`${phRoot}/estimate`);
    await expect(page.locator(GTM)).toHaveCount(1);
  });

  test("2 · Paint Group never loads it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-allow").click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-audience", "home");
    await page.waitForTimeout(500);
    await expect(page.locator(GTM)).toHaveCount(0);
  });
});

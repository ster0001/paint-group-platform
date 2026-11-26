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

  test("3 · a success page tells the container which moment it was, once, and never loads the container as a Google tag", async ({ page }) => {
    // the consent, given once on the homepage
    await page.goto(`${phRoot}/`);
    await page.getByTestId("consent-allow").click();
    await expect(page.locator(GTM)).toHaveCount(1);
    type Push = { event?: string; success_moment?: string; success_background?: boolean };
    const pushes = () => page.evaluate(() => ((window as Window & { dataLayer?: unknown[] }).dataLayer ?? [])
      .filter((e): e is Push => typeof e === "object" && e !== null && !Array.isArray(e) && (e as Push).event === "pg_success"));

    // the background count (how most moments are counted: a hidden same-site frame) — `?bg=1` is that frame's own page
    await page.goto(`${phRoot}/thanks/lead?bg=1`);
    await expect.poll(pushes).toEqual([{ event: "pg_success", success_moment: "lead", success_background: true }]);
    await expect(page.locator(GTM)).toHaveCount(1);
    // gtag.js is for G- / AW- / GT- ids: a GTM- id set as the Google tag (as on production) is the container's, not loaded twice
    await expect(page.locator('script[src^="https://www.googletagmanager.com/gtag/js"]')).toHaveCount(0);

    // the page a customer sees (the deposit, a call tap on the website)
    await page.goto(`${phRoot}/thanks/call-tap?back=/`);
    await expect(page.getByTestId("thanks-title")).toBeVisible();
    await expect.poll(pushes).toEqual([{ event: "pg_success", success_moment: "call-tap", success_background: false }]);
  });

  test("4 · without consent a success page pushes nothing to the container", async ({ page }) => {
    await page.goto(`${phRoot}/thanks/lead?bg=1`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => ((window as Window & { dataLayer?: { event?: string }[] }).dataLayer ?? []).some((e) => e?.event === "pg_success"))).toBe(false);
    await expect(page.locator(GTM)).toHaveCount(0);
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

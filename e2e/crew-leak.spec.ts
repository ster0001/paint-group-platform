import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The crew link leaks no money and no customer phone.
 *
 * The unit test on lib/workorder/crew.ts proves the STRIP function is a
 * whitelist; this proves the ROUTE uses it. The regression it guards against is
 * someone wiring /crew/[token] to the raw snapshot — the strip would still pass
 * its tests while the page leaked everything.
 *
 * The crew page is fetched with NO session at all, exactly as a painter
 * tapping a forwarded link gets it, and the assertions run against the whole
 * response — RSC payload included — because data leaks hide there, not in the
 * rendered markup.
 */
const creds = credentials("CONTRACTOR");

test.describe("crew link", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));

  test("carries the scope and none of the money", async ({ page, browser }) => {
    await signIn(page, creds!, /\/portal/);

    // Find a committed job — the share card only renders on one.
    await page.goto("/portal/jobs");
    const openers = page.getByRole("link", { name: /open work order/i });
    const count = await openers.count();
    test.skip(count === 0, "no jobs on this contractor to share");

    let crewUrl: string | null = null;
    for (let i = 0; i < count && !crewUrl; i++) {
      await openers.nth(i).click();
      // Wait for the JOB page before asking about the share card — count()
      // right after click() races the navigation and reads the old page.
      await page.waitForURL(/\/portal\/jobs\/[0-9a-f-]{36}/, { timeout: 20_000 });
      const share = page.getByTestId("crew-share-copy");
      const committed = await share.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
      if (committed) {
        // Clipboard permission varies by browser profile; the URL is printed
        // on the page as well, which is the path a test can rely on.
        await share.click();
        crewUrl = (await page.getByTestId("crew-share-url").textContent({ timeout: 15_000 }))?.trim() ?? null;
      }
      if (!crewUrl) await page.goto("/portal/jobs");   // not goBack — be explicit about where the list lives
    }
    test.skip(!crewUrl, "no committed job to mint a crew link on");

    // A fresh context: no cookies, no session — the painter's browser.
    const anon = await browser.newContext();
    try {
      const anonPage = await anon.newPage();
      const response = await anonPage.goto(crewUrl!);
      expect(response?.status()).toBe(200);
      const html = (await response?.text()) ?? "";

      // The scope is there…
      await expect(anonPage.locator("h1")).toBeVisible();
      expect(html).toContain("job sheet is for the assigned crew");

      // …and the money is not. The codebase's own money vocabulary, plus the
      // two renderings a payment could take. contractorPaymentCents may appear
      // with value 0 — the whitelist zeroes it — so match a leading non-zero
      // digit, not the name.
      for (const pattern of [
        /marginCents|margin_cents/i,
        /subtotalCents|subtotal_cents/i,
        /price_cents|priceCents/i,
        /contractor_delta|contractorDelta/i,
        /priced_lines|pricedLines/i,
        // In the RSC payload the quotes arrive ESCAPED — `\"contractorPaymentCents\":446120`
        // — so a pattern anchored on a bare quote sails straight past a real
        // leak. Match the name and the first non-zero digit, tolerating
        // whatever punctuation sits between.
        /contractorPaymentCents[^0-9]{0,6}[1-9]/,
        /Contractor payment/i,
      ]) {
        expect(html, `crew page leaked ${pattern}`).not.toMatch(pattern);
      }

      // No phone number in the customer fact. The crew's questions go through
      // the contractor; the strip empties contactPhone.
      expect(html).not.toMatch(/contactPhone[^0-9+]{0,8}[0-9+]/);
    } finally {
      await anon.close();
    }
  });

  test("a rotated-away or invented token is a 404, not an error page", async ({ browser }) => {
    const anon = await browser.newContext();
    try {
      const anonPage = await anon.newPage();
      const response = await anonPage.goto("/crew/not-a-real-token-at-all");
      expect(response?.status()).toBe(404);
    } finally {
      await anon.close();
    }
  });
});

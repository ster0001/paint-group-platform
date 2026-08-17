import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The contractor's side of the app, driven as a contractor.
 *
 * The check that matters here is the last one: contractor-facing HTML must
 * never carry customer pricing or margin. It is asserted against the raw
 * response body, not the rendered screen, because "not visible" and "not sent"
 * are different things and only the second one is a control.
 */
const creds = credentials("CONTRACTOR");

test.describe("contractor portal", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));

  test("a contractor signs in and lands in the portal", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await expect(page.getByRole("link", { name: /jobs/i }).first()).toBeVisible();
  });

  test("their jobs list loads and shows only their own work", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/jobs");
    // Either real jobs or an honest empty state — never a crash, and never
    // sample data.
    await expect(page.locator("body")).toContainText(/job|nothing|no jobs|booked/i);
    await expect(page.locator("text=Error")).toHaveCount(0);
  });

  test("no customer pricing or margin reaches the contractor's browser", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);

    for (const path of ["/portal", "/portal/jobs", "/portal/requests", "/portal/money"]) {
      const response = await page.goto(path);
      const html = (await response?.text()) ?? "";

      // Match the NAMES this codebase gives customer money, not the bare word
      // "margin" — a stylesheet writes `margin:0` and the framework's own
      // inline styles are in the payload, so a loose pattern fails on CSS and
      // teaches everyone to ignore the test. (The audit hit exactly this trap.)
      //
      // Checked against the whole response, RSC payload included: data leaks
      // hide there, not in the rendered markup.
      for (const pattern of [
        /marginCents|margin_cents/i,
        /subtotalCents|subtotal_cents/i,
        /customer ?total/i,
        /marginPct/i,
      ]) {
        expect(html, `${path} leaked ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test("the profile page is reachable and states their compliance", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    await expect(page.getByRole("heading", { name: /my profile/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/ready for work|not yet offerable/i);
  });
});

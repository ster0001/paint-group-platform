import { test, expect } from "@playwright/test";
import { driveNoPlanWizard } from "./drive";

/**
 * S0 report (5 Oct 2026), bug 1: every "book" / "tell us" link off the guide
 * range went to `/estimate/scope?id=…#reach`, but the reach strip only renders
 * on `/estimate/book` since 3d3ad8c, so the links landed on the scope editor
 * with nothing to scroll to. They now go to the Book page. Anonymous customer,
 * as the testing law requires.
 *
 * Since S3 (visit booking, 7 Oct 2026, 38ca5594) "Book a site visit" and the
 * estimator strip go to the visit page, `/estimate/visit`, where the customer
 * picks (or requests) a time — never to a page without a booking on it.
 */
test.describe("reveal → Book page links", () => {
  test("Book a site visit and the estimator strip land on the visit page", async ({ page }) => {
    await driveNoPlanWizard(page, { stopAtReveal: true });
    const reveal = page.getByTestId("reveal");
    await expect(reveal).toBeVisible();
    const estimateId = await reveal.getAttribute("data-estimate-id");
    expect(estimateId).toBeTruthy();

    // No anchor off the range carries #reach; the strip names the visit page.
    const hrefs = await page.locator('a[href*="/estimate/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => h.includes("#reach"))).toEqual([]);
    expect(hrefs.some((h) => h.startsWith(`/estimate/visit?id=${estimateId}`))).toBe(true);

    await page.getByTestId("door-book").click();
    await page.waitForURL((u) => u.pathname === "/estimate/visit" && u.searchParams.get("id") === estimateId);
    // A time to pick, or (with nothing free) a time to request — a booking page either way.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/time|visit/i);
  });
});

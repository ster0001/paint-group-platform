import { test, expect } from "@playwright/test";
import { driveNoPlanWizard } from "./drive";

/**
 * S0 report (5 Oct 2026), bug 1: every "book" / "tell us" link off the guide
 * range went to `/estimate/scope?id=…#reach`, but the reach strip only renders
 * on `/estimate/book` since 3d3ad8c, so the links landed on the scope editor
 * with nothing to scroll to. They now go to the Book page. Anonymous customer,
 * as the testing law requires.
 */
test.describe("reveal → Book page links", () => {
  test("Book your estimator and the estimator strip land on /estimate/book", async ({ page }) => {
    await driveNoPlanWizard(page, { stopAtReveal: true });
    const reveal = page.getByTestId("reveal");
    await expect(reveal).toBeVisible();
    const estimateId = await reveal.getAttribute("data-estimate-id");
    expect(estimateId).toBeTruthy();

    // Every anchor off the range that used to carry #reach now names the Book page.
    const hrefs = await page.locator('a[href*="/estimate/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => h.includes("#reach"))).toEqual([]);
    expect(hrefs.some((h) => h.startsWith(`/estimate/book?id=${estimateId}`))).toBe(true);

    await page.getByTestId("door-book").click();
    await page.waitForURL((u) => u.pathname === "/estimate/book" && u.searchParams.get("id") === estimateId);
    await expect(page.getByTestId("reach-strip")).toBeVisible();
  });
});

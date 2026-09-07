import { test, expect, type Page } from "@playwright/test";

/**
 * CRM v2 · P7 — the volume gate (deep dive §4.7.5).
 *
 * Against the C1 project (27k accounts, 20k jobs): the four screens the office
 * opens all day, and the badge fast path. Times are wall-clock from request
 * to DOM ready. The bar is CRM_VOLUME_MS (default 2500 ms — a dev server
 * compiles on first hit; run through scripts/c1/run-e2e.sh for a production
 * build and set CRM_VOLUME_MS=500 for the brief's p95 target).
 */

const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const BAR = Number(process.env.CRM_VOLUME_MS ?? 2500);

async function loginAs(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', staff.email);
  await page.fill('input[type="password"]', staff.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function timed(page: Page, path: string, warm = true): Promise<number> {
  if (warm) await page.goto(path, { waitUntil: "domcontentloaded" });   // compile / cache the route once
  const t0 = Date.now();
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return Date.now() - t0;
}

test.describe("CRM volume gate", () => {
  test.skip(!staff.email, "needs E2E_STAFF_* creds");
  test.setTimeout(180_000);

  test("Today, Customers, a record, the Diary and the lists load within the bar; the badge's second ask is served from cache", async ({ page }) => {
    await loginAs(page);
    const timings: Record<string, number> = {};
    timings.today = await timed(page, "/crm/today");
    timings.customers = await timed(page, "/crm/customers");
    const firstRecord = await page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>("a.prow, .prow a, a[href^='/crm/customers/']");
      return a?.getAttribute("href") ?? null;
    });
    if (firstRecord) timings.record = await timed(page, firstRecord);
    timings.diary = await timed(page, "/crm/diary?view=week");
    timings.lists = await timed(page, "/crm/segments");

    const b0 = Date.now();
    const first = await page.request.get("/crm/api/badge?fresh=1");
    timings.badgeFresh = Date.now() - b0;
    const b1 = Date.now();
    const second = await page.request.get("/crm/api/badge");
    timings.badgeCached = Date.now() - b1;
    expect(first.ok()).toBe(true);
    expect(second.ok()).toBe(true);
    const cached = await second.json();
    expect(cached.cached).toBe(true);

    console.log("[crm-volume] ms:", JSON.stringify(timings));
    for (const [k, ms] of Object.entries(timings)) {
      if (k === "badgeFresh") continue;
      expect(ms, `${k} took ${ms} ms (bar ${BAR})`).toBeLessThan(BAR);
    }
    expect(timings.badgeCached, "cached badge").toBeLessThan(Math.min(BAR, 800));
  });
});

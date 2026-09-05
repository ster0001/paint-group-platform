import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, signIn } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Session 8 (docs/briefs/website-audiences.md §8) — the business site, on
 * a phone. With COMMERCIAL_DOMAIN set the business site is that host
 * (Chromium resolves *.localhost to loopback); without it, /business on the
 * residential host. Journey 3 (the 301) needs the domain and skips without.
 *
 *  1. business root → business H1, business chip pre-selected, three
 *     business job cards, business FAQ
 *  2. same page → tap "My home" → address → See my price → wizard with mode=home
 *  3. residential /business → 301 to the commercial root
 *  4. Settings → Website copy → edit a business FAQ answer → live on the
 *     business site (ISR revalidated by the save)
 */
const db = serviceClient();
const staff = credentials("STAFF");
const COMMERCIAL = (process.env.COMMERCIAL_DOMAIN ?? "").trim();

test.describe("website audiences (session 8)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const slugs = [1, 2, 3].map((n) => `e2e-biz-${run}-${n}`);
  let businessRoot = "";

  test.beforeAll(async ({ baseURL }) => {
    businessRoot = COMMERCIAL ? `http://${COMMERCIAL}/` : `${baseURL}/business`;
    // Three published business jobs (§1: the business site launches with real
    // commercial cards, never padded with home jobs).
    const base = {
      job_type: "commercial", property_type: "business", suburb: "Preston", completed_on: "2026-07-01", days_on_site: 3,
      price_low_cents: 690000, price_high_cents: 770000, scope_line: "e2e shopfront", hero_path: `e2e/${run}/hero.jpg`, consent_confirmed: true, published: true,
    };
    for (const [i, slug] of slugs.entries()) {
      const { error } = await db!.from("showcase_jobs").insert({ ...base, slug, title: `E2E business job ${i + 1}`, featured_rank_business: i + 1 });
      if (error) throw error;
    }
  });
  test.afterAll(async () => {
    if (!db) return;
    await db.from("showcase_jobs").delete().in("slug", slugs);
    await db.from("site_content").delete().eq("audience", "business").eq("section", "faq").eq("key", "a_2");
  });

  test("1 · the business homepage: H1, chip, three business cards, business FAQ", async ({ page }) => {
    test.setTimeout(150_000);
    // The page is static with ISR (60 s): the fixtures were inserted after the
    // server built it, so reload until the regenerated page carries them.
    await expect.poll(async () => {
      await page.goto(businessRoot);
      return page.locator("#jobs .job:not(.placeholder)").count();
    }, { timeout: 120_000, intervals: [3_000] }).toBe(3);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paint your propertieswithout the chasing.");
    const hero = page.locator("#top");
    await expect(hero.getByRole("button", { name: "A business or property I manage" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("main")).toHaveAttribute("data-audience", "business");
    const cards = page.locator("#jobs .job:not(.placeholder)");
    await expect(cards).toHaveCount(3);
    await expect(page.getByTestId("featured-placeholder")).toHaveCount(0);
    for (const slug of slugs) await expect(page.locator(`#jobs a[href$="/work/${slug}"]`).first()).toBeAttached();
    // the trade lane is promoted: it comes straight after the jobs
    const order = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));
    expect(order.indexOf("trade")).toBe(order.indexOf("jobs") + 1);
    await expect(page.locator("#faq")).toContainText("Can you put our PO number on everything?");
    await expect(page.locator("main")).not.toContainText("—");
    await expect(page.getByTestId("nav-other-audience")).toHaveText("For homes →");
    const ld = await page.locator("script[type='application/ld+json']").allTextContents();
    expect(ld.some((t) => t.includes('"LocalBusiness"') && t.includes("Commercial painting"))).toBe(true);
  });

  test("2 · the chip is unlocked: My home → address → See my price → the wizard in home mode", async ({ page }) => {
    await page.goto(businessRoot);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const hero = page.locator("#top");
    await hero.getByRole("button", { name: "My home" }).tap();
    await expect(hero.getByRole("button", { name: "My home" })).toHaveAttribute("aria-pressed", "true");
    const field = hero.getByRole("textbox", { name: "Address" });
    await field.fill("12 Elm Street, Northcote VIC 3070");
    await hero.getByRole("button", { name: "See my price →" }).tap();
    await expect(page).toHaveURL(/\/estimate\?/, { timeout: 20_000 });
    expect(page.url()).toContain("mode=home");
    expect(page.url()).toContain("src=commercial_home_hero");
  });

  test("3 · residential /business is one canonical home: 301 to the commercial root", async ({ request, baseURL }) => {
    test.skip(!COMMERCIAL, "COMMERCIAL_DOMAIN not set on this stack — /business is served locally instead");
    const r = await request.get(`${baseURL}/business`, { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(r.headers()["location"]).toBe(`https://${COMMERCIAL}/`);
    const r2 = await request.get(`${baseURL}/business/work/${slugs[0]}`, { maxRedirects: 0 });
    expect(r2.status()).toBe(301);
    expect(r2.headers()["location"]).toBe(`https://${COMMERCIAL}/work/${slugs[0]}`);
  });

  test("4 · edit a business FAQ answer in Settings → it shows on the business site", async ({ page, browser, request }) => {
    test.skip(!staff, "needs E2E_STAFF_* creds");
    test.setTimeout(120_000);
    const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await signIn(desk, staff!, /\/estimates/);
    await desk.goto("/settings#site-copy");
    const box = desk.getByTestId("site-copy");
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.getByTestId("copy-tab-business").click();
    await box.getByTestId("copy-section-faq").locator("summary").click();
    const answer = `Yes. Every property you manage sits under one login. e2e ${run}`;
    await box.getByTestId("copy-faq-a_2").fill(answer);
    await box.getByTestId("copy-save").click();
    await expect(box.getByTestId("copy-status")).toContainText("Saved", { timeout: 20_000 });

    // Within 60 s (§3 AC). Polled through the HTTP client — a browser page
    // re-visiting the same URL can answer from its own cache — then seen in
    // the browser with a cache-busting query.
    await expect.poll(async () => {
      const r = await request.get(businessRoot);
      const t = await r.text();
      if (!t.includes(`e2e ${run}`)) console.log("business page still stale", r.headers()["x-nextjs-cache"]);
      return t;
    }, { timeout: 60_000, intervals: [2_000] }).toContain(`e2e ${run}`);
    await page.goto(`${businessRoot}?v=${run}`);
    // textContent, not innerText: the answers sit inside closed <details>.
    expect(await page.locator("#faq").textContent()).toContain(`e2e ${run}`);
    // and the homes site is untouched
    await page.goto(`/?v=${run}`);
    await expect(page.locator("#faq")).not.toContainText(`e2e ${run}`);
  });
});

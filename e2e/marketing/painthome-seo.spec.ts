import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Paint Home SEO foundations (brief of 26 Nov 2026), as an anonymous visitor
 * on the Paint Home host, on a phone (390 × 780) and a laptop (1470 px).
 *
 *  1. /work is Paint Home's own page in search: its own canonical, the
 *     brand's index switch, job names as H2, BreadcrumbList + ItemList
 *  2. Privacy, Terms and Warranty carry a self-referencing canonical
 *  3. the sitemap lists home, /work and the three legal pages, and every
 *     address it lists agrees with that page's own metadata
 *  4. the old WordPress addresses answer with a permanent redirect to a
 *     page that loads, with and without a trailing slash
 *  5. an unknown address is a Paint Home 404: one title, the brand's name,
 *     links to home and /work, no "Paint Group"
 *  6. home: lang en-AU, LocalBusiness with hours, logo, image, email and a
 *     suburb list and no rating, FAQ questions as H3, no empty alt text
 *  7. a job page: BreadcrumbList, a described photo for every image
 *  8. nothing about Paint Group's index settings or the blocked areas moved
 *
 * ⚑ P9 stands (Paint Group owns the job pages in search): the job page keeps
 * its Paint Group canonical and stays out of the Paint Home sitemap until
 * Tom rules otherwise. Test 7 pins that, so a change to it is deliberate.
 */
const db = serviceClient();
const PH = "https://painthome.com.au";
const INDEXABLE = process.env.PAINTHOME_INDEXABLE === "1";

const dismiss = (page: Page) => page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
const robotsOf = (html: string) => html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? null;
const titlesOf = (html: string) => [...html.matchAll(/<title[^>]*>([^<]*)<\/title>/g)].map((m) => m[1]);
function ldOf(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
}
const ofType = (html: string, type: string) => ldOf(html).find((b) => b["@type"] === type);
/** Every <img> inside <main> has words in its alt. */
async function expectDescribedImages(page: Page) {
  const alts = await page.locator("main img").evaluateAll((els) => els.map((e) => (e.getAttribute("alt") ?? "").trim()));
  expect(alts.length).toBeGreaterThan(0);
  expect(alts.filter((a) => a.length === 0)).toEqual([]);
}

for (const size of [{ name: "phone", viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }, { name: "laptop", viewport: { width: 1470, height: 900 }, isMobile: false, hasTouch: false }]) {
  test.describe(`Paint Home — SEO foundations (${size.name})`, () => {
    test.use({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });

    const run = randomBytes(3).toString("hex");
    const slug = `e2e-seo-${size.name}-${run}`;
    let ph = "";
    const get = (request: APIRequestContext, path: string) => request.get(`${ph}${path}`, { maxRedirects: 0 });

    test.beforeAll(async ({ baseURL }) => {
      const u = new URL(baseURL!);
      ph = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
      if (!db) return;
      const { error } = await db.from("showcase_jobs").insert({
        slug, title: `E2E two bedroom apartment ${run}`, job_type: "interior", property_type: "home", suburb: "Malvern East",
        completed_on: "2026-09-01", days_on_site: 2, scope_line: "e2e seo", hero_path: `e2e/${run}/hero.jpg`, consent_confirmed: true, published: true,
        price_low_cents: 340_000, price_high_cents: 390_000,
        gallery: [{ path: `e2e/${run}/a.jpg`, caption: "", kind: "before" }, { path: `e2e/${run}/b.jpg`, caption: "", kind: "before" }, { path: `e2e/${run}/c.jpg`, caption: "Living room", kind: "after" }],
      });
      if (error) throw error;
    });
    test.afterAll(async () => {
      if (db) await db.from("showcase_jobs").delete().eq("slug", slug);
    });

    test("1 · /work is Paint Home's own page: canonical, index switch, H2 job names, breadcrumb and list", async ({ page, request }) => {
      test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
      const r = await get(request, "/work");
      expect(r.status()).toBe(200);
      const html = await r.text();
      expect(canonicalOf(html)).toBe(`${PH}/work`);
      expect(robotsOf(html)).toBe(INDEXABLE ? "index, follow" : "noindex, nofollow");
      expect(html).toMatch(/<html[^>]* lang="en-AU"/);
      const crumbs = ofType(html, "BreadcrumbList") as { itemListElement: Array<{ name: string; item: string }> } | undefined;
      expect(crumbs?.itemListElement.map((c) => c.item)).toEqual([`${PH}/`, `${PH}/work`]);
      const list = ofType(html, "ItemList") as { itemListElement: Array<{ url: string; name: string }> } | undefined;
      expect(list?.itemListElement.some((i) => i.url === `${PH}/work/${slug}`)).toBe(true);
      expect(JSON.stringify(ldOf(html))).not.toContain("paintgroup.com.au/work");

      await page.goto(`${ph}/work`);
      await dismiss(page);
      await expect(page.locator(`a[href$="/work/${slug}"]`).getByRole("heading", { level: 2 })).toHaveText(`E2E two bedroom apartment ${run}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expectDescribedImages(page);
    });

    test("2 · Privacy, Terms and Warranty each name themselves as the canonical", async ({ request }) => {
      for (const path of ["/privacy", "/terms", "/warranty"]) {
        const r = await get(request, path);
        expect(r.status(), path).toBe(200);
        const html = await r.text();
        expect(canonicalOf(html), path).toBe(`${PH}${path}`);
        expect(robotsOf(html), path).toBe(INDEXABLE ? "index, follow" : "noindex, nofollow");
      }
    });

    test("3 · the sitemap lists home, /work and the legal pages, and agrees with each page's metadata", async ({ request, baseURL }) => {
      const xml = await (await get(request, "/sitemap.xml")).text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      for (const path of ["/", "/work", "/privacy", "/terms", "/warranty"]) expect(locs).toContain(`${PH}${path}`);
      // ⚑ P9: no job page on the Paint Home sitemap until Tom rules.
      expect(locs.filter((l) => /\/work\/[a-z0-9-]+$/.test(l))).toEqual([]);
      for (const blocked of ["/estimate", "/account", "/portal", "/login"]) expect(locs.some((l) => l.includes(blocked))).toBe(false);
      expect(xml).not.toContain("paintgroup");
      // lastmod is a real date or absent, never "today on every address".
      const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
      for (const m of mods) expect(Number.isNaN(Date.parse(m))).toBe(false);
      // Every listed address says the same of itself.
      for (const loc of locs) {
        const path = new URL(loc).pathname;
        const r = await get(request, path);
        expect(r.status(), path).toBe(200);
        const html = await r.text();
        // Next prints the root's canonical without its closing slash; the two are the same address.
        expect(new URL(canonicalOf(html) ?? "about:blank").href, path).toBe(new URL(loc).href);
        expect(robotsOf(html), path).toBe(INDEXABLE ? "index, follow" : "noindex, nofollow");
      }
      expect(await (await request.get(`${baseURL}/sitemap.xml`)).text()).not.toContain("painthome");
    });

    test("4 · the old WordPress addresses redirect for good to a page that loads", async ({ request, baseURL }) => {
      const cases: Array<[string, string]> = [
        ["/guarantee", "/warranty"], ["/contact-us", "/#contact"], ["/portfolio", "/work"], ["/portfolio/bathrooms", "/work"],
        ["/portfolio/houses", "/work"], ["/portfolio/kitchens", "/work"], ["/blog", "/"], ["/blog/some-old-post", "/"], ["/referral", "/"],
      ];
      for (const [from, to] of cases) {
        for (const path of [from, `${from}/`]) {
          // Follow by hand: a hop may only be permanent, and the walk ends on the target.
          let at = path;
          let hops = 0;
          for (;;) {
            const r = await get(request, at);
            if (r.status() === 200) break;
            expect([301, 308], `${path} → ${at}`).toContain(r.status());
            const next = new URL(r.headers()["location"], `${PH}${at}`);
            expect(["painthome.com.au", "painthome.localhost"], path).toContain(next.hostname);
            at = `${next.pathname}${next.hash}`;
            expect(++hops, path).toBeLessThan(4);
          }
          expect(at, path).toBe(to);
          expect(hops, path).toBeGreaterThan(0);
        }
      }
      // The contact redirect lands on something: the home page has the anchor.
      expect(await (await get(request, "/")).text()).toContain('id="contact"');
      // Paint Home's host only: the same address on the Paint Group site is not redirected by this table.
      const pg = await request.get(`${baseURL}/guarantee`, { maxRedirects: 0 });
      expect(pg.headers()["location"] ?? "").not.toContain("/warranty");
    });

    test("5 · an unknown address is a Paint Home 404", async ({ page, request }) => {
      for (const path of [`/no-such-page-${run}`, `/work/no-such-job-${run}`]) {
        const r = await get(request, path);
        expect(r.status(), path).toBe(404);
        const html = await r.text();
        const titles = titlesOf(html);
        expect(titles, path).toEqual(["Page not found | Paint Home"]);
        expect(html, path).toMatch(/<meta name="robots" content="noindex/);
        await page.goto(`${ph}${path}`);
        await dismiss(page);
        await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
        await expect(page.locator("main a[href='/']")).toBeVisible();
        await expect(page.locator("main a[href='/work']")).toBeVisible();
        const text = (await page.locator("body").innerText()).replace(/Powered by Paint Group/gi, "");
        expect(text, path).not.toContain("Paint Group");
      }
    });

    test("6 · home: en-AU, a full LocalBusiness with no rating, FAQ questions as H3, every image described", async ({ page, request }) => {
      const html = await (await get(request, "/")).text();
      expect(html).toMatch(/<html[^>]* lang="en-AU"/);
      const lb = ofType(html, "LocalBusiness") as Record<string, unknown> | undefined;
      expect(lb).toBeTruthy();
      expect(lb!.name).toBe("Paint Home");
      expect(lb!.email).toBe("hello@painthome.com.au");
      expect(String(lb!.logo)).toMatch(/^https:\/\/painthome\.com\.au\//);
      expect(String(lb!.image)).toMatch(/^https:\/\//);
      const hours = lb!.openingHoursSpecification as Array<{ dayOfWeek: string[]; opens: string; closes: string }>;
      expect(hours[0].dayOfWeek).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
      expect([hours[0].opens, hours[0].closes]).toEqual(["08:00", "17:00"]);
      const areas = lb!.areaServed as Array<{ name: string }>;
      expect(Array.isArray(areas)).toBe(true);
      expect(areas.map((a) => a.name)).toContain("Melbourne");
      expect(lb!.aggregateRating).toBeUndefined();
      expect(lb!.review).toBeUndefined();
      expect(JSON.stringify(ldOf(html))).not.toMatch(/aggregateRating|"Review"/);

      await page.goto(`${ph}/`);
      await dismiss(page);
      const faq = page.locator("#faq details summary");
      const n = await faq.count();
      expect(n).toBeGreaterThan(0);
      await expect(page.locator("#faq details summary h3")).toHaveCount(n);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expectDescribedImages(page);
    });

    test("7 · a job page: breadcrumb, a different description on every photo; P9 still holds", async ({ page, request }) => {
      test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
      const r = await get(request, `/work/${slug}`);
      expect(r.status()).toBe(200);
      const html = await r.text();
      expect(html).toMatch(/<html[^>]* lang="en-AU"/);
      const crumbs = ofType(html, "BreadcrumbList") as { itemListElement: Array<{ name: string; item: string }> } | undefined;
      expect(crumbs?.itemListElement.map((c) => c.item)).toEqual([`${PH}/`, `${PH}/work`, `${PH}/work/${slug}`]);
      const article = ofType(html, "Article") as { publisher: { name: string } } | undefined;
      expect(article?.publisher.name).toBe("Paint Home");
      // ⚑ P9 (24 Oct): the job page's canonical is Paint Group's and it is not indexed here. Tom to rule.
      expect(canonicalOf(html)).toMatch(/\/work\/e2e-seo-/);
      expect(canonicalOf(html)).not.toContain("painthome.com.au");
      expect(robotsOf(html)).toBe("noindex, nofollow");

      await page.goto(`${ph}/work/${slug}`);
      await dismiss(page);
      const alts = await page.locator(".pp-gallery img").evaluateAll((els) => els.map((e) => e.getAttribute("alt") ?? ""));
      expect(alts).toHaveLength(3);
      expect(new Set(alts).size).toBe(3);
      for (const a of alts) expect(a).toContain("Malvern East");
      expect(alts[2]).toContain("Living room");
      await expectDescribedImages(page);
    });

    test("8 · the Paint Group site and the blocked areas are as they were", async ({ request, baseURL }) => {
      const pg = await request.get(`${baseURL}/`, { maxRedirects: 0 });
      expect(pg.headers()["x-audience"]).toBe("home");
      if (process.env.SITE_INDEXABLE !== "1") {
        expect(pg.headers()["x-robots-tag"]).toBe("noindex, nofollow");
        expect(robotsOf(await pg.text())).toBe("noindex, nofollow");
        expect(await (await request.get(`${baseURL}/robots.txt`)).text()).toContain("Disallow: /");
      }
      for (const root of [ph, baseURL!]) {
        for (const path of ["/estimate", "/login"]) {
          const r = await request.get(`${root}${path}`);
          const html = await r.text();
          const header = r.headers()["x-robots-tag"] ?? "";
          expect(/noindex/.test(robotsOf(html) ?? "") || /noindex/.test(header), `${root}${path}`).toBe(true);
        }
        for (const path of ["/account", "/portal"]) {
          // Signed out these bounce to the login page; wherever they land must not be indexable.
          const r = await request.get(`${root}${path}`);
          const header = r.headers()["x-robots-tag"] ?? "";
          expect(/noindex/.test(robotsOf(await r.text()) ?? "") || /noindex/.test(header), `${root}${path}`).toBe(true);
        }
      }
    });
  });
}

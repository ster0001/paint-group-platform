import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, signIn, test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Paint Home brief (docs/briefs/paint-home.md) — Sessions 1 and 2, as an
 * anonymous visitor on a phone. Chromium resolves *.localhost to loopback,
 * so the Paint Home host is `painthome.localhost:<port>` with no env; the
 * resolver treats it exactly as painthome.com.au.
 *
 *  1. domain → `x-audience: painthome`, no cookie; the Paint Home words
 *     (tagline H1, ten FAQs, Inside / Outside chips), the mark + "powered by
 *     Paint Group", no business link, no trade lane, the Enlvn legal line,
 *     the reviews credit, its own LocalBusiness `@id` under Paint Group's;
 *     "Paint Group" exactly four times on the page and none of the banned
 *     words outside the big-job answer (§4 AC); Outside → See my price →
 *     the wizard with brand=painthome&scope=exterior (§3, §5 AC)
 *  2. the Paint Group site is untouched; /painthome on a dev host serves
 *     Paint Home locally; a Paint Home 404 is Paint Home's
 *  3. Settings → Brands: a Paint Home phone number shows on the Paint Home
 *     site within a minute and not on the homes site (§6)
 *  4. the job cards: a home job over the phone-close ceiling never shows,
 *     one under it does, by featured_rank_painthome (§4)
 *  5. Settings → Website copy → Paint Home tab: an edited FAQ answer is live
 *     on Paint Home within a minute and not on the homes site (§6)
 */
const db = serviceClient();
const staff = credentials("STAFF");
const BANNED = /\b(business|businesses|commercial|agent|agents|PO|portfolio|trade)\b/i;

test.describe("Paint Home — brand and words (sessions 1–2)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const slugs = { over: `e2e-ph-${run}-over`, under: `e2e-ph-${run}-under` };
  let phRoot = "";

  const dismiss = (page: Page) => page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}/`;
  });
  test.afterAll(async () => {
    if (!db) return;
    // Session 3 restores Settings → Brands to its defaults (an empty row); 4 and 5 remove their rows.
    await db.from("settings").upsert({ key: "brands", value: {} }, { onConflict: "key" });
    await db.from("showcase_jobs").delete().in("slug", Object.values(slugs));
    await db.from("site_content").delete().eq("audience", "painthome").eq("section", "faq").eq("key", "a_2");
  });

  test("1 · painthome.localhost is the Paint Home site: header, words, brand, four mentions, hand-off tagged with scope", async ({ page, request }) => {
    const r = await request.get(phRoot, { maxRedirects: 0 });
    expect(r.status()).toBe(200);
    expect(r.headers()["x-audience"]).toBe("painthome");
    expect(r.headers()["set-cookie"] ?? "").not.toMatch(/audience/i);

    await page.goto(phRoot);
    await dismiss(page);
    await expect(page).toHaveTitle("Paint Home | Your qualified local painters");
    await expect(page.locator("main")).toHaveAttribute("data-audience", "painthome");
    await expect(page.locator(".shopfront")).toHaveAttribute("data-brand", "painthome");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your qualifiedlocal painters.");
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
    await expect(page.getByTestId("nav-powered-by")).toHaveText("powered by Paint Group");
    await expect(page.getByTestId("nav-other-audience")).toHaveCount(0);
    await expect(page.locator("nav a[href='#painters']")).toHaveText("Who'll be painting");
    await expect(page.locator("#trade")).toHaveCount(0);
    await expect(page.locator("nav a[href='#trade']")).toHaveCount(0);
    await expect(page.getByTestId("footer-powered-by")).toHaveText("Powered by Paint Group");
    await expect(page.getByTestId("footer-legal")).toHaveText("Enlvn Pty Ltd trading as Paint Home");
    await expect(page.getByTestId("reviews-powered-by")).toContainText("Powered by Paint Group · reviews on Google");
    await expect(page.getByTestId("footer-bigger-jobs")).toHaveAttribute("href", /\/estimate\?.*brand=painthome/);
    expect(await page.locator("a[href*='paintgroup.com.au']").count()).toBe(0);
    await expect(page.locator("#live")).toContainText("This month at Paint Home");

    // the words (§4 AC): ten FAQs with the two new ones; Paint Group exactly four
    // times (nav small print, reviews credit, the FAQ sentence, footer); none of
    // the banned words outside the big-job answer
    const faq = page.locator("#faq details");
    await expect(faq).toHaveCount(10);
    await expect(faq.first().locator("summary")).toHaveText("Who is Paint Home?");
    await expect(faq.nth(4).locator("summary")).toHaveText("My job is larger than a few rooms. Can you still help?");
    const text = (await page.locator(".shopfront").textContent()) ?? "";
    expect(text.match(/Paint Group/g)?.length).toBe(4);
    expect(text.replace("a commercial property", "")).not.toMatch(BANNED);

    // residential only: Inside / Outside, no business chip
    const hero = page.locator("#top");
    await expect(hero.getByRole("button", { name: "A business or property I manage" })).toHaveCount(0);
    await expect(hero.getByRole("button", { name: "Inside" })).toHaveAttribute("aria-pressed", "true");
    await hero.getByRole("button", { name: "Outside" }).tap();
    await expect(hero.getByRole("button", { name: "Outside" })).toHaveAttribute("aria-pressed", "true");

    // its own LocalBusiness, under Paint Group's
    const ld = (await page.locator("script[type='application/ld+json']").allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
    const lb = ld.find((x) => x["@type"] === "LocalBusiness") as { "@id": string; name: string; parentOrganization?: { "@id": string } } | undefined;
    expect(lb?.["@id"]).toBe("https://painthome.com.au/#business");
    expect(lb?.name).toBe("Paint Home");
    expect(lb?.parentOrganization?.["@id"]).toBe("https://paintgroup.com.au/#business");
    const faqLd = ld.find((x) => x["@type"] === "FAQPage") as { mainEntity: unknown[] } | undefined;
    expect(faqLd?.mainEntity).toHaveLength(10);
    expect(await page.locator("link[rel='canonical']").getAttribute("href")).toMatch(/^https:\/\/painthome\.com\.au\/?$/);

    // address → See my price → the wizard, tagged with the brand and the scope
    await hero.getByRole("textbox", { name: "Address" }).fill("7/40 Wattletree Road, Malvern East VIC 3145");
    await hero.getByRole("button", { name: "See my price →" }).tap();
    await expect(page).toHaveURL(/\/estimate\?/, { timeout: 20_000 });
    const q = new URL(page.url()).searchParams;
    expect(q.get("brand")).toBe("painthome");
    expect(q.get("mode")).toBe("home");
    expect(q.get("scope")).toBe("exterior");
    expect(q.get("src")).toBe("painthome_home_hero");
    // the wizard stayed on the Paint Home host (⚑ P5)
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
  });

  test("2 · the Paint Group site is untouched; /painthome on a dev host serves Paint Home locally; a Paint Home 404 is Paint Home's", async ({ page, request, baseURL }) => {
    const home = await request.get(`${baseURL}/`, { maxRedirects: 0 });
    expect(home.headers()["x-audience"]).toBe("home");
    const biz = await request.get(`${baseURL}/business`, { maxRedirects: 0 });
    expect([200, 301]).toContain(biz.status());
    const local = await request.get(`${baseURL}/painthome`, { maxRedirects: 0 });
    expect(local.status()).toBe(200);
    expect(local.headers()["x-audience"]).toBe("painthome");
    await page.goto("/");
    await dismiss(page);
    await expect(page.locator("main")).toHaveAttribute("data-audience", "home");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Transforming spaces.Redefining painting.");
    await expect(page.getByTestId("painthome-logo-nav")).toHaveCount(0);
    await expect(page.getByTestId("nav-powered-by")).toHaveCount(0);
    await expect(page.locator(".shopfront")).toHaveAttribute("data-brand", "paintgroup");
    await expect(page.locator("#faq details")).toHaveCount(8);
    await page.goto("/painthome");
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
    // a mistyped Paint Home URL stays Paint Home (brief §1a)
    const nf = await request.get(`${phRoot}work/no-such-job-${run}`);
    expect(nf.status()).toBe(404);
    await page.goto(`${phRoot}work/no-such-job-${run}`);
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
    await expect(page.getByTestId("footer-painthome")).toBeVisible();
  });

  test("3 · Settings → Brands: a Paint Home number shows on Paint Home within a minute, not on the homes site", async ({ page, browser, request }) => {
    test.skip(!staff || !db, "needs E2E_STAFF_* creds and the service key");
    test.setTimeout(120_000);
    const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await signIn(desk, staff!, /\/(home|estimates)/);
    await desk.goto("/settings#brands");
    const box = desk.getByTestId("brands-settings");
    await expect(box).toBeVisible({ timeout: 20_000 });
    const phone = `1300 ${run.slice(0, 3)} 000`.replace(/[a-f]/g, "7");
    await box.getByTestId("brand-painthome-phoneDisplay").fill(phone);
    await box.getByTestId("brands-save").click();
    await expect(box.getByTestId("brands-status")).toContainText("Saved", { timeout: 20_000 });
    await expect.poll(async () => (await (await request.get(phRoot)).text()).includes(phone), { timeout: 60_000, intervals: [2_000] }).toBe(true);
    await page.goto(`${phRoot}?v=${run}`);
    await expect(page.locator("nav .phone")).toHaveText(phone);
    await page.goto(`/?v=${run}`);
    await expect(page.locator("nav .phone")).not.toHaveText(phone);
  });

  test("4 · the cards: a home job over the phone-close ceiling never shows on Paint Home; one under it does, by its own rank", async ({ page }) => {
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    test.setTimeout(150_000);
    const base = { job_type: "interior", property_type: "home", suburb: "Malvern East", completed_on: "2026-09-01", days_on_site: 2, scope_line: "e2e paint home", hero_path: `e2e/${run}/hero.jpg`, consent_confirmed: true, published: true };
    for (const row of [
      { ...base, slug: slugs.over, title: `E2E over the ceiling ${run}`, price_low_cents: 1_420_000, price_high_cents: 1_580_000, featured_rank_painthome: 1 },
      { ...base, slug: slugs.under, title: `E2E under the ceiling ${run}`, price_low_cents: 340_000, price_high_cents: 390_000, featured_rank_painthome: 2 },
    ]) {
      const { error } = await db!.from("showcase_jobs").insert(row);
      if (error) throw error;
    }
    // ISR (60 s): reload until the regenerated page carries the fixture.
    await expect.poll(async () => {
      await page.goto(`${phRoot}?v=${Date.now()}`);
      return page.locator(`#jobs a[href$="/work/${slugs.under}"]`).count();
    }, { timeout: 120_000, intervals: [3_000] }).toBeGreaterThan(0);
    await expect(page.locator(`#jobs a[href$="/work/${slugs.over}"]`)).toHaveCount(0);
    await expect(page.locator("#jobs")).not.toContainText("$15,800");
    // and the homes site's cards are decided by featured_rank, which neither fixture has
    await page.goto(`/?v=${run}`);
    await expect(page.locator(`#jobs a[href$="/work/${slugs.under}"]`)).toHaveCount(0);
  });

  test("5 · Website copy → Paint Home tab: an edited FAQ answer is live on Paint Home, not on the homes site", async ({ page, browser, request }) => {
    test.skip(!staff || !db, "needs E2E_STAFF_* creds and the service key");
    test.setTimeout(120_000);
    const desk = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await signIn(desk, staff!, /\/(home|estimates)/);
    await desk.goto("/settings#site-copy");
    const box = desk.getByTestId("site-copy");
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.getByTestId("copy-tab-painthome").click();
    await expect(box.getByTestId("copy-preview")).toHaveAttribute("src", /^\/painthome\?/);
    await box.getByTestId("copy-section-faq").locator("summary").click();
    const answer = `You answer a few questions about the property and a price range appears on screen. e2e ${run}`;
    await box.getByTestId("copy-faq-a_2").fill(answer);
    await box.getByTestId("copy-save").click();
    await expect(box.getByTestId("copy-status")).toContainText("Saved", { timeout: 20_000 });
    await expect.poll(async () => (await (await request.get(phRoot)).text()).includes(`e2e ${run}`), { timeout: 60_000, intervals: [2_000] }).toBe(true);
    await page.goto(`${phRoot}?v=${run}`);
    expect(await page.locator("#faq").textContent()).toContain(`e2e ${run}`);
    await page.goto(`/?v=${run}`);
    await expect(page.locator("#faq")).not.toContainText(`e2e ${run}`);
  });
});

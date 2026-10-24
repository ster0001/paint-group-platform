import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, signIn, test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Paint Home brief (docs/briefs/paint-home.md) — Session 1, brand plumbing,
 * as an anonymous visitor on a phone. Chromium resolves *.localhost to
 * loopback, so the Paint Home host is `painthome.localhost:<port>` with no
 * env; the resolver treats it exactly as painthome.com.au.
 *
 *  1. domain → `x-audience: painthome`, no cookie; the page carries the
 *     Paint Home mark + "powered by Paint Group", no business link, no
 *     trade lane, the Enlvn legal line, the reviews credit, its own
 *     LocalBusiness `@id` under Paint Group's; address → See my price →
 *     the wizard with brand=painthome (§3, §5 AC)
 *  2. the Paint Group site is untouched: `/` is home, `/business` is
 *     business, and /painthome on a dev host serves Paint Home locally
 *  3. Settings → Brands: a Paint Home phone number shows on the Paint Home
 *     site within a minute and not on the homes site (§6)
 */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("Paint Home — brand plumbing (session 1)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  let phRoot = "";

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}/`;
  });
  test.afterAll(async () => {
    // Session 3 restores Settings → Brands to its defaults (an empty row).
    if (db) await db.from("settings").upsert({ key: "brands", value: {} }, { onConflict: "key" });
  });

  test("1 · painthome.localhost is the Paint Home site: audience header, brand, no Paint Group links, hand-off tagged", async ({ page, request }) => {
    const r = await request.get(phRoot, { maxRedirects: 0 });
    expect(r.status()).toBe(200);
    expect(r.headers()["x-audience"]).toBe("painthome");
    expect(r.headers()["set-cookie"] ?? "").not.toMatch(/audience/i);

    await page.goto(phRoot);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("main")).toHaveAttribute("data-audience", "painthome");
    await expect(page.locator(".shopfront")).toHaveAttribute("data-brand", "painthome");
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
    await expect(page.getByTestId("nav-powered-by")).toHaveText("powered by Paint Group");
    await expect(page.getByTestId("nav-other-audience")).toHaveCount(0);
    await expect(page.locator("#trade")).toHaveCount(0);
    await expect(page.locator("nav a[href='#trade']")).toHaveCount(0);
    await expect(page.getByTestId("footer-powered-by")).toHaveText("Powered by Paint Group");
    await expect(page.getByTestId("footer-legal")).toHaveText("Enlvn Pty Ltd trading as Paint Home");
    await expect(page.getByTestId("reviews-powered-by")).toContainText("Powered by Paint Group · reviews on Google");
    await expect(page.getByTestId("footer-bigger-jobs")).toHaveAttribute("href", /\/estimate\?.*brand=painthome/);
    // no link anywhere to the Paint Group site
    expect(await page.locator("a[href*='paintgroup.com.au']").count()).toBe(0);
    // residential only: no business chip in the hero
    await expect(page.locator("#top").getByRole("button", { name: "A business or property I manage" })).toHaveCount(0);
    // its own LocalBusiness, under Paint Group's
    const ld = (await page.locator("script[type='application/ld+json']").allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
    const lb = ld.find((x) => x["@type"] === "LocalBusiness") as { "@id": string; name: string; parentOrganization?: { "@id": string } } | undefined;
    expect(lb?.["@id"]).toBe("https://painthome.com.au/#business");
    expect(lb?.name).toBe("Paint Home");
    expect(lb?.parentOrganization?.["@id"]).toBe("https://paintgroup.com.au/#business");
    expect(await page.locator("link[rel='canonical']").getAttribute("href")).toMatch(/^https:\/\/painthome\.com\.au\/?$/);

    // address → See my price → the wizard, tagged
    const hero = page.locator("#top");
    await hero.getByRole("textbox", { name: "Address" }).fill("7/40 Wattletree Road, Malvern East VIC 3145");
    await hero.getByRole("button", { name: "See my price →" }).tap();
    await expect(page).toHaveURL(/\/estimate\?/, { timeout: 20_000 });
    const q = new URL(page.url()).searchParams;
    expect(q.get("brand")).toBe("painthome");
    expect(q.get("mode")).toBe("home");
    expect(q.get("src")).toBe("painthome_home_hero");
    // the wizard stayed on the Paint Home host (⚑ P5)
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
  });

  test("2 · the Paint Group site is untouched; /painthome on a dev host serves Paint Home locally", async ({ page, request, baseURL }) => {
    const home = await request.get(`${baseURL}/`, { maxRedirects: 0 });
    expect(home.headers()["x-audience"]).toBe("home");
    const biz = await request.get(`${baseURL}/business`, { maxRedirects: 0 });
    expect([200, 301]).toContain(biz.status());
    const local = await request.get(`${baseURL}/painthome`, { maxRedirects: 0 });
    expect(local.status()).toBe(200);
    expect(local.headers()["x-audience"]).toBe("painthome");
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("main")).toHaveAttribute("data-audience", "home");
    await expect(page.getByTestId("painthome-logo-nav")).toHaveCount(0);
    await expect(page.getByTestId("nav-powered-by")).toHaveCount(0);
    await expect(page.locator(".shopfront")).toHaveAttribute("data-brand", "paintgroup");
    await page.goto("/painthome");
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
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
});

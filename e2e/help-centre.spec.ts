import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The help centre (brief Phase C, session C1): every guide the index lists is
 * reachable by the role it is for, with its film, and no office content ever
 * reaches a contractor — asserted against the raw response, RSC payload
 * included, the way crew-leak does. Counts come from _index.json, never a
 * literal.
 */
type Entry = { feature: string; role: string; title: string; summary: string; path: string; walkthrough: string | null; media: string[] };
const index = JSON.parse(readFileSync("docs/help/_index.json", "utf8")) as { files: Entry[] };
const contractorGuides = index.files.filter((e) => e.role === "contractor");
const officeGuides = index.files.filter((e) => e.role === "staff" || e.role === "pc");

/**
 * A sentence that exists only in this file: its front-matter summary, which
 * both the list and the guide page render. Compared as React would emit it
 * (apostrophes and ampersands escaped) AND raw, because the RSC payload in the
 * same response carries the unescaped copy.
 */
function signature(e: Entry): string {
  return e.summary.slice(0, 80);
}
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlHas = (html: string, text: string) => html.includes(text) || html.includes(escapeHtml(text));

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");

test.describe("help centre — contractor", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test("lists every contractor guide, opens each with its film, and carries no office text", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    const res = await page.goto("/portal/help");
    const listHtml = (await res?.text()) ?? "";
    for (const g of contractorGuides) {
      await expect(page.getByTestId(`help-${g.feature}`)).toBeVisible();
      expect(listHtml).toContain(g.title);
    }
    expect(await page.getByTestId("help-list").locator("a").count()).toBe(contractorGuides.length);
    for (const o of officeGuides) expect(htmlHas(listHtml, o.title), `office title leaked: ${o.title}`).toBe(false);

    for (const g of contractorGuides) {
      const r = await page.goto(`/portal/help/${g.feature}`);
      expect(r?.status()).toBe(200);
      const html = (await r?.text()) ?? "";
      expect(htmlHas(html, signature(g)), `${g.feature}: its own summary is on the page`).toBe(true);
      for (const o of officeGuides) {
        expect(htmlHas(html, signature(o)), `${g.feature}: office text leaked from ${o.feature}/${o.role}`).toBe(false);
      }
      if (g.walkthrough) {
        const film = page.getByTestId("help-film").locator("img");
        await expect(film).toBeVisible();
        const src = (await film.getAttribute("src")) ?? "";
        const media = await page.request.get(src);
        expect(media.status()).toBe(200);
        expect(media.headers()["content-type"]).toContain("image/gif");
      }
      // The first screenshot on the page is served, not a broken link.
      const shot = page.locator(".help-article figure.shot img").first();
      if (await shot.count()) {
        const r2 = await page.request.get((await shot.getAttribute("src")) ?? "");
        expect(r2.status()).toBe(200);
      }
    }
  });

  test("an office guide, or an office screenshot, is not found for a contractor — never forbidden", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    const office = officeGuides[0];
    test.skip(!office, "no office guide in the index");
    // The portal route only knows contractor files; the office route redirects a contractor away.
    const r = await page.request.get(`/portal/help/${office.feature}`, { maxRedirects: 0 });
    // Same feature may well have a contractor guide (200); what must never happen is 403.
    expect([200, 404]).toContain(r.status());
    const officeShot = office.media[0]?.replace(/^media\//, "");
    if (officeShot) {
      const m = await page.request.get(`/api/help/media/${office.feature}/${officeShot}`);
      expect(m.status()).toBe(404);
    }
  });
});

test.describe("help centre — search (C2)", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));

  test("a contractor finds the painter's guide by a phrase from its steps, and an office phrase finds nothing", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/help");
    await page.getByTestId("help-search").fill("before photo");
    await page.getByTestId("help-search").press("Enter");
    await expect(page).toHaveURL(/q=before\+photo|q=before%20photo/);
    await expect(page.getByTestId("hit-work-orders")).toBeVisible();
    await expect(page.getByTestId("help-results")).toContainText(/before photo/i);

    const r = await page.goto("/portal/help?q=payables");
    const html = (await r?.text()) ?? "";
    await expect(page.getByTestId("help-results")).toContainText("Nothing mentions");
    for (const o of officeGuides) expect(htmlHas(html, signature(o))).toBe(false);
  });

  test("the office finds the PC guide by the same phrase", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/help?q=before+photo");
    await expect(page.getByTestId("hit-work-orders-pc")).toBeVisible();
    const html = await page.content();
    for (const c of contractorGuides) expect(htmlHas(html, c.title)).toBe(false);
  });
});

test.describe("help centre — office", () => {
  test.skip(!staff, missingCreds("STAFF"));

  test("lists staff and pc guides, opens each, and does not list contractor guides", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    const res = await page.goto("/help");
    const html = (await res?.text()) ?? "";
    expect(await page.getByTestId("help-list").locator("a").count()).toBe(officeGuides.length);
    for (const g of officeGuides) expect(htmlHas(html, g.title)).toBe(true);
    for (const c of contractorGuides) expect(htmlHas(html, c.title), `contractor guide listed for the office: ${c.title}`).toBe(false);

    for (const g of officeGuides) {
      const r = await page.goto(`/help/${g.feature}/${g.role}`);
      expect(r?.status()).toBe(200);
      expect(htmlHas((await r?.text()) ?? "", signature(g))).toBe(true);
      if (g.walkthrough) await expect(page.getByTestId("help-film").locator("img")).toBeVisible();
    }
    // A contractor file through the office route is not found. The office
    // shell streams behind loading.tsx, so the status is already sent before
    // notFound() runs — assert on what was served, not the code.
    const c = contractorGuides[0];
    if (c) {
      const r = await page.goto(`/help/${c.feature}/contractor`);
      const body = (await r?.text()) ?? "";
      expect(htmlHas(body, signature(c)), "contractor guide served through the office route").toBe(false);
      expect(body.includes('data-testid="help-guide"')).toBe(false);
      await expect(page.getByTestId("help-guide")).toHaveCount(0);
    }
  });

  test("Help is in the sidebar", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await expect(page.getByRole("link", { name: "Help" }).first()).toBeVisible();
  });
});

test("nobody signed in gets no media", async ({ request }) => {
  const g = index.files[0];
  test.skip(!g || !g.media[0], "no media in the index");
  const r = await request.get(`/api/help/media/${g.feature}/${g.media[0].replace(/^media\//, "")}`);
  expect(r.status()).toBe(404);
});

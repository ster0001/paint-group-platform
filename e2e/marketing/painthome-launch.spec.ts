import { expect } from "@playwright/test";
import { test } from "../helpers";

/**
 * Paint Home brief §7 — the launch plumbing, per host:
 *  1. robots.txt on the Paint Home host is Paint Home's (its own sitemap URL;
 *     Disallow everything while PAINTHOME_INDEXABLE is unset), and the
 *     platform host's robots is the platform's
 *  2. the Paint Home sitemap lists its own pages only — never a job page,
 *     whose canonical is Paint Group's (⚑ P9); the homes sitemap still lists
 *     its job pages
 */
test.describe("Paint Home — launch plumbing (session 6)", () => {
  let phRoot = "";
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });

  test("1 · robots.txt per host", async ({ request, baseURL }) => {
    const ph = await request.get(`${phRoot}/robots.txt`);
    expect(ph.status()).toBe(200);
    expect(ph.headers()["x-audience"]).toBe("painthome");
    const phText = await ph.text();
    expect(phText).toMatch(/^User-agent: \*/);
    if (process.env.PAINTHOME_INDEXABLE === "1") {
      expect(phText).toContain("Sitemap: https://painthome.com.au/sitemap.xml");
      expect(phText).toContain("Disallow: /estimate");
    } else {
      expect(phText).toContain("Disallow: /");
      expect(phText).not.toContain("painthome.com.au/sitemap.xml");
    }
    const pg = await request.get(`${baseURL}/robots.txt`);
    expect(pg.status()).toBe(200);
    expect(pg.headers()["x-audience"]).toBe("home");
    expect(await pg.text()).not.toContain("painthome");
  });

  test("2 · the Paint Home sitemap names its own pages only", async ({ request, baseURL }) => {
    const ph = await request.get(`${phRoot}/sitemap.xml`);
    expect(ph.status()).toBe(200);
    const xml = await ph.text();
    expect(xml).toContain("<loc>https://painthome.com.au/</loc>");
    expect(xml).toContain("<loc>https://painthome.com.au/work</loc>");
    expect(xml).not.toMatch(/\/work\/[a-z0-9-]+<\/loc>/);
    expect(xml).not.toContain("paintgroup");
    const pg = await request.get(`${baseURL}/sitemap.xml`);
    expect(await pg.text()).not.toContain("painthome");
  });
});

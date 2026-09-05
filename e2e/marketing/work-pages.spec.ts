import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Homepage v2 · session 4 — /work and /work/[slug] as an ANONYMOUS visitor
 * (brief §4.4c AC): the list shows published jobs only and the filters
 * work; a slug page renders the template's blocks, the lightbox is
 * keyboard-operable, metadata + Article JSON-LD are there; an unpublished
 * slug is 404; "Get a price like this" lands in the wizard with address,
 * mode AND scope — and, when the job links an estimate, with that
 * estimate's scope but none of its customer's details.
 *
 * Fixtures go in through the service client (set-up, not the thing under
 * test) and come out again afterwards.
 */
const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

/** A real 8×8 PNG (solid teal) so next/image has bytes to serve. */
function tinyPng(): Buffer {
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 0x3b; raw[o + 1] = 0xd8; raw[o + 2] = 0xe9; } }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function mockLookup(page: Page) {
  await page.route("**/api/places/autocomplete", (route) => route.fulfill({ json: { suggestions: [] } }));
}

test.describe("/work pages (homepage brief §4.4c)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(3).toString("hex");
  const slugA = `e2e-work-interior-${run}`;
  const slugB = `e2e-work-exterior-${run}`;
  const slugC = `e2e-work-draft-${run}`;
  const heroPath = `e2e/${run}/hero.png`;
  const galleryPath = `e2e/${run}/g1.png`;
  let estimateId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("showcase_jobs").select("id").limit(1);
    if (probe.error) throw new Error("migration 20270101 (showcase_jobs) not applied on this stack");
    const png = tinyPng();
    for (const p of [heroPath, galleryPath]) {
      const up = await sb.storage.from("showcase-media").upload(p, png, { contentType: "image/png", upsert: true });
      if (up.error) throw new Error(`fixture upload: ${up.error.message}`);
    }
    // A linked estimate carrying a valid wizard state WITH a customer in it.
    const est = await sb.from("estimates").insert({
      title: "6/31 Westgarth St", status: "accepted", level_of_finish: 3, source: "manual",
      builder_state: { blocks: [], wizard: { version: 1, state: {
        mode: "customer", jobType: "interior", title: "6/31 Westgarth St", address: null, listingUrl: "",
        planRunIds: [], facadeRunIds: [], conditionSourceIds: [], noPlan: true,
        basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
        surfaces: ["walls", "ceilings", "skirting"],
        condition: { tier: "change", darkToLightSurfaces: [] },
        details: { doorStyle: "unsure", doorScope: "frame", windowStyle: "unsure", ceilingHeight: "unsure", damageTier: 1, damageNote: "cracks at 6/31", damagePhotoCount: 0 },
        contact: { name: "Sarah Example", email: "sarah@example.com", phone: "0400000000" },
        paint: { brands: [], colourHelp: null, waterBasedOnly: false, trimsOilBased: null, base: null },
        exterior: null,
        customer: { email: "sarah@example.com", suburb: "Northcote", postcode: "3070", propertyKind: "house", heritageListed: "yes", bodyCorporate: "no", builtPre1970: "unsure", asbestosSuspected: "no" },
      } } },
    }).select("id").single();
    if (est.error) throw new Error(`fixture estimate: ${est.error.message}`);
    estimateId = est.data.id as string;

    // One shape for every row: a bulk insert sends null for any key a row
    // omits, and the jsonb columns are NOT NULL.
    const base = {
      completed_on: "2026-07-01", days_on_site: 4, hero_path: heroPath, consent_confirmed: true,
      scope_line: "", summary: "", what_we_did: [], gallery: [], colours: [], condition_notes: "",
      review_quote: null, review_name: null, estimate_id: null, featured_rank: null,
    };
    const rows = [
      { ...base, slug: slugA, title: `E2E interior ${run}`, job_type: "interior", property_type: "home", suburb: "Northcote",
        price_low_cents: 840000, price_high_cents: 960000, scope_line: "4 rooms + hallway", summary: "Four rooms and a hallway, walls, ceilings and trim.",
        what_we_did: [{ area: "Living room", work: "Walls, ceiling, trim, 2 coats" }, { area: "Hallway", work: "Walls, ceiling, trim" }],
        gallery: [{ path: galleryPath, caption: "Living room, masked up", kind: "during" }, { path: heroPath, caption: "Finished", kind: "after" }],
        colours: [{ surface: "Walls", brand: "Dulux", product: "Wash&Wear", colour: "Natural White" }],
        review_quote: "Exactly the price we were quoted.", review_name: "Sarah · Northcote",
        estimate_id: estimateId, published: true },
      { ...base, slug: slugB, title: `E2E exterior ${run}`, job_type: "exterior", property_type: "business", suburb: "Preston",
        price_low_cents: 690000, price_high_cents: 770000, scope_line: "Render + signage band", summary: "A shopfront done after hours.", published: true },
      { ...base, slug: slugC, title: `E2E draft ${run}`, job_type: "interior", property_type: "home", suburb: "Kew",
        price_low_cents: 1, price_high_cents: 2, published: false },
    ];
    const ins = await sb.from("showcase_jobs").insert(rows);
    if (ins.error) throw new Error(`fixture jobs: ${ins.error.message}`);
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.from("showcase_jobs").delete().in("slug", [slugA, slugB, slugC]);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    await db.storage.from("showcase-media").remove([heroPath, galleryPath]);
  });

  /**
   * /work is ISR (revalidate 60): the build-time render predates the
   * fixtures, and a request after the window serves stale once while the
   * page regenerates (measured: fresh at ~65 s). Reload until they show —
   * up to two windows, so a slow stack still passes.
   */
  async function openWorkFresh(page: Page) {
    const deadline = Date.now() + 150_000;
    for (;;) {
      await page.goto("/work");
      if (await page.getByText(`E2E interior ${run}`).count()) return;
      if (Date.now() > deadline) throw new Error("/work never picked up the fixture within two ISR windows");
      await page.waitForTimeout(5_000);
    }
  }

  test("/work lists published jobs only and the filters narrow them", async ({ page }) => {
    test.setTimeout(200_000); // waits out an ISR window (see openWorkFresh)
    await openWorkFresh(page);
    await expect(page.getByText(`E2E exterior ${run}`)).toBeVisible();
    await expect(page.getByText(`E2E draft ${run}`)).toHaveCount(0);
    await expect(page.getByText("$8,400 – $9,600")).toBeVisible();

    await page.getByRole("group", { name: "Job type" }).getByRole("button", { name: "Exterior" }).click();
    await expect(page.getByText(`E2E interior ${run}`)).toHaveCount(0);
    await expect(page.getByText(`E2E exterior ${run}`)).toBeVisible();
    await page.getByRole("group", { name: "Job type" }).getByRole("button", { name: "All" }).click();
    await page.getByRole("group", { name: "Property" }).getByRole("button", { name: "Homes" }).click();
    await expect(page.getByText(`E2E interior ${run}`)).toBeVisible();
    await expect(page.getByText(`E2E exterior ${run}`)).toHaveCount(0);
  });

  test("a slug page renders the template, the lightbox works from the keyboard, metadata is right", async ({ page }) => {
    await page.goto(`/work/${slugA}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E interior ${run}`);
    await expect(page.getByText("NORTHCOTE · COMPLETED JUL 2026 · 4 DAYS ON SITE")).toBeVisible();
    await expect(page.getByText("$8,400 – $9,600").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we did" })).toBeVisible();
    await expect(page.getByText("Living room", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Colours" })).toBeVisible();
    await expect(page.getByText("Natural White")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the customer said" })).toBeVisible();
    await expect(page.getByText("More jobs")).toBeVisible(); // block 9 — the exterior fixture
    await expect(page.getByText(`E2E exterior ${run}`)).toBeVisible();

    // block 4 — lightbox
    await page.getByRole("button", { name: /open photo 1 of 2/ }).click();
    const dialog = page.getByRole("dialog", { name: /Photo 1 of 2/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Living room, masked up");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: /Photo 2 of 2/ })).toContainText("Finished");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Photo \d+ of/ })).toHaveCount(0); // the consent sheet is a dialog too

    // metadata + JSON-LD (Article, no offers)
    await expect(page).toHaveTitle(`E2E interior ${run} in Northcote, $8,400 – $9,600 | Paint Group`);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toContain(`showcase-media/${heroPath}`);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent() ?? "{}");
    expect(ld["@type"]).toBe("Article");
    expect(JSON.stringify(ld)).not.toContain("Offer");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("an unpublished slug is a 404", async ({ page }) => {
    const res = await page.goto(`/work/${slugC}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(`E2E draft ${run}`)).toHaveCount(0);
  });

  test("Get a price like this: the linked estimate's scope arrives, the customer's details do not", async ({ page }) => {
    await mockLookup(page);
    await page.goto(`/work/${slugA}`);
    const field = page.getByRole("textbox", { name: "Address" });
    await field.fill("12 Elm Street, Northcote");
    await page.getByRole("button", { name: "See my price →" }).click();
    await expect(page).toHaveURL(/\/estimate\?/);
    const u = new URL(page.url());
    expect(u.searchParams.get("address")).toBe("12 Elm Street, Northcote");
    expect(u.searchParams.get("mode")).toBe("home");
    expect(u.searchParams.get("scope")).toBe("interior");
    expect(u.searchParams.get("from")).toBe(slugA);
    expect(u.searchParams.has("estimate")).toBe(false);

    if (await page.getByText("Online estimates are nearly here").count()) throw new Error("wizard_public is OFF on this stack");
    await expect(page.getByPlaceholder("Your address — start typing and pick it")).toHaveValue("12 Elm Street, Northcote");
    await expect(page.locator(".wz-seg button", { hasText: "Interior" })).toHaveClass(/\bon\b/);
    // the original customer's property facts stay (heritage yes), their identity does not
    await expect(page.locator(".wz-seg button", { hasText: /^Yes$/ }).first()).toHaveClass(/\bon\b/);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    await expect(page.getByPlaceholder("Postcode")).toHaveValue("");
    const html = await page.content();
    expect(html).not.toContain("sarah@example.com");
    expect(html).not.toContain("Westgarth");
  });

  test("Get a price like this with no linked estimate: the job type alone seeds the wizard", async ({ page }) => {
    await mockLookup(page);
    await page.goto(`/work/${slugB}`);
    await expect(page.getByRole("button", { name: "A business or property I manage" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Address" }).fill("4/22 High Street, Northcote");
    await page.getByRole("button", { name: "See my price →" }).click();
    await expect(page).toHaveURL(/mode=business/);
    expect(new URL(page.url()).searchParams.get("scope")).toBe("exterior");
    await expect(page.locator(".wz-seg button", { hasText: "Exterior" })).toHaveClass(/\bon\b/);
    await expect(page.locator(".wz-seg button", { hasText: "Commercial" })).toHaveClass(/\bon\b/);
  });
});

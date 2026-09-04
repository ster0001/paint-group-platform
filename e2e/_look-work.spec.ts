import { test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/** Look-only: screenshots of /work and /work/[slug] with a real photo, desktop + phone. */
const db = serviceClient();
const OUT = process.env.LOOK_OUT ?? "/tmp";

test("look: work pages", async ({ page }) => {
  test.skip(!db, "needs service key");
  test.setTimeout(240_000);
  const run = randomBytes(3).toString("hex");
  const slug = `look-work-${run}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 900 } });
  const path = `look/${run}/hero.png`;
  await db!.storage.from("showcase-media").upload(path, png, { contentType: "image/png", upsert: true });
  const base = { completed_on: "2026-07-01", hero_path: path, consent_confirmed: true, published: true, gallery: [{ path, caption: "Finished", kind: "after" }, { path, caption: "Masked up", kind: "during" }, { path, caption: "Before", kind: "before" }], what_we_did: [{ area: "Weatherboards", work: "Wash, sand, prime, 2 coats" }, { area: "Fascias & gutters", work: "Prep and 2 coats" }], colours: [{ surface: "Boards", brand: "Dulux", product: "Weathershield", colour: "Natural White" }, { surface: "Trim", brand: "Dulux", product: "Weathershield", colour: "Monument" }], condition_notes: "", review_name: "Sarah · Thornbury", estimate_id: null, featured_rank: null };
  await db!.from("showcase_jobs").insert([
    { ...base, slug, title: "Exterior weatherboard", job_type: "exterior", property_type: "home", suburb: "Thornbury", days_on_site: 6, price_low_cents: 1420000, price_high_cents: 1580000, scope_line: "Whole exterior, 2 coats, fascias & gutters, front fence", summary: "A 1920s weatherboard in Thornbury, sanded back, primed and given two coats over six days.", review_quote: "Exactly the price we were quoted, and the photos every day meant we never had to wonder." },
    { ...base, slug: `${slug}-b`, title: "Interior Victorian", job_type: "interior", property_type: "home", suburb: "Fitzroy North", days_on_site: 4, price_low_cents: 840000, price_high_cents: 960000, scope_line: "4 rooms + hallway, walls, ceilings, trim", summary: "Four rooms and a hallway.", review_quote: null, gallery: [], colours: [] },
    { ...base, slug: `${slug}-c`, title: "Commercial shopfront", job_type: "commercial", property_type: "business", suburb: "Preston", days_on_site: 3, price_low_cents: 690000, price_high_cents: 770000, scope_line: "Exterior render + signage band, after-hours", summary: "After hours.", review_quote: null, gallery: [], colours: [] },
  ]);
  try {
    const deadline = Date.now() + 150_000;
    for (;;) { await page.goto("/work"); if (await page.getByText("Exterior weatherboard").count()) break; if (Date.now() > deadline) throw new Error("stale"); await page.waitForTimeout(5000); }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/look-work-desktop.png`, fullPage: true });
    await page.goto(`/work/${slug}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/look-job-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/work/${slug}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/look-job-mobile.png`, fullPage: true });
    await page.getByRole("button", { name: /open photo 1 of 3/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/look-job-lightbox.png` });
  } finally {
    await db!.from("showcase_jobs").delete().ilike("slug", `${slug}%`);
    await db!.storage.from("showcase-media").remove([path]);
  }
});

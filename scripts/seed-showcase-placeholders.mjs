/**
 * Homepage v2 · session 2 — seed the three PLACEHOLDER showcase jobs
 * (brief §4.4, ⚑9.2). They are the prototype's three cards, saved as DRAFTS:
 * no photo, consent unconfirmed, so they cannot be published until Tom adds
 * the real job's photo and ticks consent in Settings → Showcase (session 3).
 * Featured ranks 1–3 are set so the moment they are published they are the
 * homepage cards.
 *
 *   node scripts/seed-showcase-placeholders.mjs            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 node scripts/seed-showcase-placeholders.mjs --prod
 *
 * Target rule (seed-scripts-target): the test project by default, production
 * only with --prod AND SEED_ALLOW_PRODUCTION=1, and the resolved project ref
 * is printed before anything is written. Idempotent by slug.
 */
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const PROD = process.argv.includes("--prod");
let url, key;
if (PROD) {
  if (process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error("REFUSED: --prod needs SEED_ALLOW_PRODUCTION=1 — Tom runs this himself.");
    process.exit(1);
  }
  const env = parseEnvFile(new URL("../.env.local", import.meta.url).pathname);
  url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  loadTestEnv();
  url = process.env.NEXT_PUBLIC_SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  refuseProduction(url ?? "");
}
if (!url || !key) { console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
console.log(`target: ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? url} (${PROD ? "PRODUCTION" : "test"})`);

const PLACEHOLDER_SUMMARY = "[Placeholder — replace with the real job's story before publishing. ⚑9.2]";

/** The prototype's three cards, verbatim (design/reference/…-prototype.html §JOBS). */
const ROWS = [
  {
    slug: "exterior-weatherboard-thornbury", featured_rank: 1,
    title: "Exterior weatherboard", job_type: "exterior", property_type: "home", suburb: "Thornbury",
    completed_on: "2026-07-01", days_on_site: 6, price_low_cents: 1_420_000, price_high_cents: 1_580_000,
    scope_line: "Whole exterior, 2 coats, fascias & gutters, front fence",
    what_we_did: [
      { area: "Weatherboards", work: "Wash, sand, prime bare timber, 2 coats" },
      { area: "Fascias & gutters", work: "Prep and 2 coats" },
      { area: "Front fence", work: "2 coats" },
    ],
  },
  {
    slug: "interior-victorian-fitzroy-north", featured_rank: 2,
    title: "Interior Victorian", job_type: "interior", property_type: "home", suburb: "Fitzroy North",
    completed_on: "2026-08-01", days_on_site: 4, price_low_cents: 840_000, price_high_cents: 960_000,
    scope_line: "4 rooms + hallway, walls, ceilings, trim",
    what_we_did: [
      { area: "Living room", work: "Walls, ceiling, trim, 2 coats" },
      { area: "Hallway", work: "Walls, ceiling, trim, 2 coats" },
      { area: "Bedrooms 1 & 2", work: "Walls, ceiling, trim, 2 coats" },
      { area: "Kitchen", work: "Walls and ceiling, 2 coats" },
    ],
  },
  {
    slug: "commercial-shopfront-preston", featured_rank: 3,
    title: "Commercial shopfront", job_type: "commercial", property_type: "business", suburb: "Preston",
    completed_on: "2026-06-01", days_on_site: 3, price_low_cents: 690_000, price_high_cents: 770_000,
    scope_line: "Exterior render + signage band, after-hours",
    what_we_did: [
      { area: "Rendered facade", work: "Wash, patch, 2 coats" },
      { area: "Signage band", work: "Prep and 2 coats, after hours" },
    ],
  },
];

const db = createClient(url, key, { auth: { persistSession: false } });
let inserted = 0, skipped = 0;
for (const r of ROWS) {
  const { data: exists, error: e1 } = await db.from("showcase_jobs").select("id").eq("slug", r.slug).maybeSingle();
  if (e1) { console.error(`read failed for ${r.slug}: ${e1.message} — has migration 20270101 been run?`); process.exit(1); }
  if (exists) { skipped++; continue; }
  const { error } = await db.from("showcase_jobs").insert({
    ...r, summary: PLACEHOLDER_SUMMARY, consent_confirmed: false, published: false,
  });
  if (error) { console.error(`insert failed for ${r.slug}: ${error.message}`); process.exit(1); }
  inserted++;
}
console.log(`showcase placeholders: ${inserted} inserted, ${skipped} already present (drafts — publish from Settings → Showcase once photographed and consented).`);

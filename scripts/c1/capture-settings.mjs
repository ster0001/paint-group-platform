/**
 * Dump a project's `settings` rows to a local JSON file.
 *
 * WHY THIS EXISTS (11 Sep 2026). The C1 test project had to be recreated, and
 * a fresh project built from `supabase/migrations/` + `scripts/c1/seed.mjs`
 * would have been SILENTLY MISPRICED: 30 of its 47 settings keys are set by
 * hand through the Settings screens and appear in no migration — every
 * charge-out rate, the break-even rate, both margin-uplift tiers, the
 * correction factors, labour spread, overhead per billable hour, sundries,
 * materials markup, GST, window sizes, the residential minimums, plus
 * `paint_systems`, `wizard_bands`, `wizard_limits`, `service_area` and
 * `wizard_public`.
 *
 * Every money e2e would then have failed against numbers nobody changed on
 * purpose, and it would have read as a pricing bug rather than a missing seed.
 *
 * The VALUES are Tom's commercial numbers, so they are written to a gitignored
 * file rather than into the repo. The script is committed; the data is not.
 *
 *   set -a; source .env.test.local; set +a
 *   node scripts/c1/capture-settings.mjs            # -> .c1-settings.json
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { productionRef } from "./env.mjs";

const url = process.env.C1_DATABASE_URL;
if (!url) {
  console.error("C1_DATABASE_URL missing — the project's session-pooler connection string.");
  process.exit(1);
}
// Reading is harmless, but the same rule holds everywhere: know the target.
const prod = productionRef();
const out = process.argv[2] ?? ".c1-settings.json";

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 });
await c.connect();
const { rows } = await c.query("select key, value from public.settings order by key");
await c.end();

writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`${rows.length} settings rows -> ${out}`);
console.log(url.includes(prod) ? "  (captured from PRODUCTION — read only, nothing written)" : "  (captured from the test project)");

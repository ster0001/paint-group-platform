/**
 * Public holidays → Settings → Booking rules (visit booking addendum A, S4, R33).
 *
 *   npx tsx scripts/seed-public-holidays.ts            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-public-holidays.ts --prod
 *
 * Reads docs/briefs/data/vic-public-holidays.json — the Victorian Government's
 * published list, copied from the Business Victoria pages on the date in the
 * file, never typed from memory — and MERGES its dates into
 * `settings.visit_booking_rules.publicHolidays`. Dates Tom added by hand in
 * Settings are kept; nothing is removed. Target rule: seed-scripts-target.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { mergeBookingRules } from "../lib/visits/schedule";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PROD = process.argv.includes("--prod");
let url: string | undefined, key: string | undefined;
if (PROD) {
  if (process.env.SEED_ALLOW_PRODUCTION !== "1") { console.error("REFUSED: --prod needs SEED_ALLOW_PRODUCTION=1 — Tom runs this himself."); process.exit(1); }
  const env = parseEnvFile(resolve(ROOT, ".env.local")) as Record<string, string>;
  url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  loadTestEnv();
  url = process.env.NEXT_PUBLIC_SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  refuseProduction(url ?? "");
}
if (!url || !key) { console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
console.log(`target: ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? url} (${PROD ? "PRODUCTION" : "test"})`);

type File = { source: string; fetched_at: string; years: Record<string, Array<{ date: string; name: string }>>; pending?: Array<{ year: number; name: string; reason: string }> };
const file = JSON.parse(readFileSync(resolve(ROOT, "docs/briefs/data/vic-public-holidays.json"), "utf8")) as File;
const dates = Object.values(file.years).flat().map((h) => h.date);
if (dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) { console.error("a date in the file is not YYYY-MM-DD"); process.exit(1); }

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: row, error } = await db.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
  if (error) { console.error(`settings read failed: ${error.message} — is migration 20270213 applied?`); process.exit(1); }
  const rules = mergeBookingRules(row?.value);
  const before = rules.publicHolidays.length;
  const merged = mergeBookingRules({ ...rules, publicHolidays: [...new Set([...rules.publicHolidays, ...dates])] });
  const { error: upErr } = await db.from("settings").upsert({ key: "visit_booking_rules", value: merged }, { onConflict: "key" });
  if (upErr) { console.error(upErr.message); process.exit(1); }
  console.log(`source: ${file.source} (read ${file.fetched_at})`);
  for (const [year, list] of Object.entries(file.years)) console.log(`${year}: ${list.map((h) => `${h.date} ${h.name}`).join("; ")}`);
  for (const p of file.pending ?? []) console.log(`PENDING ${p.year}: ${p.name} — ${p.reason}`);
  console.log(`publicHolidays: ${before} → ${merged.publicHolidays.length} dates (${merged.publicHolidays.length - before} added)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

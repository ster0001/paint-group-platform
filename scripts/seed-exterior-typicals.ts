/**
 * Seed `exterior_typicals` (Exterior wizard v2, S1) from the ONE list in
 * lib/wizard/exterior-typicals.ts — the same rows the model falls back to
 * when the table is empty, so the seed can never disagree with the code.
 *
 *   npx tsx scripts/seed-exterior-typicals.ts            # TEST project (export .env.test.local first)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-exterior-typicals.ts --prod
 *
 * Idempotent: upserts on (version, key). A row Tom has already made his own
 * (source = tom) is left alone unless --force is given, so a re-seed never
 * undoes a ruling.
 *
 * Target rule (seed-scripts-target): process.env first, production only with
 * --prod AND SEED_ALLOW_PRODUCTION=1, and the resolved ref is printed before
 * anything is written. Writes through the service key when the env carries
 * one (the table is staff-write under RLS), else a staff login
 * (SEED_STAFF_EMAIL / SEED_STAFF_PASSWORD).
 */
import { createClient } from "@supabase/supabase-js";
import { resolveSeedTarget } from "./seed-target.mjs";
import { EXTERIOR_TYPICALS, EXTERIOR_TYPICALS_VERSION, rowFromTypical } from "../lib/wizard/exterior-typicals";

const args = process.argv.slice(2);
const wantsProd = args.includes("--prod");
const force = args.includes("--force");
const target = resolveSeedTarget("seed-exterior-typicals");
if (target.isProduction !== wantsProd) {
  console.error(wantsProd
    ? "REFUSED: --prod given but the environment resolves to the TEST project. Load .env.local."
    : "REFUSED: the environment resolves to PRODUCTION without --prod. Load .env.test.local, or say --prod.");
  process.exit(1);
}

async function main() {
  const sb = target.serviceKey
    ? createClient(target.url, target.serviceKey, { auth: { persistSession: false } })
    : createClient(target.url, target.anonKey);
  if (!target.serviceKey) {
    const email = process.env.SEED_STAFF_EMAIL;
    const password = process.env.SEED_STAFF_PASSWORD;
    if (!email || !password) {
      console.error("No service key in the environment: set SEED_STAFF_EMAIL and SEED_STAFF_PASSWORD (the table is staff-write).");
      process.exit(1);
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { console.error("sign-in failed:", error.message); process.exit(1); }
  }

  const { data: existing, error: readErr } = await sb.from("exterior_typicals").select("key, source").eq("version", EXTERIOR_TYPICALS_VERSION);
  if (readErr) {
    if (/find the table|does not exist/i.test(readErr.message)) {
      console.error("exterior_typicals: table missing - paste migration 20270278000000_exterior_typicals.sql first.");
    } else {
      console.error(`exterior_typicals: ${readErr.message}`);
    }
    process.exit(1);
  }
  const owned = new Set((existing ?? []).filter((r) => r.source === "tom").map((r) => r.key as string));
  const rows = EXTERIOR_TYPICALS.filter((t) => force || !owned.has(t.key)).map((t) => rowFromTypical(t, EXTERIOR_TYPICALS_VERSION));
  for (const k of owned) if (!force) console.log(`${k}: left alone (source = tom); pass --force to overwrite`);

  if (rows.length) {
    const { error } = await sb.from("exterior_typicals").upsert(rows, { onConflict: "version,key" });
    if (error) { console.error(`exterior_typicals: ${error.message}`); process.exit(1); }
  }
  const { count, error: countErr } = await sb.from("exterior_typicals").select("*", { count: "exact", head: true }).eq("version", EXTERIOR_TYPICALS_VERSION);
  if (countErr) { console.error(`exterior_typicals: ${countErr.message}`); process.exit(1); }
  console.log(`exterior_typicals  ${rows.length} sent, ${count} rows at version ${EXTERIOR_TYPICALS_VERSION} (expect ${EXTERIOR_TYPICALS.length})`);
  if (count !== EXTERIOR_TYPICALS.length) process.exit(1);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });

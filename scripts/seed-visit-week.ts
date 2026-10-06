/**
 * Visit schedule — seed section 5's week for ONE estimator (addendum A, S2).
 *
 *   npx tsx scripts/seed-visit-week.ts --estimator tom@paintgroup.com.au            # TEST project
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-visit-week.ts --estimator <email> --prod
 *
 * The estimator is named by their staff login email, never guessed. Refuses if
 * that person already has slots (remove them in Settings first). The same
 * week is behind "Load the standard week" in Settings → Visit schedule, so Tom
 * can do this himself without the script. Target rule: seed-scripts-target.
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { STANDARD_WEEK, slotsPerZone } from "../lib/visits/schedule";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const PROD = args.includes("--prod");
const email = args[args.indexOf("--estimator") + 1];
if (!email || email.startsWith("--")) { console.error("usage: seed-visit-week.ts --estimator <staff email> [--prod]"); process.exit(1); }

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

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: users, error: uErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) { console.error(uErr.message); process.exit(1); }
  const user = users.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (!user) { console.error(`no login with email ${email}`); process.exit(1); }
  const { data: prof, error: pErr } = await db.from("profiles").select("id, name, role").eq("id", user.id).maybeSingle();
  if (pErr || !prof || prof.role !== "staff") { console.error(`${email} is not a staff profile`); process.exit(1); }

  const { data: existing, error: sErr } = await db.from("visit_slots").select("id").eq("estimator_id", prof.id).limit(1);
  if (sErr) { console.error(`visit_slots: ${sErr.message} — is migration 20270213 applied?`); process.exit(1); }
  if (existing?.length) { console.error(`${prof.name} already has a week — remove the slots in Settings → Visit schedule first.`); process.exit(1); }

  const { data: rulesRow } = await db.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
  const slotMinutes = Number((rulesRow?.value as { slotMinutes?: number } | null)?.slotMinutes) || 90;
  const rows = STANDARD_WEEK.map((s) => ({
    estimator_id: prof.id, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: slotMinutes,
    zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null,
  }));
  const { error } = await db.from("visit_slots").insert(rows);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`seeded ${rows.length} slots for ${prof.name}; per zone:`, slotsPerZone(STANDARD_WEEK));
}

main().catch((e) => { console.error(e); process.exit(1); });

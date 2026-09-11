/**
 * Creates the test CUSTOMER login (idempotent).
 *
 * Step 5's walkthrough + sign-off e2e runs as a real signed-in customer, so the
 * suite needs an account that owns a job. Sign-up already lands a profile as
 * 'customer' (see create-test-contractors.ts, which has to flip the role), so
 * this only has to guarantee the matching public.customers row exists — that
 * row is what current_customer_id() resolves, and therefore what every
 * customer-side RLS policy keys off.
 *
 * Safe to re-run: an existing account is re-used, the customers row is upserted.
 *
 * Run:  npx tsx scripts/create-test-customer.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSeedTarget } from "./seed-target.mjs";

const SEED = {
  email: "pg.melissa.customer@gmail.com",
  password: "painttest123",
  name: "Melissa Hartley",
  contact: "0421 887 302",
};

function loadEnv() {
  /**
   * `.env.local` is a FALLBACK, not a requirement.
   *
   * This threw ENOENT when the file was absent, which is every git worktree —
   * it is gitignored and lives in the main checkout. So in a worktree the
   * script died here, BEFORE resolveSeedTarget could say a word, and the
   * operator saw a stack trace instead of the guard. Exporting the test
   * project's values is a complete answer on its own and must be enough.
   */
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

async function main() {
  loadEnv();
  // F1-03: loadEnv() does not overwrite exported values, so the test project
  // was always reachable — what was missing is the refusal. This script CREATES
  // AUTH USERS, and pointing it at production is the likeliest source of A3-09
  // (638 of 648 production users being driver output).
  resolveSeedTarget("create-test-customer");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let admin: SupabaseClient;
  if (service) {
    admin = createClient(url, service, { auth: { persistSession: false } });
    console.log("auth: service role key");
  } else {
    admin = createClient(url, anon, { auth: { persistSession: false } });
    const { error } = await admin.auth.signInWithPassword({
      email: process.env.STAFF_EMAIL ?? "pg.sam.staff@gmail.com",
      password: process.env.STAFF_PASSWORD ?? "painttest123",
    });
    if (error) throw new Error(`staff sign-in failed: ${error.message}`);
    console.log("auth: signed in as staff");
  }

  /**
   * THE ADMIN API, not anon signUp.
   *
   * `auth.signUp` with the anon key does not fail for an email that already
   * exists — Supabase returns an OBFUSCATED user with a random id and no
   * session, deliberately, so a stranger cannot probe which addresses are
   * registered. A seed script read that as "account created", took the fake id
   * and wrote it onward, and every insert after it died on a foreign key to
   * auth.users. Both runs today said "created" and neither had.
   *
   * createUser is unambiguous: it either makes the user or says it exists.
   * When it exists, generateLink hands back the real row — `listUsers` would
   * page through 10,000+ users to find one, which is its own trap.
   */
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email: SEED.email,
    password: SEED.password,
    email_confirm: true,
    user_metadata: { name: SEED.name },
  });
  if (!created.error) {
    userId = created.data.user?.id ?? null;
    console.log(`+ ${SEED.email}: account created`);
  } else {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: SEED.email });
    if (link.error) throw new Error(`${SEED.email}: ${created.error.message} / ${link.error.message}`);
    userId = link.data.user?.id ?? null;
    console.log(`· ${SEED.email}: already existed, re-using`);
  }

  if (!userId) throw new Error(`${SEED.email}: no user id returned (is email confirmation on?)`);

  // Role stays 'customer' from sign-up; name/contact are worth having for the
  // walkthrough screens, which greet the customer by name.
  /**
   * UPSERT, not update.
   *
   * This assumed a trigger on auth.users had already made the profile row. On
   * the C1 test project it had not, so the update matched zero rows — which is
   * not an error — and the customers insert below then died on
   * `customers_profile_id_fkey`. The script reported "account created" and left
   * a user with no profile behind it, and the CI specs that look the E2E
   * customer up failed for the rest of the day.
   *
   * A seed script must not depend on a trigger it cannot see.
   */
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: userId, role: "customer", name: SEED.name, contact: SEED.contact }, { onConflict: "id" });
  if (pErr) throw new Error(`profile upsert: ${pErr.message}`);

  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).single();

  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();

  if (!existing) {
    const { error: cErr } = await admin.from("customers").insert({ profile_id: userId });
    if (cErr) throw new Error(`customers row: ${cErr.message}`);
  }

  const { data: row } = await admin
    .from("customers")
    .select("id, profile_id")
    .eq("profile_id", userId)
    .single();

  console.log(`✓ ${SEED.email} ready — role ${profile?.role}, customers.id ${row?.id}`);
  console.log(`\nAdd to .env.local:\n  E2E_CUSTOMER_EMAIL=${SEED.email}\n  E2E_CUSTOMER_PASSWORD=${SEED.password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

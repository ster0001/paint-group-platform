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
import { readFileSync } from "node:fs";
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
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
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

  const authClient = createClient(url, anon, { auth: { persistSession: false } });
  let userId: string | null = null;

  const { data: signUp, error: signUpErr } = await authClient.auth.signUp({
    email: SEED.email,
    password: SEED.password,
    options: { data: { name: SEED.name } },
  });

  if (signUpErr) {
    const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({
      email: SEED.email,
      password: SEED.password,
    });
    if (signInErr) throw new Error(`${SEED.email}: ${signUpErr.message} / ${signInErr.message}`);
    userId = signIn.user?.id ?? null;
    console.log(`· ${SEED.email}: already existed, re-using`);
  } else {
    userId = signUp.user?.id ?? null;
    console.log(`+ ${SEED.email}: account created`);
  }

  if (!userId) throw new Error(`${SEED.email}: no user id returned (is email confirmation on?)`);

  // Role stays 'customer' from sign-up; name/contact are worth having for the
  // walkthrough screens, which greet the customer by name.
  const { error: pErr } = await admin
    .from("profiles")
    .update({ name: SEED.name, contact: SEED.contact })
    .eq("id", userId);
  if (pErr) throw new Error(`profile update: ${pErr.message}`);

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

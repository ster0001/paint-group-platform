/**
 * Creates the two test CONTRACTOR logins (idempotent).
 *
 * Staff can't create contractor accounts from the app yet (that admin screen is
 * a later phase), so this script does it directly:
 *   1. Sign the account up through normal auth (role lands as 'customer').
 *   2. Sign in as staff and flip profiles.role -> 'contractor'.
 *   3. Insert/refresh the matching public.contractors row (company profile).
 *
 * Safe to re-run: existing accounts are re-used, the contractor row is upserted.
 * Neither contractor gets a compliance document, so both start offerable=false —
 * upload an insurance certificate in the portal to see that flip to true.
 *
 * Auth: uses SUPABASE_SERVICE_ROLE_KEY if present; otherwise signs in with
 * STAFF_EMAIL / STAFF_PASSWORD (defaults to the pg.sam.staff test login).
 *
 * Run:  npx tsx scripts/create-test-contractors.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSeedTarget } from "./seed-target.mjs";

type Seed = {
  email: string;
  password: string;
  name: string;
  contact: string;
  company: {
    company_name: string;
    abn: string | null;
    gst_registered: boolean;
    address: string | null;
    invoice_prefix: string;
    tier: string;
  };
};

// Two deliberately different starting states so both paths can be tested:
// Josef arrives with his company details already filled in; Mira arrives blank
// and has to complete her profile in the portal.
const SEEDS: Seed[] = [
  {
    email: "pg.josef.contractor@gmail.com",
    password: "painttest123",
    name: "Josef Kovac",
    contact: "0412 555 018",
    company: {
      company_name: "Kovac Painting Pty Ltd",
      abn: "84 612 908 231",
      gst_registered: true,
      address: "12 Baker Street, Richmond VIC 3121",
      invoice_prefix: "KOV",
      tier: "A",
    },
  },
  {
    email: "pg.mira.contractor@gmail.com",
    password: "painttest123",
    name: "Mira Delaney",
    contact: "0455 210 774",
    company: {
      company_name: "",
      abn: null,
      gst_registered: false,
      address: null,
      invoice_prefix: "",
      tier: "B",
    },
  },
];

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
  // F1-03: this script CREATES AUTH USERS. Refuse production unless asked.
  resolveSeedTarget("create-test-contractors");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // The privileged client: service role if we have it, otherwise a staff login.
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

  for (const seed of SEEDS) {
    // --- 1. the auth user -----------------------------------------------
    // A fresh client per account so signing up never clobbers the admin session.
    const authClient = createClient(url, anon, { auth: { persistSession: false } });
    let userId: string | null = null;

    const { data: signUp, error: signUpErr } = await authClient.auth.signUp({
      email: seed.email,
      password: seed.password,
      options: { data: { name: seed.name } },
    });

    if (signUpErr) {
      // Already registered (or confirmation is on) — fall back to signing in.
      const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({
        email: seed.email,
        password: seed.password,
      });
      if (signInErr) {
        console.error(`✗ ${seed.email}: ${signUpErr.message} / ${signInErr.message}`);
        continue;
      }
      userId = signIn.user?.id ?? null;
      console.log(`· ${seed.email}: already existed, re-using`);
    } else {
      userId = signUp.user?.id ?? null;
      console.log(`+ ${seed.email}: account created`);
    }

    if (!userId) {
      console.error(`✗ ${seed.email}: no user id returned (is email confirmation on?)`);
      continue;
    }

    // --- 2. role -> contractor -------------------------------------------
    const { error: roleErr } = await admin
      .from("profiles")
      .update({ role: "contractor", name: seed.name, contact: seed.contact })
      .eq("id", userId);
    if (roleErr) {
      console.error(`✗ ${seed.email}: could not set role — ${roleErr.message}`);
      continue;
    }

    // --- 3. the contractors row ------------------------------------------
    const { data: existing } = await admin
      .from("contractors")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();

    const row = { profile_id: userId, active: true, ...seed.company };
    const { error: cErr } = existing
      ? await admin.from("contractors").update(row).eq("id", existing.id)
      : await admin.from("contractors").insert(row);
    if (cErr) {
      console.error(`✗ ${seed.email}: contractor row — ${cErr.message}`);
      continue;
    }

    console.log(`✓ ${seed.email} ready — role contractor, ${seed.company.company_name || "profile blank (fill in the portal)"}`);
  }

  const { data: all } = await admin
    .from("contractors")
    .select("id, company_name, offerable, active, profile_id");
  console.log("\ncontractors table now:", JSON.stringify(all, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

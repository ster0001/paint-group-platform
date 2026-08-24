/**
 * C1 · seed — the accounts and reference rows the e2e suites expect,
 * created on the TEST project through its service key.
 *
 *   node scripts/c1/seed.mjs
 *
 * Uses the SAME e2e login emails/passwords as the specs (E2E_STAFF_* /
 * E2E_CONTRACTOR_* / E2E_CUSTOMER_* from .env.test.local), so every existing
 * spec runs unchanged against the test stack. Idempotent — safe to re-run.
 *
 * Reference data (settings incl. invoicing keys, the WO transition matrix,
 * checklists, rate-card scaffolding) all arrives via the migrations
 * themselves — this script only adds what migrations deliberately don't:
 * people.
 */
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv, refuseProduction } from "./env.mjs";

loadTestEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.test.local.");
  process.exit(1);
}
refuseProduction(url);
const service = createClient(url, key, { auth: { persistSession: false } });

async function ensureUser(email, password, role, name) {
  if (!email || !password) {
    console.log(`- skipping ${role} (credentials not in .env.test.local)`);
    return null;
  }
  let userId = null;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data?.user) {
    userId = created.data.user.id;
    console.log(`+ created ${role}: ${email}`);
  } else if (/already/i.test(created.error?.message ?? "")) {
    const { data } = await service.auth.admin.listUsers({ perPage: 200 });
    userId = data?.users?.find((u) => u.email === email)?.id ?? null;
    console.log(`= exists  ${role}: ${email}`);
  } else {
    throw new Error(`create ${email}: ${created.error?.message}`);
  }
  if (userId) {
    const { error } = await service.from("profiles").upsert({ id: userId, role, name });
    if (error) throw new Error(`profile ${email}: ${error.message}`);
  }
  return userId;
}

const staffId = await ensureUser(process.env.E2E_STAFF_EMAIL, process.env.E2E_STAFF_PASSWORD, "staff", "C1 Staff");
const contractorId = await ensureUser(
  process.env.E2E_CONTRACTOR_EMAIL, process.env.E2E_CONTRACTOR_PASSWORD, "contractor", "C1 Contractor");
await ensureUser(process.env.E2E_CUSTOMER_EMAIL, process.env.E2E_CUSTOMER_PASSWORD, "customer", "C1 Customer");

// A contractors row behind the contractor login, so offer/portal flows work.
if (contractorId) {
  const { data: existing } = await service.from("contractors").select("id").eq("profile_id", contractorId).maybeSingle();
  if (!existing) {
    const { error } = await service.from("contractors").insert({
      profile_id: contractorId, name: "C1 Contractor", company_name: "C1 Painting Co", active: true,
    });
    if (error) console.log(`~ contractors row: ${error.message} (fine if columns differ — fix forward)`);
    else console.log("+ contractors row created");
  } else console.log("= contractors row exists");
}

// One customers row, for specs that attach a customer to an estimate.
if (staffId) {
  const { data: anyCustomer } = await service.from("customers").select("id").limit(1).maybeSingle();
  if (!anyCustomer) {
    const { data: profile } = await service.from("profiles").select("id").eq("role", "customer").limit(1).maybeSingle();
    if (profile) {
      const { error } = await service.from("customers").insert({ profile_id: profile.id, name: "C1 Customer" });
      if (error) console.log(`~ customers row: ${error.message}`);
      else console.log("+ customers row created");
    }
  } else console.log("= customers row exists");
}

console.log("\nSeed complete.");

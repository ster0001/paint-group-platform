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
 * Reference data for the WO/invoicing suites (settings incl. invoicing keys,
 * the WO transition matrix, checklists) arrives via the migrations themselves.
 *
 * The WIZARD's reference data does NOT, and for a long time nothing here
 * noticed. F1-02 (audit 2026-08-28): CI ran e2e/customer-journey against this
 * project and batch-edits.spec.ts sat at a 3-minute timeout per test, because
 * room_type_defaults, room_type_scope_rules, measurement_units,
 * defect_prep_rates and sundries were all EMPTY and the `wizard_public`
 * setting was absent. The wizard cannot render a room without them, so the
 * specs waited for elements that were never coming.
 *
 * This project was stood up for the invoicing suite — run-e2e.sh still
 * defaults to stripe-live.spec.ts — so nobody had reason to notice. The two
 * steps below close it, and both DELEGATE to the existing single sources
 * rather than copying their data:
 *
 *   supabase/seed/ratecard_v7.sql          the rate card, sundries, products
 *   scripts/seed-extraction-settings.ts    room rules, units, wizard_public
 *
 * Idempotent — safe to re-run.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadTestEnv, refuseProduction } from "./env.mjs";

loadTestEnv();

/**
 * `C1_SEED_VERIFY_ONLY=1` runs the readback WITHOUT writing anything — "is the
 * test project ready?" as a question rather than an action.
 *
 * It also makes the readback testable. Without it the seed fixes the state and
 * then checks it, so the check can never fail and proves nothing — which is
 * how the first version of this readback passed while wizard_public was
 * {enabled:false}.
 */
const VERIFY_ONLY = process.env.C1_SEED_VERIFY_ONLY === "1";
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
      profile_id: contractorId, company_name: "C1 Painting Co", active: true,
    });
    if (error) console.log(`~ contractors row: ${error.message} (fine if columns differ — fix forward)`);
    else console.log("+ contractors row created");
  } else console.log("= contractors row exists");

  // Offerable = a valid insurance document (contractor_recompute_offerable).
  // Without one, send_offer refuses with error:not_offerable and every loop
  // suite dies at step 1 — same as the prod test contractor, which has one.
  const { data: crow } = await service.from("contractors").select("id, offerable").eq("profile_id", contractorId).maybeSingle();
  if (crow && !crow.offerable) {
    // The compliance trigger checks the path sits in the contractor's own
    // folder AND that a real object exists in contractor-docs — so upload one.
    const path = `${crow.id}/c1-insurance.pdf`;
    const pdf = Buffer.from("%PDF-1.4\n%c1 seed insurance placeholder\n%%EOF\n");
    const up = await service.storage.from("contractor-docs")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) console.log(`~ insurance upload: ${up.error.message}`);

    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: doc } = await service.from("contractor_documents")
      .select("id").eq("contractor_id", crow.id).eq("kind", "insurance").maybeSingle();
    // Phase F: offerable also needs verified_at — a human has seen the doc.
    const fields = { file_url: path, expires_on: future, verified_at: new Date().toISOString() };
    const write = doc
      ? service.from("contractor_documents").update(fields).eq("id", doc.id)
      : service.from("contractor_documents").insert({ contractor_id: crow.id, kind: "insurance", ...fields });
    const { error } = await write;
    if (error) console.log(`~ insurance doc: ${error.message}`);
    else {
      // Belt and braces: the docs trigger recomputes on row changes, but a
      // no-op update recomputes nothing — ask for it explicitly.
      const { error: rec } = await service.rpc("contractor_recompute_offerable", { p_cid: crow.id });
      if (rec) console.log(`~ recompute offerable: ${rec.message}`);
      const { data: after } = await service.from("contractors").select("offerable").eq("id", crow.id).single();
      console.log(after?.offerable
        ? "+ insurance doc in place (contractor now offerable)"
        : "~ contractor still not offerable — check contractor_documents");
    }
  } else if (crow) console.log("= contractor already offerable");
}

// A minimal ACTIVE rate card so anything that prices through lib/pricing (the
// revision builder, capture, proving) has real rows to price with. Prod's card
// arrives via seed scripts, not migrations, so a fresh test project has none.
{
  const { data: card } = await service.from("rate_cards").select("id").eq("is_active", true).maybeSingle();
  let cardId = card?.id ?? null;
  if (!cardId) {
    const { data, error } = await service.from("rate_cards")
      .insert({ version: 1, is_active: true }).select("id").single();
    if (error) console.log(`~ rate card: ${error.message}`);
    else { cardId = data.id; console.log("+ rate card created"); }
  } else console.log("= rate card exists");

  if (cardId) {
    const { count } = await service.from("rate_items").select("id", { count: "exact", head: true }).eq("rate_card_id", cardId);
    if (!count) {
      const { error } = await service.from("rate_items").insert([
        { rate_card_id: cardId, category: "Interior", code: "WALL", unit: "M2", sub_category: "Walls",
          rate_1_coat: 12, rate_2_coat: 8, rate_3_coat: 6, default_coats: 2,
          charge_out_cents: 8500, default_product: "C1 Wall Paint" },
        { rate_card_id: cardId, category: "Interior", code: "DOOR", unit: "Hours Per Item", sub_category: "Doors",
          rate_1_coat: 0.5, rate_2_coat: 0.8, rate_3_coat: 1.0, default_coats: 2,
          charge_out_cents: 8500, default_product: "C1 Enamel", litres_per_item_per_coat: 0.2 },
        { rate_card_id: cardId, category: "Exterior", code: "WEATHERBOARD", unit: "M2", sub_category: "Walls",
          rate_1_coat: 10, rate_2_coat: 7, rate_3_coat: 5, default_coats: 2,
          charge_out_cents: 10000, default_product: "C1 Exterior" },
      ]);
      console.log(error ? `~ rate items: ${error.message}` : "+ rate items seeded (3)");
    } else console.log("= rate items exist");
  }

  const { count: modCount } = await service.from("modifiers").select("id", { count: "exact", head: true });
  if (!modCount) {
    const { error } = await service.from("modifiers").insert([
      { group_name: "Level of Finish", label: "Level 3", code: "FIN-3", multiplier: 1, active: true },
      { group_name: "Level of Finish", label: "Level 4", code: "FIN-4", multiplier: 1.06, active: true },
    ]);
    console.log(error ? `~ modifiers: ${error.message}` : "+ modifiers seeded (2)");
  } else console.log("= modifiers exist");

  const { count: prodCount } = await service.from("products").select("id", { count: "exact", head: true });
  if (!prodCount) {
    const { error } = await service.from("products").insert([
      { name: "C1 Wall Paint", coverage: 14, price_per_litre: 2000, wastage_pct: 10 },
      { name: "C1 Enamel", coverage: 12, price_per_litre: 4000, wastage_pct: 0 },
      { name: "C1 Exterior", coverage: 12, price_per_litre: 2500, wastage_pct: 10 },
    ]);
    console.log(error ? `~ products: ${error.message}` : "+ products seeded (3)");
  } else console.log("= products exist");
}

// One customers row, for specs that attach a customer to an estimate.
if (staffId) {
  const { data: anyCustomer } = await service.from("customers").select("id").limit(1).maybeSingle();
  if (!anyCustomer) {
    const { data: profile } = await service.from("profiles").select("id").eq("role", "customer").limit(1).maybeSingle();
    if (profile) {
      const { error } = await service.from("customers").insert({ profile_id: profile.id });
      if (error) console.log(`~ customers row: ${error.message}`);
      else console.log("+ customers row created");
    }
  } else console.log("= customers row exists");
}

// ---------------------------------------------------------------------------
// The rate card (F1-02). Delegated to supabase/seed/ratecard_v7.sql, which is
// versioned and safe to re-run — it creates rate-card v7 only if absent and
// never edits an existing version.
// ---------------------------------------------------------------------------
async function seedRateCard() {
  const dbUrl = process.env.C1_DATABASE_URL;
  if (!dbUrl) { console.log("~ rate card: C1_DATABASE_URL missing, skipped"); return; }
  refuseProduction(dbUrl);
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select count(*)::int n from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.is_active");
    if (rows[0].n >= 40) { console.log(`= rate card loaded (${rows[0].n} active items)`); return; }
    await client.query(readFileSync(resolve(process.cwd(), "supabase/seed/ratecard_v7.sql"), "utf8"));
    const after = await client.query(
      "select count(*)::int n from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.is_active");
    console.log(`+ rate card v7 loaded (${after.rows[0].n} active items)`);
    // Two active cards would make pricing pick one arbitrarily. The stub this
    // script may have created earlier must stand down.
    const act = await client.query("select count(*)::int n from rate_cards where is_active");
    if (act.rows[0].n > 1) console.log(`~ WARNING: ${act.rows[0].n} active rate cards — pricing is ambiguous`);
  } finally { await client.end(); }
}
if (VERIFY_ONLY) console.log("~ verify-only: not seeding"); else await seedRateCard();

// ---------------------------------------------------------------------------
// The wizard's room rules, units and the wizard_public flag (F1-02).
// Delegated to scripts/seed-extraction-settings.ts so the rules live in ONE
// place — that file carries the evidence for each rule (which of the 11 real
// PaintScout jobs it came from), and duplicating it here would lose that.
// ---------------------------------------------------------------------------
function seedWizardReference() {
  if (!process.env.E2E_STAFF_EMAIL || !process.env.E2E_STAFF_PASSWORD) {
    console.log("~ wizard reference: no staff credentials, skipped");
    return;
  }
  try {
    const out = execFileSync("npx", ["tsx", "scripts/seed-extraction-settings.ts"], {
      env: {
        ...process.env,
        SEED_STAFF_EMAIL: process.env.E2E_STAFF_EMAIL,
        SEED_STAFF_PASSWORD: process.env.E2E_STAFF_PASSWORD,
      },
      encoding: "utf8",
    });
    const lines = out.trim().split("\n").filter((l) => /rows at version|seeded/.test(l));
    console.log("+ wizard reference seeded:");
    for (const l of lines) console.log(`    ${l.trim()}`);
  } catch (e) {
    console.log(`~ wizard reference failed: ${(e.stdout || e.message || "").toString().split("\n").slice(-3).join(" ")}`);
  }
}
if (!VERIFY_ONLY) seedWizardReference();

// ---------------------------------------------------------------------------
// The extraction seed writes the LAUNCH-SAFE defaults — wizard_public
// {enabled:false} and maxEstimatesPerVisitor 2 — which are right for
// production and wrong here. A test stack whose public wizard is off serves
// every customer-journey spec the holding page ("Online estimates are nearly
// here"), and they time out waiting for a wizard that will never render. The
// visitor cap matters too: the suite drives many journeys from one identity
// and would be refused after the second.
//
// This is the C1 project. Nothing here is customer-facing.
// ---------------------------------------------------------------------------
async function openTheWizard() {
  const pub = await service.from("settings")
    .upsert({ key: "wizard_public", value: { enabled: true } }, { onConflict: "key" });
  if (pub.error) { console.log(`~ wizard_public: ${pub.error.message}`); return; }

  const { data: lim } = await service.from("settings").select("value").eq("key", "wizard_limits").maybeSingle();
  const limits = { ...(lim?.value ?? {}), maxEstimatesPerVisitor: 500 };
  const l = await service.from("settings")
    .upsert({ key: "wizard_limits", value: limits }, { onConflict: "key" });
  console.log(l.error
    ? `~ wizard_limits: ${l.error.message}`
    : "+ wizard opened for testing (public ON, visitor cap 500)");
}
if (!VERIFY_ONLY) await openTheWizard();

// ---------------------------------------------------------------------------
// Readback. A seed that reports success without checking is how the wizard
// tables stayed empty through six build steps — the same lesson CLAUDE.md
// draws about migrations ("a migration running is not the same as its
// statements applying"). Name what is still missing.
// ---------------------------------------------------------------------------
async function readback() {
  const need = {
    room_type_defaults: 1, room_type_scope_rules: 1, measurement_units: 1,
    defect_prep_rates: 1, sundries: 1, modifiers: 1, products: 1,
  };
  const missing = [];
  for (const [table, min] of Object.entries(need)) {
    const { count } = await service.from(table).select("id", { count: "exact", head: true });
    if ((count ?? 0) < min) missing.push(`${table} (${count ?? 0})`);
  }
  // Presence is not the question — VALUE is. The first version of this check
  // asked only whether the key existed, and passed while wizard_public was
  // {enabled:false}, which serves every journey spec the holding page. A check
  // that verifies the wrong thing is worse than no check: it reports success.
  const { data: pub } = await service.from("settings").select("value").eq("key", "wizard_public").maybeSingle();
  if (!pub) missing.push("settings.wizard_public (absent)");
  else if (pub.value?.enabled !== true) missing.push(`settings.wizard_public (enabled=${pub.value?.enabled})`);

  const { data: lim } = await service.from("settings").select("value").eq("key", "wizard_limits").maybeSingle();
  const cap = lim?.value?.maxEstimatesPerVisitor;
  if (typeof cap === "number" && cap < 50) missing.push(`wizard_limits.maxEstimatesPerVisitor (${cap} — the suite needs headroom)`);

  // Anonymous sign-in is not a row, and checking only rows is how this readback
  // passed while the suite could not start. CLAUDE.md's testing law is "as an
  // ANONYMOUS customer" — if this is off, every customer-journey spec sits on a
  // disabled Continue button reading "Connecting…" until it times out.
  //
  // It is a project setting, not data: Supabase dashboard → Authentication →
  // Sign In / Providers → Anonymous sign-ins. No SQL can fix it, which is
  // exactly why it needs naming here rather than being discovered from a
  // three-minute timeout.
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: anonErr } = await anon.auth.signInAnonymously();
  if (anonErr) missing.push(`ANONYMOUS SIGN-IN is off (${anonErr.message}) — enable it in the Supabase dashboard, Authentication → Sign In / Providers`);

  if (missing.length === 0) {
    console.log("\nReadback: every table the wizard needs has rows, and anonymous sign-in works ✅");
  } else {
    console.log(`\nReadback: NOT READY —\n  - ${missing.join("\n  - ")}`);
    console.log("e2e/customer-journey will TIME OUT against this project, not fail fast.");
    process.exitCode = 1;
  }
}
await readback();

console.log("\nSeed complete.");

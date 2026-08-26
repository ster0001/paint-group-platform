/**
 * 3a-1 · Backfill the account chain onto existing estimates and invoices.
 *
 * DRY RUN by default: reports what it would create and STOPS — nothing is
 * written until it is re-run with --apply after Tom confirms the buckets
 * (the audit's report-and-confirm rule).
 *
 *   npx node scripts/portal/backfill-accounts.mjs           # report only
 *   npx node scripts/portal/backfill-accounts.mjs --apply   # write links
 *
 * Sources of contact truth, in order:
 *   1. wizard_leads.email      (customer-wizard estimates — 100% coverage)
 *   2. builder_state.contact   (staff-created estimates — the Contact card)
 * Estimates with neither are reported as unreachable, never guessed.
 *
 * Test-looking emails (our pg.* test logins, @example.com) are bucketed
 * separately and NOT applied — they are S7 debris, not customers.
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const URL0 = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL0 || !KEY) { console.error("Missing Supabase env in .env.local"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function get(path) {
  const r = await fetch(`${URL0}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function write(method, path, body) {
  const r = await fetch(`${URL0}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Same rules as lib/accounts/identity.ts — kept dependency-free for a plain
// .mjs script; the unit tests pin the TS versions, this mirrors them.
const normEmail = (s) => (s ?? "").trim().toLowerCase();
const addressKey = ({ street, suburb, postcode }) => {
  const st = (street ?? "").trim();
  if (!st) return null;
  const key = [st, suburb ?? "", postcode ?? ""].join(" ")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return key || null;
};
const isTestEmail = (e) =>
  /@example\.com$/.test(e) || /^pg\./.test(e) || /e2e|playwright|\+test/.test(e);

// ---- gather ----------------------------------------------------------------
const probe = await fetch(`${URL0}/rest/v1/accounts?select=id&limit=1`, { headers: H });
if (!probe.ok) {
  console.error("accounts table not reachable — run migration 20261128000000_customer_accounts.sql first.");
  process.exit(1);
}

const estimates = await get("estimates?select=id,title,status,account_id,property_id,builder_state,created_at&order=created_at.asc&limit=2000");
const leads = await get("wizard_leads?select=estimate_id,email&estimate_id=not.is.null&order=created_at.asc&limit=3000");
const leadEmail = new Map();
for (const l of leads) if (l.email && !leadEmail.has(l.estimate_id)) leadEmail.set(l.estimate_id, normEmail(l.email));

const plan = []; // {estimateId, email, name, phone, address, source}
const buckets = { already_linked: 0, wizard_lead: 0, staff_contact: 0, test_debris: [], unreachable: [] };

for (const e of estimates) {
  if (e.account_id) { buckets.already_linked++; continue; }
  const contact = e.builder_state?.contact ?? {};
  const jobAddr = e.builder_state?.jobAddress ?? {};
  const address = { street: jobAddr.address, suburb: jobAddr.city, postcode: jobAddr.postal, state: jobAddr.state };
  const fromLead = leadEmail.get(e.id);
  const fromContact = typeof contact.email === "string" && contact.email.includes("@") ? normEmail(contact.email) : null;
  const email = fromLead ?? fromContact;
  if (!email) { buckets.unreachable.push({ id: e.id, title: e.title, status: e.status }); continue; }
  if (isTestEmail(email)) { buckets.test_debris.push({ id: e.id, email }); continue; }
  buckets[fromLead ? "wizard_lead" : "staff_contact"]++;
  plan.push({
    estimateId: e.id, email, source: fromLead ? "wizard_lead" : "staff_contact",
    name: typeof contact.name === "string" && contact.name.trim() ? contact.name.trim() : null,
    phone: typeof contact.phone === "string" && contact.phone.trim() ? contact.phone.trim() : null,
    address,
  });
}

const distinctEmails = new Set(plan.map((p) => p.email));
console.log("=== 3a-1 account backfill —", APPLY ? "APPLY" : "DRY RUN (report only)", "===");
console.log({
  estimates_total: estimates.length,
  already_linked: buckets.already_linked,
  linkable_via_wizard_lead: buckets.wizard_lead,
  linkable_via_staff_contact: buckets.staff_contact,
  accounts_that_would_exist: distinctEmails.size,
  test_debris_skipped: buckets.test_debris.length,
  unreachable_no_contact: buckets.unreachable.length,
});
if (buckets.unreachable.length) {
  console.log("\nUnreachable (no lead, no contact) — left unlinked, listed for Tom:");
  for (const u of buckets.unreachable) console.log(`  ${u.id}  [${u.status}]  ${u.title}`);
}

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply after confirming the buckets.");
  process.exit(0);
}

// ---- apply -----------------------------------------------------------------
let accountsCreated = 0, propertiesCreated = 0, estimatesLinked = 0;
const accountByEmail = new Map();
for (const row of await get("accounts?select=id,email&limit=5000")) accountByEmail.set(normEmail(row.email), row.id);

for (const p of plan) {
  let accountId = accountByEmail.get(p.email);
  if (!accountId) {
    const [row] = await write("POST", "accounts", { email: p.email, name: p.name, phone: p.phone });
    accountId = row.id;
    accountByEmail.set(p.email, accountId);
    accountsCreated++;
  }
  let propertyId = null;
  const key = addressKey(p.address);
  if (key) {
    const existing = await get(`properties?select=id&account_id=eq.${accountId}&address_norm=eq.${encodeURIComponent(key)}`);
    if (existing.length) propertyId = existing[0].id;
    else {
      const [row] = await write("POST", "properties", {
        account_id: accountId, address: p.address.street ?? null, suburb: p.address.suburb ?? null,
        state: p.address.state ?? null, postcode: p.address.postcode ?? null, address_norm: key,
      });
      propertyId = row.id;
      propertiesCreated++;
    }
  }
  await write("PATCH", `estimates?id=eq.${p.estimateId}`, { account_id: accountId, property_id: propertyId });
  estimatesLinked++;
}

// Invoices inherit from their (now linked) estimates.
const invoices = await get("invoices?select=id,estimate_id,account_id&account_id=is.null&estimate_id=not.is.null");
let invoicesLinked = 0;
for (const inv of invoices) {
  const est = estimates.find((e) => e.id === inv.estimate_id);
  const accountId = est?.account_id ?? accountByEmail.get(plan.find((p) => p.estimateId === inv.estimate_id)?.email ?? "");
  if (!accountId) continue;
  await write("PATCH", `invoices?id=eq.${inv.id}`, { account_id: accountId });
  invoicesLinked++;
}

console.log("\nApplied:", { accountsCreated, propertiesCreated, estimatesLinked, invoicesLinked });
console.log("Re-run without --apply to verify the report shows everything linked.");

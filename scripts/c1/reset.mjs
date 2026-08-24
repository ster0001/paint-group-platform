/**
 * C1 · documented reset — wipe the test project's BUSINESS data back to a
 * clean slate while keeping schema, settings, reference data and the seeded
 * logins. This is the "documented reset" the audit asked for, and it is the
 * reason money e2e can be fearless here.
 *
 *   node scripts/c1/reset.mjs
 *
 * Order matters (RESTRICT FKs): invoices before estimates; children before
 * parents. Storage: the invoice-docs bucket is emptied per invoice folder.
 * PRODUCTION IS REFUSED by the env tripwire, and the service key comes from
 * .env.test.local only.
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
const s = createClient(url, key, { auth: { persistSession: false } });

// Children → parents. A table that doesn't exist yet is skipped quietly so
// the reset works at every point of the buildout.
const TABLES = [
  "invoice_events", "invoice_lines", "credit_notes", "payments", "stripe_events",
  "contractor_invoices", "job_costs", "material_costs",
  "invoices",
  "wo_events", "wo_qa_items", "wo_qa_checks", "wo_checklist_items", "wo_updates",
  "wo_photos", "wo_variations", "wo_surfaces", "wo_walkthroughs", "wo_signoff",
  "warranties", "booking_offers", "work_orders",
  "follow_ups", "estimate_events", "estimate_sources", "wizard_leads",
  "estimates",
  "contractor_events", "time_logs", "cost_lines", "job_assignments", "jobs",
];

// Empty the invoice-docs bucket first (paths are <invoiceId>/<file>).
const { data: invRows } = await s.from("invoices").select("id").limit(1000);
for (const r of invRows ?? []) {
  const { data: files } = await s.storage.from("invoice-docs").list(r.id);
  if (files?.length) {
    await s.storage.from("invoice-docs").remove(files.map((f) => `${r.id}/${f.name}`));
  }
}

for (const t of TABLES) {
  const { error, count } = await s.from(t).delete({ count: "exact" }).not("id", "is", null);
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) {
      console.log(`- ${t}: not present (skipped)`);
    } else {
      console.error(`✗ ${t}: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(`✓ ${t}: ${count ?? 0} rows deleted`);
  }
}

console.log("\nReset complete — schema, settings, reference data and logins untouched.");

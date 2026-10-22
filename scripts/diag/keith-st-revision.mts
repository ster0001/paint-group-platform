/**
 * Read-only: price 43 Keith St's accepted scope and working scope with the SAME engine the
 * revision builder uses, and compare to the ledger (accepted + approved variations) that the
 * deposit invoice was cut from. Run from the main checkout's env (IMPORT_DATABASE_URL is
 * read-only; the supabase client here only selects).
 */
import { createClient } from "@supabase/supabase-js";
import { diffRevision, sumDeltas, type RevisionState } from "../../lib/revision/diff";
import { loadPricingContext } from "../../lib/pricing/context";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EST = process.argv[2] ?? "268e0cf5-cdca-4dbe-bdb0-a3193b65c7f8";
const db = createClient(url, key, { auth: { persistSession: false } });
// wo_open_working_scope is staff-gated (no JWT under the service key): read the same row it reads.
const { data: scope, error } = await db.from("wo_working_scopes").select("accepted_state, working_state").eq("estimate_id", EST).single();
if (error) throw new Error(error.message);
const s = scope as { accepted_state?: RevisionState; working_state?: RevisionState };
const ctx = await loadPricingContext(db);
const diff = diffRevision(s.accepted_state!, s.working_state!, ctx);
console.log("accepted inc:", diff.acceptedIncCents, " working inc:", diff.workingIncCents, " sum of deltas:", sumDeltas(diff), " working - accepted:", diff.workingIncCents - diff.acceptedIncCents);
for (const c of diff.changes) console.log("  change", c.blockRef, c.title, c.deltaIncCents, c.detail ?? "");
const { data: est } = await db.from("estimates").select("accepted_total_cents, total_cents").eq("id", EST).single();
const { data: vars } = await db.from("wo_variations").select("status, price_cents, credit, revision_block_ref").eq("work_order_id", (await db.from("work_orders").select("id").eq("estimate_id", EST).single()).data!.id);
console.log("estimate accepted_total_cents:", est?.accepted_total_cents, "total_cents:", est?.total_cents);
console.log("variations:", vars);

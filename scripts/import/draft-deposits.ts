/**
 * Draft deposit invoices for the jobs the import and the handover accepted
 * without one (Tom, 17 Sep 2026: "list them all as draft deposits").
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/import/draft-deposits.ts check [--import-name a,b]
 *   npx tsx scripts/import/draft-deposits.ts run   [--import-name a,b]
 *
 * Targets every accepted estimate the named imports created (crm_import_keys;
 * default: the 35 signed jobs + the Zap handover). `check` lists what would
 * be drafted; `run` calls invoice_draft_deposit once per estimate — the RPC
 * is the one implementation and answers 'exists' on a second run.
 * Production needs IMPORT_ALLOW_PRODUCTION=1 (scripts/import/target.ts).
 */
import { createClient } from "@supabase/supabase-js";
import { IMPORT_NAME } from "../../lib/import/booked/build";
import { depositPctFromSettings } from "../../lib/invoicing/settings";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cmd = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const importNames = (flag("--import-name") ?? `${IMPORT_NAME},airtable-handover`).split(",").map((s) => s.trim()).filter(Boolean);

function usage(): never {
  console.error("usage: draft-deposits.ts check|run [--import-name a,b]");
  process.exit(1);
}

type Row = { id: string; status: string; accepted_total_cents: number | null; total_cents: number; external_ref: { quote_no?: string } | null; title: string | null; sent_snapshot: { depositPct?: number } | null };

async function main() {
  if (cmd !== "check" && cmd !== "run") usage();
  const target = resolveImportTarget("draft-deposits.ts", { needsDatabase: false });
  const db = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: keys, error: kErr } = await db.from("crm_import_keys").select("row_id").eq("table_name", "estimates").in("import", importNames);
  if (kErr) throw new Error(`crm_import_keys: ${kErr.message}`);
  const ids = [...new Set((keys ?? []).map((k) => k.row_id as string))];
  if (ids.length === 0) { console.log(`no estimates for imports ${importNames.join(", ")}`); return; }

  const { data: ests, error: eErr } = await db.from("estimates").select("id, status, accepted_total_cents, total_cents, external_ref, title, sent_snapshot").in("id", ids);
  if (eErr) throw new Error(`estimates: ${eErr.message}`);
  const { data: existing, error: iErr } = await db.from("invoices").select("estimate_id, status, total_inc_cents").in("estimate_id", ids).eq("kind", "deposit");
  if (iErr) throw new Error(`invoices: ${iErr.message}`);
  const has = new Map((existing ?? []).map((i) => [i.estimate_id as string, i]));
  const { data: settings, error: sErr } = await db.from("settings").select("key, value").eq("key", "invoicing");
  if (sErr) throw new Error(`settings: ${sErr.message}`);
  // The same rule as the RPC (and as an online acceptance): the document's own
  // deposit % — the import writes 50 (brief B1.4) — else the settings default.
  const settingPct = depositPctFromSettings(settings);
  const pctOf = (e: Row) => (typeof e.sent_snapshot?.depositPct === "number" ? e.sent_snapshot.depositPct : settingPct);

  const rows = ((ests ?? []) as Row[]).sort((a, b) => String(a.external_ref?.quote_no ?? "").localeCompare(String(b.external_ref?.quote_no ?? "")));
  let toDraft = 0; let sum = 0;
  for (const e of rows) {
    const quote = e.external_ref?.quote_no ?? "?";
    const total = e.accepted_total_cents ?? e.total_cents;
    const dep = has.get(e.id);
    const pct = pctOf(e);
    const line = dep ? `exists (${dep.status}, $${(dep.total_inc_cents / 100).toFixed(2)})`
      : e.status !== "accepted" ? `skip (${e.status})`
      : `draft ${pct}% = $${(Math.round(total * pct / 100) / 100).toFixed(2)} of $${(total / 100).toFixed(2)}`;
    if (!dep && e.status === "accepted") { toDraft++; sum += Math.round(total * pct / 100); }
    console.log(`${String(quote).padEnd(6)} ${(e.title ?? "").slice(0, 40).padEnd(42)} ${line}`);
  }
  console.log(`\n${rows.length} estimates · ${toDraft} to draft · $${(sum / 100).toFixed(2)} in draft deposits · ${has.size} already have one`);
  if (cmd === "check") return;

  const counts: Record<string, number> = {};
  for (const e of rows) {
    const { data, error } = await db.rpc("invoice_draft_deposit", { p_estimate_id: e.id, p_auto: "import" });
    if (error) throw new Error(`invoice_draft_deposit ${e.id}: ${error.message}`);
    const r = String(data);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  console.log(`done: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

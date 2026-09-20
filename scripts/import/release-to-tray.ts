/**
 * Release the imported booked jobs to the tray (Tom, 20 Sep 2026: an imported
 * job has NOT been booked — no contractor, no date, no offer — so it belongs
 * at stage 'offered', where the tray, the console's "Accepted, still not
 * booked in" card and the dashboard's Jobs-to-schedule tile all look).
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/import/release-to-tray.ts check [--import-name a,b]
 *   npx tsx scripts/import/release-to-tray.ts run   [--import-name a,b]
 *
 * Targets every work order the named imports created (crm_import_keys;
 * default: the 35 signed jobs + the Zap handover). `check` lists each one
 * with what `run` would do to it; `run` calls import_release_to_tray once
 * per row — the RPC (migration 20270185) is the one implementation: it moves
 * pre_start → offered through wo_set_stage and skips anything already moved
 * on or booked by hand since the import (a contractor, a date or a live
 * offer). A second run answers 'skip:offered' for every row.
 * Production needs IMPORT_ALLOW_PRODUCTION=1 (scripts/import/target.ts).
 */
import { createClient } from "@supabase/supabase-js";
import { IMPORT_NAME } from "../../lib/import/booked/build";
import { LIVE_OFFER_STATES, planRelease } from "../../lib/import/booked/release";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cmd = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const importNames = (flag("--import-name") ?? `${IMPORT_NAME},airtable-handover`).split(",").map((s) => s.trim()).filter(Boolean);

function usage(): never {
  console.error("usage: release-to-tray.ts check|run [--import-name a,b]");
  process.exit(1);
}

type Row = { id: string; wo_ref: string | null; stage: string; contractor_id: string | null; start_date: string | null; wo_snapshot: { jobTitle?: string } | null };

async function main() {
  if (cmd !== "check" && cmd !== "run") usage();
  const target = resolveImportTarget("release-to-tray.ts", { needsDatabase: false });
  const db = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: keys, error: kErr } = await db.from("crm_import_keys").select("row_id").eq("table_name", "work_orders").in("import", importNames);
  if (kErr) throw new Error(`crm_import_keys: ${kErr.message}`);
  const ids = [...new Set((keys ?? []).map((k) => k.row_id as string))];
  if (ids.length === 0) { console.log(`no work orders for imports ${importNames.join(", ")}`); return; }

  const { data: wos, error: wErr } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, start_date, wo_snapshot").in("id", ids);
  if (wErr) throw new Error(`work_orders: ${wErr.message}`);
  const { data: offers, error: oErr } = await db.from("booking_offers").select("work_order_id, state").in("work_order_id", ids).in("state", [...LIVE_OFFER_STATES]);
  if (oErr) throw new Error(`booking_offers: ${oErr.message}`);
  const liveOffer = new Map<string, string>();
  for (const o of offers ?? []) liveOffer.set(o.work_order_id as string, o.state as string);

  const rows = ((wos ?? []) as Row[]).sort((a, b) => String(a.wo_ref ?? "").localeCompare(String(b.wo_ref ?? "")));
  const plans = new Map<string, string>();
  for (const w of rows) {
    const offer = liveOffer.get(w.id);
    const plan = planRelease({ stage: w.stage, contractor_id: w.contractor_id, start_date: w.start_date, hasLiveOffer: offer !== undefined });
    plans.set(w.id, plan);
    const facts = [w.stage, w.contractor_id ? "contractor" : "no contractor", w.start_date ?? "no date", offer ? `offer ${offer}` : "no offer"].join(" · ");
    console.log(`${String(w.wo_ref ?? "?").padEnd(8)} ${(w.wo_snapshot?.jobTitle ?? "").slice(0, 40).padEnd(42)} ${facts.padEnd(52)} ${plan === "release" ? "release → offered" : plan}`);
  }
  const toRelease = [...plans.values()].filter((p) => p === "release").length;
  console.log(`\n${rows.length} imported work orders · ${toRelease} to release to the tray · ${rows.length - toRelease} left as they are`);
  if (cmd === "check") return;

  const counts: Record<string, number> = {};
  for (const w of rows) {
    const { data, error } = await db.rpc("import_release_to_tray", { p_work_order_id: w.id });
    if (error) throw new Error(`import_release_to_tray ${w.wo_ref ?? w.id}: ${error.message}`);
    const r = String(data);
    counts[r] = (counts[r] ?? 0) + 1;
    console.log(`${String(w.wo_ref ?? "?").padEnd(8)} ${r}`);
  }
  console.log(`done: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

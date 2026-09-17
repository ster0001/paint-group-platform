/**
 * Part B · the 35 already-signed jobs → accepted estimates with a working
 * scope, in the Unscheduled tray, with nobody emailed.
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/import/paintscout-booked.ts check  docs/imports/airtable-crm-import/booked
 *   npx tsx scripts/import/paintscout-booked.ts import docs/imports/airtable-crm-import/booked
 *   npx tsx scripts/import/paintscout-booked.ts purge  [--import-name paintscout-booked]
 *
 * `check` builds every job and proves each total to the cent without writing.
 * `import` does the same, REFUSES the whole run if any job fails, then writes
 * through lib/import/booked/write.ts (one path, shared with the handover
 * door). Idempotent: a second run answers "exists" 35 times and changes
 * nothing. `purge` removes what an import created, by its key map — for the
 * test project and the e2e run, never something to reach for on production
 * without a reason.
 *
 * Production needs IMPORT_ALLOW_PRODUCTION=1 (scripts/import/target.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv } from "../../lib/import/csv";
import { IMPORT_NAME, SubstrateResolver } from "../../lib/import/booked/build";
import { loadBookedWriteContext, writeBookedJob, type BookedWriteResult } from "../../lib/import/booked/write";
import { parseBookedJobs, substrateMapRowSchema, type BookedJob } from "../../lib/import/booked/types";
import { buildBookedJob } from "../../lib/import/booked/build";
import { refreshAccountFacts } from "../../lib/crm/facts";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const [cmd, dirArg] = positional;
const importName = flag("--import-name") ?? IMPORT_NAME;

function usage(): never {
  console.error("usage: paintscout-booked.ts check <dir> | import <dir> [--import-name x] | purge [--import-name x]");
  process.exit(1);
}

function loadPack(dir: string): { jobs: BookedJob[]; resolver: () => SubstrateResolver } {
  const jobsPath = resolve(dir, "booked_jobs.json");
  const mapPath = resolve(dir, "booked_substrate_map.csv");
  if (!existsSync(jobsPath) || !existsSync(mapPath)) {
    console.error(`REFUSED: ${dir} needs booked_jobs.json and booked_substrate_map.csv`);
    process.exit(1);
  }
  const jobs = parseBookedJobs(JSON.parse(readFileSync(jobsPath, "utf8")));
  const rows = parseCsv(readFileSync(mapPath, "utf8")).map((r) => substrateMapRowSchema.parse(r));
  return { jobs, resolver: () => new SubstrateResolver(rows) };
}

async function main() {
  if (!cmd) usage();
  const target = resolveImportTarget("paintscout-booked.ts", { needsDatabase: false });
  const db = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  if (cmd === "purge") {
    const { data: keys, error } = await db.from("crm_import_keys").select("key, table_name, row_id").eq("import", importName);
    if (error) throw new Error(error.message);
    const byTable = (t: string) => (keys ?? []).filter((k) => k.table_name === t).map((k) => k.row_id as string);
    const estimates = byTable("estimates");
    const accounts = byTable("accounts");
    // The chain hangs off the estimate: invoices (none), work order + its notes
    // (cascade), the working scope (cascade), then the estimate, its events,
    // and finally the accounts and properties this import created.
    for (const id of estimates) {
      await db.from("invoices").delete().eq("estimate_id", id);
      await db.from("crm_events").delete().eq("estimate_id", id);
      const { error: e1 } = await db.from("estimates").delete().eq("id", id);
      if (e1) throw new Error(`estimate ${id}: ${e1.message}`);
    }
    if (accounts.length) {
      await db.from("crm_events").delete().in("account_id", accounts);
      await db.from("properties").delete().in("account_id", accounts);
      const { error: e2 } = await db.from("accounts").delete().in("id", accounts);
      if (e2) throw new Error(`accounts: ${e2.message}`);
    }
    await db.from("crm_import_keys").delete().eq("import", importName);
    console.log(`purged ${importName}: ${estimates.length} estimates (+ work orders), ${accounts.length} accounts`);
    return;
  }

  if (cmd !== "check" && cmd !== "import") usage();
  if (!dirArg) usage();
  const { jobs, resolver } = loadPack(dirArg);
  const wctx = await loadBookedWriteContext(db);

  // Every job must build and prove before ANY job is written.
  const preflight = resolver();
  let sumTotal = 0; let sumHours = 0; let areas = 0; let lines = 0; let custom = 0;
  const notes: string[] = [];
  for (const job of jobs) {
    const b = buildBookedJob(job, preflight, wctx.pricing, wctx.company, "preflight00000000");
    sumTotal += b.totals.totalCents; sumHours += b.totals.hours; areas += b.counts.areas; lines += b.counts.lines; custom += b.counts.customLines;
    notes.push(...b.roundingNotes);
  }
  if (preflight.unconsumed() > 0) throw new Error(`${preflight.unconsumed()} substrate-map rows matched no line — the map and the pack disagree`);
  console.log(`preflight: ${jobs.length} jobs build and prove · $${(sumTotal / 100).toFixed(2)} inc GST · ${Math.round(sumHours * 100) / 100} h · ${areas} areas · ${lines} lines (${custom} on the custom row)`);
  for (const n of notes) console.log(`  rounding: ${n}`);
  if (cmd === "check") return;

  const results: BookedWriteResult[] = [];
  const live = resolver();
  for (const job of jobs) {
    const r = await writeBookedJob(db, job, live, wctx, { importName });
    results.push(r);
    console.log(`${r.status.padEnd(12)} ${r.quoteNo.padEnd(5)} $${(r.totals.totalCents / 100).toFixed(2).padStart(10)}  ${r.totals.hours} h${r.accountCreated ? "  (new customer)" : ""}`);
  }
  const accountIds = [...new Set(results.map((r) => r.accountId))];
  const refreshed = await refreshAccountFacts(db, accountIds);
  const counts = results.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  console.log(`done: ${JSON.stringify(counts)} · facts refreshed for ${refreshed} customers`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

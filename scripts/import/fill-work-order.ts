/**
 * Part C · fill a handover job's scope from its PaintScout work order.
 *
 * A job the Airtable Zap delivered has the quote's area prices and no lines
 * ("Hours to confirm" on its strip and on Today). This reads the PaintScout
 * work-order share page, joins its lines and hours to the signed prices
 * (lib/import/booked/fill.ts), proves the total to the cent with the same
 * build the pack import used, and writes the new scope, sheet and tick list
 * through `import_booked_job_set_scope` (migration 20270187).
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/import/fill-work-order.ts parse <url|file> …            # the page → areas and hours, no database
 *   npx tsx scripts/import/fill-work-order.ts check <url|file> …            # + the estimate: the join, the proof, nothing written
 *   npx tsx scripts/import/fill-work-order.ts run   <url|file> …            # writes; twice is once (a filled job is skipped)
 *     --save-dir <dir>      keep each page's text as <dir>/<quote>.txt (re-runnable from the file, no page load)
 *     --name-map <json>     line name → rate code (default docs/imports/substrate-name-map.json)
 *     --refill              also rewrite a job whose hours were already filled (still refused once it is worked)
 *
 * A URL is loaded headless (Playwright's Chromium — the share page is
 * client-rendered and its API resists replay); a file is the page's text as
 * a browser copied it. Production needs IMPORT_ALLOW_PRODUCTION=1
 * (scripts/import/target.ts). Refuses the whole job when the page's Total
 * Hours banner disagrees with its lines, or the engine cannot reproduce the
 * signed total — the point of the exercise is hours a painter can trust.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildBookedJob, SubstrateResolver } from "../../lib/import/booked/build";
import { jobFromWorkOrder, type ExistingImportedJob } from "../../lib/import/booked/fill";
import { parseWorkOrderText, type ParsedWorkOrder } from "../../lib/import/booked/workorder-text";
import { loadBookedWriteContext } from "../../lib/import/booked/write";
import { seedRowsFromDoc } from "../../lib/workorder/surfaces";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(name);
const VALUE_FLAGS = new Set(["--save-dir", "--name-map"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
const [cmd, ...sources] = positional;
const IMPORTS = ["paintscout-booked", "airtable-handover"];
/** docs/imports/substrate-name-map.json — the pack's line name → rate code map (no customer in it). */
const nameMapSchema = z.array(z.object({ paintscout_item: z.string(), side: z.enum(["interior", "exterior"]), platform_rate_code: z.string() }));

function usage(): never {
  console.error("usage: fill-work-order.ts parse|check|run <url|file> … [--save-dir d] [--name-map json] [--refill]");
  process.exit(1);
}

async function pageText(source: string, saveDir: string | undefined): Promise<{ text: string; url: string }> {
  if (!/^https?:\/\//i.test(source)) {
    if (!existsSync(source)) throw new Error(`${source}: no such file`);
    return { text: readFileSync(source, "utf8"), url: "" };
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(source, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(() => /Total Hours|Work Order/i.test(document.body.innerText) && document.body.innerText.length > 500, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    const text = await page.evaluate(() => document.body.innerText);
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      const quote = parseWorkOrderText(text).quoteNo ?? `page-${Date.now()}`;
      writeFileSync(resolve(saveDir, `${quote}.txt`), text);
    }
    return { text, url: source };
  } finally {
    await browser.close();
  }
}

function describe(wo: ParsedWorkOrder): string {
  const out: string[] = [];
  out.push(`quote ${wo.quoteNo ?? "?"} · Total Hours ${wo.totalHours ?? "(no banner)"} · lines add to ${wo.hoursFromLines} h · ${wo.areas.length} areas`);
  for (const m of wo.materials) out.push(`  material  ${m.product}  ${m.litres ?? "?"} L`);
  for (const a of wo.areas) {
    const dims = a.length_m != null ? ` (${[a.length_m, a.width_m, a.height_m].filter((n) => n != null).join("×")} m)` : "";
    const split = a.hours_total != null ? `  prep ${a.hours_prep ?? 0} + painting ${a.hours_paint ?? 0} = ${a.hours_total} h` : "  (no hours)";
    out.push(`  ${a.name}${dims}${split}`);
    for (const it of a.items) {
      const q = it.qty != null ? ` ${it.qty}${it.unit === "m2" ? " m²" : it.unit === "m" ? " m" : ""}` : "";
      out.push(`      ${it.item}${q} · ${it.coats ?? "?"} coat${it.coats === 1 ? "" : "s"} · ${it.hours ?? "?"} h${it.product ? ` · ${it.product}` : ""}`);
    }
  }
  if (wo.optionHeadings.length) out.push(`  options not taken: ${wo.optionHeadings.join("; ")}`);
  return out.join("\n");
}

type Row = ExistingImportedJob & { estimateId: string; workOrderId: string; accountId: string | null; shareToken: string; stage: string; hoursPending: boolean };

async function loadExisting(db: SupabaseClient, quoteNo: string): Promise<Row | null> {
  const { data: key, error: keyErr } = await db.from("crm_import_keys").select("row_id, import").eq("table_name", "estimates").eq("key", `bk_${quoteNo}`).in("import", IMPORTS).limit(1).maybeSingle();
  if (keyErr) throw new Error(`crm_import_keys: ${keyErr.message}`);
  if (!key) return null;
  const { data: e, error: eErr } = await db.from("estimates")
    .select("id, title, status, source, external_ref, builder_state, subtotal_cents, total_cents, level_of_finish, accepted_at, accepted_name, share_token, account_id")
    .eq("id", key.row_id as string).maybeSingle();
  if (eErr) throw new Error(`estimates: ${eErr.message}`);
  if (!e) return null;
  const { data: wo, error: woErr } = await db.from("work_orders").select("id, stage, contractor_payment_cents").eq("estimate_id", e.id as string).maybeSingle();
  if (woErr) throw new Error(`work_orders: ${woErr.message}`);
  if (!wo) throw new Error(`quote ${quoteNo}: the estimate has no work order`);
  const ref = (e.external_ref ?? {}) as Record<string, unknown>;
  return {
    quoteNo, estimateId: e.id as string, workOrderId: wo.id as string, accountId: (e.account_id as string | null) ?? null, shareToken: (e.share_token as string) ?? "", stage: wo.stage as string,
    hoursPending: ref.hours_pending === true,
    title: (e.title as string) ?? "", levelOfFinish: Number(e.level_of_finish ?? 3),
    subtotalCents: Number(e.subtotal_cents), totalCents: Number(e.total_cents),
    acceptedAt: (e.accepted_at as string) ?? new Date().toISOString(), acceptedName: (e.accepted_name as string) ?? "",
    contractorPaymentCents: (wo.contractor_payment_cents as number | null) ?? null,
    builderState: e.builder_state, externalRef: ref,
  };
}

async function main() {
  if (!cmd || !["parse", "check", "run"].includes(cmd) || sources.length === 0) usage();
  const saveDir = flag("--save-dir");

  const pages: Array<{ source: string; url: string; wo: ParsedWorkOrder }> = [];
  for (const s of sources) {
    const { text, url } = await pageText(s, saveDir);
    const wo = parseWorkOrderText(text);
    pages.push({ source: s, url, wo });
    console.log(`\n${s}\n${describe(wo)}`);
  }
  if (cmd === "parse") return;

  const target = resolveImportTarget("fill-work-order.ts", { needsDatabase: false });
  const db = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const mapPath = flag("--name-map") ?? resolve(process.cwd(), "docs/imports/substrate-name-map.json");
  if (!existsSync(mapPath)) throw new Error(`name map ${mapPath} is missing`);
  const nameMap = nameMapSchema.parse(JSON.parse(readFileSync(mapPath, "utf8")));
  const wctx = await loadBookedWriteContext(db);

  // Every page must join and prove before ANY job is written.
  const plans: Array<{ row: Row; built: ReturnType<typeof buildBookedJob>; hours: number }> = [];
  const refusals: string[] = [];
  let skipped = 0;
  for (const { source, url, wo } of pages) {
    if (!wo.quoteNo) { refusals.push(`${source}: the page shows no Estimate ID`); continue; }
    const row = await loadExisting(db, wo.quoteNo);
    if (!row) { refusals.push(`quote ${wo.quoteNo}: no imported estimate on this project (crm_import_keys bk_${wo.quoteNo}) — the handover never arrived, or it is not an import`); continue; }
    console.log(`\nquote ${wo.quoteNo} → ${row.title} · estimate ${row.estimateId} · work order ${row.workOrderId} · stage ${row.stage} · hours ${row.hoursPending ? "PENDING" : "already filled"}`);
    if (!row.hoursPending && !has("--refill")) { console.log(`  skip:filled — the hours are already in; pass --refill to rewrite the scope (refused once the job is worked)`); skipped++; continue; }
    const joined = jobFromWorkOrder(row, wo, { workOrderUrl: url || undefined });
    for (const m of joined.mapping) console.log(`  ${m}`);
    for (const w of joined.warnings) console.log(`  ⚠ ${w}`);
    if (joined.hoursDisagree) { refusals.push(`quote ${wo.quoteNo}: the page's Total Hours and its lines disagree — read the page before trusting either`); continue; }
    try {
      const built = buildBookedJob(joined.job, new SubstrateResolver([], nameMap), wctx.pricing, wctx.company, row.shareToken || "preflight00000000");
      console.log(`  proves: $${(built.totals.totalCents / 100).toFixed(2)} inc GST · ${built.totals.hours} h · ${built.counts.areas} areas · ${built.counts.lines} lines (${built.counts.customLines} on the custom row)`);
      for (const n of built.roundingNotes) console.log(`  rounding: ${n}`);
      plans.push({ row, built, hours: built.totals.hours });
    } catch (e) {
      refusals.push(`quote ${wo.quoteNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (refusals.length) {
    console.error(`\nREFUSED — nothing written:\n  ${refusals.join("\n  ")}`);
    process.exit(2);
  }
  if (cmd === "check") { console.log(`\ncheck: ${plans.length} job${plans.length === 1 ? "" : "s"} join and prove, ${skipped} already filled; nothing written`); return; }

  for (const { row, built, hours } of plans) {
    const payload = {
      estimate_id: row.estimateId, quote_no: row.quoteNo,
      subtotal_cents: built.totals.subtotalCents, total_cents: built.totals.totalCents, hours,
      builder_state: built.builderState, sent_snapshot: built.sentSnapshot, wo_snapshot: built.woDoc,
      external_ref: { hours_pending: false, work_order_url: built.externalRef.work_order_url || row.externalRef.work_order_url || null, hours_filled_at: new Date().toISOString() },
      surface_rows: seedRowsFromDoc(built.woDoc),
    };
    const { data, error } = await db.rpc("import_booked_job_set_scope", { p: payload });
    if (error) throw new Error(`quote ${row.quoteNo}: import_booked_job_set_scope: ${error.message}`);
    const r = data as { status: string; surfaces?: number };
    console.log(`${r.status.padEnd(14)} ${row.quoteNo.padEnd(5)} ${row.title}  ${hours} h · ${r.surfaces ?? 0} tick-list rows`);
    if (r.status === "ok") {
      const { error: noteErr } = await db.rpc("crm_log_event", {
        p_type: "note_added", p_account_id: row.accountId,
        p_payload: { body: `Work order filled from PaintScout (quote ${row.quoteNo}): ${built.counts.areas} areas, ${built.counts.lines} lines, ${hours} h.`, origin: "paintscout_work_order" },
        p_source: "system", p_occurred_at: new Date().toISOString(), p_estimate_id: row.estimateId,
        p_work_order_id: row.workOrderId, p_invoice_id: null, p_property_id: null, p_dedupe_key: `paintscout_work_order:${row.estimateId}:filled`,
      });
      if (noteErr) console.log(`  (note not logged: ${noteErr.message})`);
    }
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

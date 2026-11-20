/**
 * Go-live brief Session 6 — "calibration before customers".
 *
 * Tom picks ten past jobs, re-enters each through the public wizard (signed out, on his phone), and this prints the
 * comparison: the staff estimate against the wizard's, area by area and in total, both priced by TODAY's engine over
 * the live rate card so the only difference is what was entered.
 *
 * READ-ONLY. Connects with DATABASE_URL (a read-only production URL, or the test project's), reads the two
 * estimates of each pair, prices them, writes a Markdown report. Never writes a row.
 *
 *   DATABASE_URL=… npx tsx scripts/wizard/calibration-compare.ts \
 *     --pairs <staffEstimateId>=<wizardEstimateId>,<staffId>=<wizardId>,… \
 *     --out docs/testing/wizard-calibration-19nov.md
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { priceArea, priceEstimateTotals, type AreaInput, type BlockInput, type PricingContext } from "../../lib/pricing/estimate";
import { adjustmentsFrom } from "../../lib/pricing/context";
import { calibrationReport, type PricedEstimate } from "../../lib/wizard/calibration";

type Row = { id: string; title: string | null; source: string | null; created_at: string; builder_state: Record<string, unknown> | null; total_cents: number | null };

function arg(name: string): string | null { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; }
const pairsArg = arg("--pairs"); const out = arg("--out");
if (!pairsArg || !out) { console.error("usage: --pairs staffId=wizardId,… --out <report.md>"); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required (read-only)"); process.exit(2); }
const pairs = pairsArg.split(",").map((p) => p.split("=")).filter((p) => p.length === 2) as Array<[string, string]>;
if (pairs.length === 0) { console.error("no pairs"); process.exit(2); }

function priced(row: Row, ctx: PricingContext): PricedEstimate {
  const state = row.builder_state ?? {};
  const blocks = (Array.isArray(state.blocks) ? state.blocks : []) as BlockInput[];
  const adj = adjustmentsFrom(state);
  const totals = priceEstimateTotals(blocks, ctx, adj);
  const areas = blocks
    .filter((b): b is AreaInput => b.kind === "area" && b.isOption !== true)
    .map((b) => ({ name: String((b as { name?: unknown }).name ?? "Unnamed"), type: b.type, cents: priceArea(b, ctx, adj) }));
  return { id: row.id, label: row.title?.trim() || row.id.slice(0, 8), source: row.source, createdAt: row.created_at, totalCents: totals.totalCents, areas };
}

async function main() {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set transaction read only");
  const ids = pairs.flat();
  const [rateItems, products, modifiers, settings, estimates] = await Promise.all([
    client.query(`select ri.* from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.is_active`),
    client.query(`select * from products`),
    client.query(`select code, group_name, multiplier from modifiers where active`),
    client.query(`select key, value from settings`),
    client.query<Row>(`select id, title, source, created_at, builder_state, total_cents from estimates where id = any($1::uuid[])`, [ids]),
  ]);
  await client.end();
  const ctx: PricingContext = { rateItems: rateItems.rows, products: products.rows, modifiers: modifiers.rows, settings: settings.rows };
  const byId = new Map(estimates.rows.map((r) => [r.id, r]));
  const rows: Array<{ staff: PricedEstimate; wizard: PricedEstimate }> = [];
  for (const [s, w] of pairs) {
    const sr = byId.get(s), wr = byId.get(w);
    if (!sr || !wr) { console.error(`pair ${s}=${w}: ${!sr ? `staff ${s}` : `wizard ${w}`} not found`); process.exitCode = 1; continue; }
    rows.push({ staff: priced(sr, ctx), wizard: priced(wr, ctx) });
  }
  const when = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" }).format(new Date());
  const md = calibrationReport(rows, when);
  writeFileSync(out!, md);
  console.log(md.split("\n").slice(0, 12).join("\n"));
  console.log(`\nwrote ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

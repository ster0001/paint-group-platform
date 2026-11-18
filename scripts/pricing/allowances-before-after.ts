/**
 * Go-live brief §3.3 (18 Nov 2026) — the one real risk: existing estimates must not move.
 *
 * Prices EVERY estimate twice and compares to the cent:
 *   before = the engine as it was (a copy of lib/pricing from the previous main, read from --before <dir>)
 *            over the estimate's builder_state exactly as stored;
 *   after  = this tree's engine over the state migration 20270317 leaves behind (mirrored here:
 *            preparationHours = current or 0, preparationOverrideCents = current or the flat Settings
 *            sundries for the job's interior/exterior mix, cleaningHours = 0).
 * Both over the SAME live pricing context (the active rate card, products, modifiers, settings), so the
 * only thing that can differ is what null means. Zero differences is the gate for shipping the engine.
 *
 * READ-ONLY. Connects with DATABASE_URL (a read-only production URL, or the test project's), reads,
 * prints a Markdown report to --out. Never writes a row.
 *
 *   DATABASE_URL=… npx tsx scripts/pricing/allowances-before-after.ts --before /tmp/pricing-before --out docs/testing/allowances-before-after-18nov.md
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { priceEstimateTotals as priceAfter, type Adjustments, type BlockInput, type PricingContext } from "../../lib/pricing/estimate";
import { adjustmentsFrom } from "../../lib/pricing/context";

type Row = { id: string; status: string | null; source: string | null; created_at: string; builder_state: Record<string, unknown> | null; subtotal_cents: number | null; total_cents: number | null };

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const beforeDir = arg("--before");
const out = arg("--out");
if (!beforeDir || !out) { console.error("usage: --before <dir with the previous lib/pricing> --out <report.md>"); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required (read-only)"); process.exit(2); }

/** The flat Settings sundries, read the way the migration reads them. */
function settingDollars(settings: { key: string; value: unknown }[], key: string): number {
  const row = settings.find((s) => s.key === key);
  const v = row?.value as { value?: unknown } | number | string | null | undefined;
  const n = v == null ? 0 : typeof v === "object" ? Number((v as { value?: unknown }).value) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Migration 20270317, mirrored on one builder_state. Returns null when the migration would skip the row. */
export function migrateState(state: Record<string, unknown>, interiorDollars: number, exteriorDollars: number): Record<string, unknown> | null {
  if (Object.prototype.hasOwnProperty.call(state, "cleaningHours")) return null;
  const blocks = Array.isArray(state.blocks) ? (state.blocks as Array<{ type?: unknown; isOption?: unknown }>) : [];
  const live = blocks.filter((b) => b && typeof b === "object" && (b.isOption === undefined || b.isOption === false));
  const anyInt = live.some((b) => b.type === "Interior");
  const anyExt = live.some((b) => b.type !== "Interior");
  const prep = typeof state.preparationHours === "number" && Number.isFinite(state.preparationHours) ? state.preparationHours : 0;
  const sundries = typeof state.preparationOverrideCents === "number" && Number.isFinite(state.preparationOverrideCents)
    ? state.preparationOverrideCents
    : Math.round(((anyInt ? interiorDollars : 0) + (anyExt ? exteriorDollars : 0)) * 100);
  return { ...state, preparationHours: prep, preparationOverrideCents: sundries, cleaningHours: 0 };
}

async function main() {
  const before = (await import(resolve(beforeDir!, "estimate.ts"))) as { priceEstimateTotals: typeof priceAfter };
  const beforeCtx = (await import(resolve(beforeDir!, "context.ts"))) as { adjustmentsFrom: typeof adjustmentsFrom };
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set transaction read only");
  const [rateItems, products, modifiers, settings, estimates, scopes] = await Promise.all([
    client.query(`select ri.* from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.is_active`),
    client.query(`select * from products`),
    client.query(`select code, group_name, multiplier from modifiers where active`),
    client.query(`select key, value from settings`),
    client.query<Row>(`select id, status, source, created_at, builder_state, subtotal_cents, total_cents from estimates where builder_state is not null and jsonb_typeof(builder_state) = 'object' order by created_at`),
    client.query<{ work_order_id: string; estimate_id: string; accepted_state: Record<string, unknown> | null; working_state: Record<string, unknown> | null }>(
      `select work_order_id, estimate_id, accepted_state, working_state from wo_working_scopes`),
  ]);
  await client.end();
  const ctx: PricingContext = { rateItems: rateItems.rows, products: products.rows, modifiers: modifiers.rows, settings: settings.rows };
  const interiorDollars = settingDollars(settings.rows, "Sundries per job — interior");
  const exteriorDollars = settingDollars(settings.rows, "Sundries per job — exterior");

  const diffs: Array<{ id: string; status: string | null; source: string | null; before: number; after: number; field: string }> = [];
  let compared = 0, skipped = 0, alreadyExplicit = 0, failed = 0;
  const bySource = new Map<string, number>();
  for (const e of estimates.rows) {
    const state = e.builder_state!;
    const blocks = (Array.isArray(state.blocks) ? state.blocks : []) as BlockInput[];
    const migrated = migrateState(state, interiorDollars, exteriorDollars);
    if (!migrated) { alreadyExplicit++; continue; }
    try {
      const b = before.priceEstimateTotals(blocks, ctx, beforeCtx.adjustmentsFrom(state) as Adjustments);
      const a = priceAfter(blocks, ctx, adjustmentsFrom(migrated));
      compared++;
      bySource.set(e.source ?? "?", (bySource.get(e.source ?? "?") ?? 0) + 1);
      for (const field of ["subtotalCents", "totalCents", "contractorOfferCents", "sundriesCents", "preparationHoursCents"] as const) {
        if (b[field] !== a[field]) diffs.push({ id: e.id, status: e.status, source: e.source, before: b[field], after: a[field], field });
      }
      if (Math.abs(b.contractorHours - a.contractorHours) > 1e-9) diffs.push({ id: e.id, status: e.status, source: e.source, before: b.contractorHours, after: a.contractorHours, field: "contractorHours" });
    } catch (err) {
      failed++;
      diffs.push({ id: e.id, status: e.status, source: e.source, before: NaN, after: NaN, field: `threw: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  skipped = estimates.rows.length - compared - alreadyExplicit;
  // Accepted jobs with a work order keep their pricing state in wo_working_scopes (accepted + working); pinned the same way.
  let scopeStates = 0, scopeCompared = 0;
  for (const sc of scopes.rows) {
    for (const [which, state] of [["accepted_state", sc.accepted_state], ["working_state", sc.working_state]] as const) {
      if (!state || typeof state !== "object") continue;
      scopeStates++;
      const migrated = migrateState(state, interiorDollars, exteriorDollars);
      if (!migrated) continue;
      const blocks = (Array.isArray(state.blocks) ? state.blocks : []) as BlockInput[];
      try {
        const b = before.priceEstimateTotals(blocks, ctx, beforeCtx.adjustmentsFrom(state) as Adjustments);
        const a = priceAfter(blocks, ctx, adjustmentsFrom(migrated));
        scopeCompared++;
        for (const field of ["subtotalCents", "totalCents", "contractorOfferCents", "sundriesCents", "preparationHoursCents"] as const) {
          if (b[field] !== a[field]) diffs.push({ id: `${sc.estimate_id} (${which})`, status: "accepted", source: "working scope", before: b[field], after: a[field], field });
        }
        if (Math.abs(b.contractorHours - a.contractorHours) > 1e-9) diffs.push({ id: `${sc.estimate_id} (${which})`, status: "accepted", source: "working scope", before: b.contractorHours, after: a.contractorHours, field: "contractorHours" });
      } catch (err) {
        failed++;
        diffs.push({ id: `${sc.estimate_id} (${which})`, status: "accepted", source: "working scope", before: NaN, after: NaN, field: `threw: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
  const host = new URL(url!.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
  const lines = [
    `# Site allowances — before/after over every estimate (${new Date().toISOString().slice(0, 10)})`,
    "",
    `Go-live brief §3.3. Database host: \`${host}\`. Read-only. Before = the previous engine over the stored state; after = this engine over the state migration 20270317 leaves (mirrored in \`scripts/pricing/allowances-before-after.ts\`). Same live rate card, products, modifiers and settings for both.`,
    "",
    `| Estimates with a builder state | Compared | Already explicit (skipped by the migration) | Failed to price | **Differences (any field)** |`,
    `|---|---|---|---|---|`,
    `| ${estimates.rows.length} | ${compared} | ${alreadyExplicit} | ${failed} | **${diffs.length}** |`,
    "",
    `Fields compared per estimate: subtotal, total, contractor offer, sundries line, preparation hours line (cents) and contractor hours.`,
    "",
    `Working scopes (wo_working_scopes, accepted + working states of accepted jobs): ${scopeStates} states, ${scopeCompared} compared the same way; their differences are counted above.`,
    "",
    `By source: ${[...bySource.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}.`,
    `Flat sundries read from Settings for the migration mirror: interior $${interiorDollars}, exterior $${exteriorDollars}.`,
    "",
  ];
  if (diffs.length) {
    lines.push("## Differences", "", "| Estimate | Status | Source | Field | Before | After |", "|---|---|---|---|---|---|");
    for (const d of diffs.slice(0, 200)) lines.push(`| ${d.id} | ${d.status ?? ""} | ${d.source ?? ""} | ${d.field} | ${d.before} | ${d.after} |`);
    if (diffs.length > 200) lines.push("", `…and ${diffs.length - 200} more.`);
  } else {
    lines.push("## Result", "", "**Zero cents of difference on every estimate.** The engine change can ship once the migration is live.");
  }
  if (skipped) lines.push("", `Skipped (no builder state): ${skipped}.`);
  writeFileSync(out!, lines.join("\n") + "\n");
  console.log(lines.slice(0, 12).join("\n"));
  console.log(diffs.length ? `DIFFERENCES: ${diffs.length}` : "ZERO DIFFERENCES");
  process.exit(diffs.length ? 1 : 0);
}

void main();

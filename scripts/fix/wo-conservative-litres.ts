/**
 * READ ONLY. Writes the repair SQL for Tom to paste — never applies it.
 *
 * Tom, 13 Oct 2026: work orders issued before PR #263 froze each paint's order
 * ROUNDED UP to the next tin (4.1 L → 10 L, 15.5 L → 20 L). New sheets round
 * the estimate DOWN to whole litres (orderLitres). This brings the open jobs'
 * frozen sheets into line:
 *
 *   · a material row whose frozen litres exceed the estimate gets
 *     litres = orderLitres(estimate) and estimatedLitres = the estimate;
 *   · every painted surface on the sheet gets its estimate `litres`, so the
 *     sheet shows "Materials for this area".
 *
 * Skipped: closed jobs; rows already at or under the conservative figure; rows
 * whose litres the office set by hand (a material_edited event with litres);
 * rows the estimate can't price. The estimate figures come from the SAME
 * engine call PC Command shows (materialRowEstimates / materialsBreakdown on
 * the estimate's own rate card).
 *
 * Every statement is guarded on the value read here, so a figure changed
 * after this ran is left alone and a second paste changes nothing.
 *
 * Usage (from a checkout whose .env.local is production, or name the file):
 *   npx tsx scripts/fix/wo-conservative-litres.ts --env ../paint-group-platform/.env.local --sql /tmp/repair.sql
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEstimatePricing, materialRowEstimates } from "../../lib/workorder/materialsBudget";
import { materialsBreakdown, type BlockInput } from "../../lib/pricing/estimate";
import { adjustmentsFrom } from "../../lib/pricing/context";
import { materialRowKey } from "../../lib/workorder/materials";
import { orderLitres, type WorkOrderDoc } from "../../lib/workorder/snapshot";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const envPath = arg("--env") ?? ".env.local";
const sqlPath = arg("--sql");
if (!existsSync(envPath)) throw new Error(`no env file at ${envPath}`);
const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(`${envPath} has no Supabase URL / service key`);
console.log(`reading ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host} (read only)`);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Wo = { id: string; wo_ref: string; stage: string; estimate_id: string | null; wo_snapshot: WorkOrderDoc | null };
async function main() {
  const { data: wos, error } = await db.from("work_orders")
    .select("id, wo_ref, stage, estimate_id, wo_snapshot").neq("stage", "closed");
  if (error) throw new Error(`work_orders: ${error.message}`);
  const { data: edits, error: evErr } = await db.from("wo_events")
    .select("work_order_id, meta").eq("type", "material_edited");
  if (evErr) throw new Error(`wo_events: ${evErr.message}`);
  const handSet = new Set(((edits ?? []) as { work_order_id: string; meta: { row_key?: string; litres?: number | null } }[])
    .filter((e) => e.meta?.litres != null).map((e) => `${e.work_order_id}|${e.meta.row_key}`));

  const sql: string[] = [];
  let rowsFixed = 0; let sheetsWithSurfaces = 0; let litresBefore = 0; let litresAfter = 0;
  for (const w of (wos ?? []) as Wo[]) {
    const doc = w.wo_snapshot;
    if (!doc?.materials?.length || !w.estimate_id) continue;
    const pricing = await loadEstimatePricing(db, w.estimate_id);
    const est = materialRowEstimates(doc, pricing.state, pricing.ctx);
    const blocks = (pricing.state?.blocks as BlockInput[] | undefined) ?? [];
    if (!est || blocks.length === 0) { console.log(`  ${w.wo_ref} (${w.stage}): estimate can't be priced — skipped`); continue; }

    const lines: string[] = [];
    for (const m of doc.materials) {
      const key = materialRowKey(m);
      const e = est.get(key);
      if (!e || m.litres == null) continue;
      const target = orderLitres(e.litres);
      const tag = `${w.wo_ref} (${w.stage}) ${key}: ${m.litres} L → ${target} L (estimate ${r2(e.litres)} L)`;
      if (m.litres <= target) continue;
      if (handSet.has(`${w.id}|${key}`)) { console.log(`  ${tag} — SKIPPED, litres set by hand`); continue; }
      console.log(`  ${tag}`);
      rowsFixed++; litresBefore += m.litres; litresAfter += target;
      lines.push(`update public.work_orders w set wo_snapshot = jsonb_set(w.wo_snapshot, '{materials}', (
    select jsonb_agg(case when coalesce(m->>'colourKey', m->>'product') = ${q(key)} and (m->>'litres')::numeric = ${m.litres}
      then m || jsonb_build_object('litres', ${target}, 'estimatedLitres', ${r2(e.litres)}, 'coverageMissing', false) else m end order by i)
    from jsonb_array_elements(w.wo_snapshot->'materials') with ordinality t(m, i)))
  where w.id = ${q(w.id)};`);
    }

    // Per-surface litres for the area lists, only where the sheet has none yet.
    const bd = materialsBreakdown(blocks, pricing.ctx, adjustmentsFrom(pricing.state ?? {}));
    const map: Record<string, number> = {};
    for (const a of doc.areas ?? []) for (const s of a.surfaces ?? []) {
      const hit = s.product && typeof s.litres !== "number" ? bd.surfaces.get(s.key) : undefined;
      if (hit && hit.litres > 0) map[s.key] = r2(hit.litres);
    }
    if (Object.keys(map).length > 0) {
      sheetsWithSurfaces++;
      lines.push(`update public.work_orders w set wo_snapshot = jsonb_set(w.wo_snapshot, '{areas}', (
    select jsonb_agg(case when jsonb_typeof(a->'surfaces') <> 'array' then a else a || jsonb_build_object('surfaces', (
      select coalesce(jsonb_agg(case when s ? 'litres' or not (${q(JSON.stringify(map))}::jsonb ? (s->>'key')) then s
        else s || jsonb_build_object('litres', (${q(JSON.stringify(map))}::jsonb ->> (s->>'key'))::numeric) end order by j), '[]'::jsonb)
      from jsonb_array_elements(a->'surfaces') with ordinality u(s, j))) end order by i)
    from jsonb_array_elements(w.wo_snapshot->'areas') with ordinality t(a, i)))
  where w.id = ${q(w.id)} and jsonb_typeof(w.wo_snapshot->'areas') = 'array';`);
    }
    if (lines.length > 0) {
      sql.push(`-- ${w.wo_ref} · ${doc.jobTitle} (${w.stage})`, ...lines,
        `insert into public.wo_events (work_order_id, type, actor_kind, meta)
    select ${q(w.id)}, 'materials_rounded_down', 'system', '{"by":"repair 13 Oct 2026 (PR #263)"}'::jsonb
    where not exists (select 1 from public.wo_events where work_order_id = ${q(w.id)} and type = 'materials_rounded_down');`, "");
    }
  }

  console.log(`\n${rowsFixed} paint rows to round down (${r2(litresBefore)} L → ${r2(litresAfter)} L) · ${sheetsWithSurfaces} sheets gain per-area litres`);
  if (sqlPath) {
    writeFileSync(sqlPath, [
      "-- Work-order materials: old round-up sheets → conservative order (Tom, 13 Oct 2026, PR #263).",
      "-- Generated READ-ONLY by scripts/fix/wo-conservative-litres.ts. Guarded: re-running changes nothing.",
      "set lock_timeout = '15s';",
      "begin;",
      "",
      ...sql,
      "commit;",
      "",
      "-- read-back: jobs repaired by this paste",
      "select w.wo_ref, w.stage,",
      "  (select count(*) from jsonb_array_elements(w.wo_snapshot->'materials') m where m ? 'estimatedLitres') as rows_with_estimate,",
      "  (select sum((m->>'litres')::numeric) from jsonb_array_elements(w.wo_snapshot->'materials') m) as order_litres",
      "from public.work_orders w",
      "where exists (select 1 from public.wo_events e where e.work_order_id = w.id and e.type = 'materials_rounded_down')",
      "order by 1;",
      "",
    ].join("\n"));
    console.log(`SQL written to ${sqlPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

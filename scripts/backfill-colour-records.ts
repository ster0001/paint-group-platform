/**
 * Trade portal v2 · Session 1 — backfill colour_records for every CLOSED job.
 *
 * DRY RUN by default (the report-and-confirm rule): prints the attribution
 * report and STOPS. Re-run with --apply to write.
 *
 *   npx tsx scripts/backfill-colour-records.ts            # report only
 *   npx tsx scripts/backfill-colour-records.ts --apply    # write rows
 *
 * TARGET (the F1-03 rule: a script declares its target, never inherits one):
 *   1. process.env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else
 *   2. .env.test.local (the C1 test stack). NEVER .env.local — that is prod.
 *   The resolved project ref prints before anything runs, and anything
 *   matching the production ref (read from .env.local) is REFUSED unless
 *   SEED_ALLOW_PRODUCTION=1 (mirrors scripts/c1/env.mjs).
 *
 * Attribution (Tom's ruling 4, 30 Aug):
 *   · estimates.property_id where present            → attributed_by_id
 *   · else EXACT normalised-address match (matchKey) → attributed_by_address
 *   · anything weaker → unattributed + one-line reason, resolved by hand.
 * Every row is source=historical_import + colour_attribution_lossy=true —
 * pre-fix snapshots key colour per product, so per-room truth is gone.
 *
 * Idempotent: a work order that already has colour_records rows is skipped.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  melbourneDate,
  reconstructRows,
  linkSupersedence,
  type LiveColourIn,
  type SnapshotAreaIn,
  type SnapshotMaterialIn,
  type ReconstructedRow,
} from "../lib/colourRecords/reconstruct";
import { foldAddressKey, matchKey } from "../lib/colourRecords/attribution";

const APPLY = process.argv.includes("--apply");

// ---- target resolution (mirrors scripts/c1/env.mjs, typed) -----------------

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// --prod targets production by reading .env.local directly (keys never ride
// the command line) — still refused below unless SEED_ALLOW_PRODUCTION=1.
const PROD_FLAG = process.argv.includes("--prod");
const flagEnv = PROD_FLAG ? parseEnvFile(resolve(process.cwd(), ".env.local")) : {};
const testEnv = PROD_FLAG ? {} : parseEnvFile(resolve(process.cwd(), ".env.test.local"));
const url = flagEnv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || testEnv.NEXT_PUBLIC_SUPABASE_URL;
const key = flagEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || testEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("No target: set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or provide .env.test.local");
  process.exit(1);
}
const prodRef = parseEnvFile(resolve(process.cwd(), ".env.local"))
  .NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const targetRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? url;
if (prodRef && targetRef === prodRef && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error(`REFUSED: target ${targetRef} is the PRODUCTION project. Set SEED_ALLOW_PRODUCTION=1 only with Tom's explicit go-ahead.`);
  process.exit(1);
}
console.log(`Target project: ${targetRef}${targetRef === prodRef ? "  ⚠ PRODUCTION (explicitly allowed)" : ""}`);
console.log(APPLY ? "Mode: APPLY — rows will be written." : "Mode: dry run — report only.\n");

// ---- shapes ----------------------------------------------------------------

type WORow = {
  id: string;
  wo_ref: string | null;
  estimate_id: string;
  colours: LiveColourIn;
  wo_snapshot: { areas?: SnapshotAreaIn[]; materials?: SnapshotMaterialIn[] } | null;
};
type EstimateRow = {
  id: string;
  title: string | null;
  account_id: string | null;
  property_id: string | null;
  job_address: { address?: string; city?: string; postal?: string } | null;
};
type TickRow = { work_order_id: string; heading: string; label: string; state: string; state_changed_at: string | null };
type SignoffRow = { work_order_id: string; signed_at: string | null };
type PropertyRow = { id: string; account_id: string; address_norm: string | null };

type Unattributed = { woRef: string; title: string; reason: string };

type Filters = { eq?: [column: string, value: string]; in?: [column: string, values: string[]] };

async function all<T>(db: SupabaseClient, table: string, select: string, filters?: Filters): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    let q = db.from(table).select(select).range(from, from + 499);
    if (filters?.eq) q = q.eq(filters.eq[0], filters.eq[1]);
    if (filters?.in) q = q.in(filters.in[0], filters.in[1]);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 500) return out;
  }
}

/** `.in()` filters ride the URL — 16k uuids is a 414. Chunk the id list. */
async function allIn<T>(db: SupabaseClient, table: string, select: string, col: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await all<T>(db, table, select, { in: [col, ids.slice(i, i + 100)] }));
  }
  return out;
}

// ---- main ------------------------------------------------------------------

async function main(): Promise<void> {
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const wos = await all<WORow>(db, "work_orders", "id, wo_ref, estimate_id, colours, wo_snapshot",
    { eq: ["stage", "closed"] });
  console.log(`Closed work orders: ${wos.length}`);
  if (!wos.length) { console.log("Nothing to backfill."); return; }

  const woIds = wos.map((w) => w.id);
  const estIds = [...new Set(wos.map((w) => w.estimate_id))];

  const [ests, ticks, signoffs, existing] = await Promise.all([
    allIn<EstimateRow>(db, "estimates", "id, title, account_id, property_id, job_address:builder_state->jobAddress",
      "id", estIds),
    allIn<TickRow>(db, "wo_surfaces", "work_order_id, heading, label, state, state_changed_at",
      "work_order_id", woIds),
    allIn<SignoffRow>(db, "wo_signoff", "work_order_id, signed_at", "work_order_id", woIds),
    allIn<{ source_job_id: string | null }>(db, "colour_records", "source_job_id",
      "source_job_id", woIds),
  ]);

  const estById = new Map(ests.map((e) => [e.id, e]));
  const signedById = new Map(signoffs.map((s) => [s.work_order_id, s.signed_at]));
  const ticksById = new Map<string, TickRow[]>();
  for (const t of ticks) {
    const arr = ticksById.get(t.work_order_id) ?? [];
    arr.push(t);
    ticksById.set(t.work_order_id, arr);
  }
  const alreadyDone = new Set(existing.map((r) => r.source_job_id).filter(Boolean) as string[]);

  // Properties per involved account, indexed by folded address key.
  const accountIds = [...new Set(ests.map((e) => e.account_id).filter(Boolean) as string[])];
  const props = accountIds.length
    ? await allIn<PropertyRow>(db, "properties", "id, account_id, address_norm", "account_id", accountIds)
    : [];
  const propsByAccount = new Map<string, PropertyRow[]>();
  for (const p of props) {
    const arr = propsByAccount.get(p.account_id) ?? [];
    arr.push(p);
    propsByAccount.set(p.account_id, arr);
  }

  // ---- reconstruct + attribute per WO --------------------------------------

  type Candidate = ReconstructedRow & {
    property_id: string;
    source_job_id: string;
    jobOrder: number;
    via: "id" | "address";
  };
  const candidates: Candidate[] = [];
  const unattributed: Unattributed[] = [];
  const noColours: string[] = [];
  let skipped = 0;
  let byIdJobs = 0;
  let byAddressJobs = 0;

  for (const wo of wos) {
    if (alreadyDone.has(wo.id)) { skipped++; continue; }
    const est = estById.get(wo.estimate_id);
    const woRef = wo.wo_ref ?? wo.id.slice(0, 8);
    const title = est?.title?.trim() || "(untitled)";

    // Attribution first — a job we can't place produces no rows.
    let propertyId = est?.property_id ?? null;
    let via: "id" | "address" = "id";
    if (!propertyId) {
      if (!est?.account_id) {
        unattributed.push({ woRef, title, reason: "estimate not account-linked" });
        continue;
      }
      const addr = est.job_address;
      const wanted = matchKey({ street: addr?.address, suburb: addr?.city, postcode: addr?.postal });
      if (!wanted) {
        unattributed.push({ woRef, title, reason: "no street address on the estimate" });
        continue;
      }
      const matches = (propsByAccount.get(est.account_id) ?? [])
        .filter((p) => p.address_norm && foldAddressKey(p.address_norm) === wanted);
      if (matches.length === 1) {
        propertyId = matches[0].id;
        via = "address";
      } else {
        unattributed.push({
          woRef, title,
          reason: matches.length === 0
            ? `no property of the account matches "${wanted}"`
            : `${matches.length} properties share "${wanted}" — ambiguous`,
        });
        continue;
      }
    }

    const signedAt = signedById.get(wo.id) ?? null;
    const rows = reconstructRows({
      areas: wo.wo_snapshot?.areas ?? [],
      materials: wo.wo_snapshot?.materials ?? [],
      liveColours: wo.colours ?? null,
      doneTicks: (ticksById.get(wo.id) ?? []).map((t) => ({
        heading: t.heading, label: t.label, state: t.state, stateChangedAt: t.state_changed_at,
      })),
      signedOn: signedAt ? melbourneDate(signedAt) : null,
    });
    if (!rows.length) { noColours.push(`${woRef} · ${title}`); continue; }

    if (via === "id") byIdJobs++; else byAddressJobs++;
    const jobOrder = signedAt ? Date.parse(signedAt) : 0;
    for (const r of rows) {
      candidates.push({ ...r, property_id: propertyId!, source_job_id: wo.id, jobOrder, via });
    }
  }

  // ---- supersedence per property -------------------------------------------

  const byProperty = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byProperty.get(c.property_id) ?? [];
    arr.push(c);
    byProperty.set(c.property_id, arr);
  }
  // For each property: rows sharing (area × surface type), older job → superseded.
  const supersededBy = new Map<Candidate, Candidate>();
  for (const rows of byProperty.values()) {
    const links = linkSupersedence(rows);
    links.forEach((next, i) => { if (next !== null) supersededBy.set(rows[i], rows[next]); });
  }

  // ---- report --------------------------------------------------------------

  const rowsById = candidates.filter((c) => c.via === "id").length;
  const rowsByAddr = candidates.filter((c) => c.via === "address").length;
  console.log("\n===== Backfill report =====");
  console.log(`Closed WOs:                ${wos.length}`);
  console.log(`Skipped (already have rows): ${skipped}`);
  console.log(`Attributed by property_id: ${byIdJobs} jobs → ${rowsById} rows`);
  console.log(`Attributed by address:     ${byAddressJobs} jobs → ${rowsByAddr} rows`);
  const cap = <T,>(items: T[], print: (t: T) => string): void => {
    items.slice(0, 40).forEach((i) => console.log(`    · ${print(i)}`));
    if (items.length > 40) console.log(`    … and ${items.length - 40} more (use --report <path> for the full list)`);
  };
  console.log(`No reconstructable colours (all TBC): ${noColours.length}`);
  cap(noColours, (l) => l);
  console.log(`Unattributed:              ${unattributed.length}`);
  cap(unattributed, (u) => `${u.woRef} · ${u.title} — ${u.reason}`);
  const reportFlag = process.argv.indexOf("--report");
  if (reportFlag !== -1 && process.argv[reportFlag + 1]) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.argv[reportFlag + 1], JSON.stringify({ unattributed, noColours }, null, 2));
    console.log(`Full lists written to ${process.argv[reportFlag + 1]}`);
  }
  console.log(`Rows to write:             ${candidates.length} (all lossy, source=historical_import)`);
  console.log(`  of which superseded:     ${supersededBy.size}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  // ---- write ---------------------------------------------------------------
  // Insert everything as applied first, then patch the superseded chain
  // (the DB CHECK ties status='superseded' to superseded_by being set).

  const ids = new Map<Candidate, string>();
  for (const c of candidates) {
    const { data, error } = await db.from("colour_records").insert({
      property_id: c.property_id,
      area_label: c.area_label,
      surface_type: c.surface_type,
      brand: c.brand,
      product: c.product,
      colour_name: c.colour_name,
      colour_code: c.colour_code,
      sheen: c.sheen,
      coats: c.coats,
      swatch_hex: c.swatch_hex,
      status: "applied",
      applied_from: c.applied_from,
      applied_to: c.applied_to,
      source_job_id: c.source_job_id,
      source: "historical_import",
      colour_attribution_lossy: true,
    }).select("id").single();
    if (error) throw new Error(`insert (${c.area_label} / ${c.colour_name}): ${error.message}`);
    ids.set(c, data.id as string);
  }
  let superseded = 0;
  for (const [older, newer] of supersededBy) {
    const { error } = await db.from("colour_records")
      .update({ status: "superseded", superseded_by: ids.get(newer) })
      .eq("id", ids.get(older)!);
    if (error) throw new Error(`supersede: ${error.message}`);
    superseded++;
  }
  console.log(`\nWrote ${ids.size} rows, marked ${superseded} superseded. Done.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

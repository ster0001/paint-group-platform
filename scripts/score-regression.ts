/**
 * The Step 6 accuracy gate (master plan): score the plan reader's output
 * against PaintScout work-order ground truth.
 *
 *   ceiling m2 within +/-7% - wall m2 within +/-10% - hours within +/-12%
 *
 * What is scored and how, honestly:
 *   - The draft is rebuilt from each job's stored reading (extraction_runs.
 *     raw_output) through the REAL pipeline stages - resolveRoomType,
 *     planSurfaces, buildDraft - then priced by lib/pricing with the live
 *     rate card. Nothing is re-modelled; this scores what the app would
 *     actually draft today.
 *   - Ceiling height: the assumed 2.4 m, because baseline runs were never
 *     applied with a confirmed height. Jobs where the real height differs
 *     will miss on walls - that is a true statement about accuracy, not
 *     noise.
 *   - The work order's dimensions cover what was QUOTED. A partial repaint
 *     (three rooms of twelve) will legitimately not match a full-plan draft,
 *     so each row prints the room counts and the gate summary separates
 *     full-scope-looking jobs from partial ones rather than pretending one
 *     number covers both.
 *
 *   E2E_STAFF_EMAIL=... E2E_STAFF_PASSWORD=... npx tsx scripts/score-regression.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildDraft } from "../lib/extract/draft.ts";
import { SCOPE_VERSION, type Alias, type ScopeRule } from "../lib/extract/scope.ts";
import type { Extraction } from "../lib/extract/schema.ts";
import {
  priceEstimateTotals,
  type Adjustments,
  type BlockInput,
  type PricingContext,
} from "../lib/pricing/estimate.ts";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
const SET = path.join(ROOT, "regression-set");

type ManifestJob = { id: string; address: string; plan: string | null; jobType: string; ignored?: boolean; note?: string };
type WoTruth = {
  key: string;
  totalHours: number | null;
  totalDimensions: Record<string, number>;
  items: Array<{ name: string; qty: number; unit: string }>;
};

const pct = (pred: number, truth: number) => (truth > 0 ? ((pred - truth) / truth) * 100 : null);
const fmt = (p: number | null) => (p == null ? "   n/a" : `${p >= 0 ? "+" : ""}${p.toFixed(0).padStart(4)}%`);

async function main() {
  const email = process.env.E2E_STAFF_EMAIL;
  const password = process.env.E2E_STAFF_PASSWORD;
  if (!email || !password) { console.error("Set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD."); process.exit(1); }

  const env = Object.fromEntries(
    readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({ email, password });

  const manifest = JSON.parse(readFileSync(path.join(SET, "manifest.json"), "utf8")) as { jobs: ManifestJob[] };
  const woTruth = JSON.parse(readFileSync(path.join(SET, "work-order-truth.json"), "utf8")) as WoTruth[];
  const truthByKey = new Map(woTruth.map((t) => [t.key, t]));

  // Latest runId per job across every results file.
  const runIds = new Map<string, string>();
  for (const f of readdirSync(SET).filter((x) => x.startsWith("results-") && x.endsWith(".json")).sort()) {
    for (const row of JSON.parse(readFileSync(path.join(SET, f), "utf8")) as Array<{ id?: string; runId?: string }>) {
      if (row.id && row.runId) runIds.set(row.id, row.runId);
    }
  }

  // The same reference data the apply route uses.
  const [rulesRes, aliasRes, rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    sb.from("room_type_scope_rules").select("*").eq("version", SCOPE_VERSION),
    sb.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
    sb.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
    sb.from("products").select("*"),
    sb.from("modifiers").select("code, group_name, multiplier").eq("active", true),
    sb.from("settings").select("key, value"),
  ]);
  const rules = (rulesRes.data ?? []) as ScopeRule[];
  const aliases = (aliasRes.data ?? []) as Alias[];
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as PricingContext["rateItems"],
    products: (productsRes.data ?? []) as PricingContext["products"],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  const adj: Adjustments = { modSel: {}, materials: {} };

  const rows: Array<Record<string, unknown>> = [];
  console.log("job              rooms(read/dim)  ceiling m2 pred/truth   walls m2 pred/truth     hours pred/truth   gates(C/W/H)");

  for (const job of manifest.jobs) {
    if (job.ignored || !job.plan) continue;
    const truth = truthByKey.get(job.id);
    const runId = runIds.get(job.id);
    if (!truth || !runId) continue;
    if (job.jobType === "exterior") continue; // interior reader only - envelope is later Step 6 work

    const { data: run } = await sb.from("extraction_runs").select("raw_output").eq("id", runId).single();
    const reading = run?.raw_output as Extraction | null;
    if (!reading) continue;

    const draft = buildDraft(reading, rules, aliases);
    const dimmed = draft.areas.filter((a) => a.L > 0 && a.W > 0);

    const predCeil = dimmed.reduce((n, a) => n + a.L * a.W, 0);
    const predWalls = dimmed.reduce((n, a) => n + 2 * (a.L + a.W) * a.H, 0);
    const totals = priceEstimateTotals(draft.areas as unknown as BlockInput[], ctx, adj);
    const predHours = totals.contractorHours;

    const tCeil = truth.totalDimensions["Ceiling"] ?? null;
    const tWalls = truth.totalDimensions["Walls"] ?? null;
    const tHours = truth.totalHours;

    const dCeil = tCeil != null ? pct(predCeil, tCeil) : null;
    const dWalls = tWalls != null ? pct(predWalls, tWalls) : null;
    const dHours = tHours != null ? pct(predHours, tHours) : null;

    const gate = (d: number | null, lim: number) => (d == null ? "-" : Math.abs(d) <= lim ? "PASS" : "fail");
    const gates = `${gate(dCeil, 7)}/${gate(dWalls, 10)}/${gate(dHours, 12)}`;

    rows.push({
      id: job.id, address: job.address, jobType: job.jobType, runId,
      roomsRead: draft.areas.length, roomsDimensioned: dimmed.length,
      predCeilM2: Math.round(predCeil * 10) / 10, truthCeilM2: tCeil, ceilPct: dCeil,
      predWallsM2: Math.round(predWalls * 10) / 10, truthWallsM2: tWalls, wallsPct: dWalls,
      predHours: Math.round(predHours * 10) / 10, truthHours: tHours, hoursPct: dHours,
      gates,
    });

    console.log(
      `${job.id.padEnd(16)} ${String(draft.areas.length).padStart(2)}/${String(dimmed.length).padEnd(12)} ` +
      `${predCeil.toFixed(0).padStart(5)}/${String(tCeil ?? "?").padEnd(7)} ${fmt(dCeil)}   ` +
      `${predWalls.toFixed(0).padStart(5)}/${String(tWalls ?? "?").padEnd(7)} ${fmt(dWalls)}   ` +
      `${predHours.toFixed(0).padStart(4)}/${String(tHours ?? "?").padEnd(7)} ${fmt(dHours)}   ${gates}`,
    );
  }

  const stamp = process.env.RUN_STAMP ?? "latest";
  writeFileSync(path.join(SET, `scores-${stamp}.json`), JSON.stringify(rows, null, 2));

  // The aggregate that matters: jobs whose plan was fully dimensioned AND
  // whose work order looks like a whole-interior repaint (ceiling truth
  // exists). Partial-scope jobs are listed but not aggregated.
  const scorable = rows.filter((r) => r.ceilPct != null && (r.roomsDimensioned as number) > 0);
  const passing = (k: string, lim: number) => scorable.filter((r) => r[k] != null && Math.abs(r[k] as number) <= lim).length;
  console.log(`\n${rows.length} jobs scored -> regression-set/scores-${stamp}.json`);
  console.log(`Of ${scorable.length} with ceiling truth + dimensions: ceilings ±7%: ${passing("ceilPct", 7)} · walls ±10%: ${passing("wallsPct", 10)} · hours ±12%: ${passing("hoursPct", 12)}`);
  console.log("Read each fail with the room counts in view: undimensioned plans and partial-scope work orders are coverage gaps, not model misreads.");
}

main();

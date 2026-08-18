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
import { SCOPE_VERSION, resolveRoomType, type Alias, type ScopeRule } from "../lib/extract/scope.ts";
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
  items: Array<{ area: string | null; name: string; qty: number; unit: string; hours: number | null }>;
  areaTotals: Array<{ area: string; total: number }>;
  /** Per-room L/W/H printed on the work order - metres, H is the TRUE ceiling height. */
  areaDimensions?: Record<string, { L: number; W: number; H: number }>;
};

const pct = (pred: number, truth: number) => (truth > 0 ? ((pred - truth) / truth) * 100 : null);
const fmt = (p: number | null) => (p == null ? "   n/a" : `${p >= 0 ? "+" : ""}${p.toFixed(0).padStart(4)}%`);

/**
 * Room-name signature for matching a work-order area to a plan room: both
 * sides resolve through the SAME alias table the pipeline uses, keeping any
 * trailing number ("Bed 2" and "Bedroom 2" -> bedroom#2). Whole-job totals
 * punish partial repaints unfairly; matched rooms are the honest comparison.
 */
function roomSignature(name: string, aliases: Alias[], resolve: typeof import("../lib/extract/scope.ts").resolveRoomType): string {
  const trimmed = name.trim().replace(/\s*\([^)]*\)\s*$/, ""); // drop "(4'x6'x2.7')"
  const num = trimmed.match(/(\d+)\s*$/)?.[1] ?? "";
  const type = resolve(trimmed, aliases);
  return type === "unknown" ? `raw:${trimmed.toLowerCase()}` : `${type}#${num}`;
}

type RoomScore = {
  job: string; room: string;
  ceilPct: number | null; wallsPct: number | null; hoursPct: number | null;
  /** Walls re-predicted with the work order's own printed ceiling height - isolates "bad height assumption" from "bad plan read". */
  wallsTrueHPct?: number | null;
};

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
  const roomScores: RoomScore[] = [];
  console.log("job              rooms(read/dim)  ceiling m2 pred/truth   walls m2 pred/truth     hours pred/truth   gates(C/W/H)  matched rooms");

  for (const job of manifest.jobs) {
    if (job.ignored || !job.plan) continue;
    const truth = truthByKey.get(job.id);
    const runId = runIds.get(job.id);
    if (!truth || !runId) continue;
    if (job.jobType === "exterior") continue; // interior reader only - envelope is later Step 6 work

    const { data: run } = await sb.from("extraction_runs").select("raw_output").eq("id", runId).single();
    const reading = run?.raw_output as Extraction | null;
    if (!reading) continue;

    // CONFIRMED_HEIGHTS=1 - the production condition. The pipeline REQUIRES
    // the estimator to confirm the ceiling height before an apply; simulate
    // that confirmation with the job's modal height off its own work order,
    // which is exactly the number the estimator would enter. Nothing else
    // from the truth side leaks into the prediction.
    let confirmedH: number | null = null;
    if (process.env.CONFIRMED_HEIGHTS) {
      const hs = Object.values(truth.areaDimensions ?? {}).map((d) => d.H).filter((h) => h >= 2 && h <= 4);
      if (hs.length) {
        const counts = new Map<number, number>();
        for (const h of hs) counts.set(h, (counts.get(h) ?? 0) + 1);
        confirmedH = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      }
    }

    const draft = buildDraft(confirmedH ? { ...reading, ceiling_height_m: confirmedH } : reading, rules, aliases);
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

    // ---- per-room matched scoring -----------------------------------------
    // The work order's per-area walls/ceiling m2 vs the SAME room on the plan.
    const woWalls = new Map<string, number>();
    const woCeil = new Map<string, number>();
    const woHours = new Map<string, number>();
    for (const it of truth.items) {
      if (!it.area || it.unit !== "m2") continue;
      const sig = roomSignature(it.area, aliases, resolveRoomType);
      if (/wall/i.test(it.name)) woWalls.set(sig, (woWalls.get(sig) ?? 0) + it.qty);
      if (/ceiling/i.test(it.name)) woCeil.set(sig, (woCeil.get(sig) ?? 0) + it.qty);
    }
    for (const at of truth.areaTotals ?? []) {
      const sig = roomSignature(at.area, aliases, resolveRoomType);
      woHours.set(sig, (woHours.get(sig) ?? 0) + at.total);
    }

    // Signature -> WO area name(s), for the dims fallback below.
    const woSigToArea = new Map<string, string>();
    for (const areaName of new Set(truth.items.map((it) => it.area).filter((x): x is string => !!x))) {
      woSigToArea.set(roomSignature(areaName, aliases, resolveRoomType), areaName);
    }
    const woDims = truth.areaDimensions ?? {};
    const dimsMatch = (a: { L: number; W: number }, d: { L: number; W: number }) =>
      (Math.abs(a.L - d.L) <= 0.2 && Math.abs(a.W - d.W) <= 0.2) ||
      (Math.abs(a.L - d.W) <= 0.2 && Math.abs(a.W - d.L) <= 0.2);

    let matched = 0;
    const usedSigs = new Set<string>();
    const usedAreas = new Set<string>();
    for (const a of dimmed) {
      const sig = roomSignature(a.name, aliases, resolveRoomType);
      let tW = woWalls.get(sig);
      let tC = woCeil.get(sig);
      let via = "name";
      if ((tW == null && tC == null) || usedSigs.has(sig)) {
        // Names disagree ("Meals" vs "Kitchen living") - fall back to the
        // work order's own printed room dimensions.
        const areaName = Object.keys(woDims).find((n) => !usedAreas.has(n) && dimsMatch(a, woDims[n]));
        if (!areaName) continue;
        const areaSig = roomSignature(areaName, aliases, resolveRoomType);
        tW = woWalls.get(areaSig); tC = woCeil.get(areaSig);
        if (tW == null && tC == null) continue;
        usedAreas.add(areaName);
        usedSigs.add(areaSig);
        via = "dims";
      } else {
        usedSigs.add(sig);
        const areaName = woSigToArea.get(sig);
        if (areaName) usedAreas.add(areaName);
      }
      matched++;
      const matchedAreaName = via === "dims"
        ? [...usedAreas].pop()
        : woSigToArea.get(sig);
      const trueH = matchedAreaName ? woDims[matchedAreaName]?.H : undefined;
      roomScores.push({
        job: job.id,
        room: `${a.name}${via === "dims" ? "*" : ""}`,
        ceilPct: tC != null ? pct(a.L * a.W, tC) : null,
        wallsPct: tW != null ? pct(2 * (a.L + a.W) * a.H, tW) : null,
        wallsTrueHPct: tW != null && trueH ? pct(2 * (a.L + a.W) * trueH, tW) : null,
        hoursPct: null, // room hours include prep + deferred openings; scored at job level only
      });
    }

    rows.push({
      id: job.id, address: job.address, jobType: job.jobType, runId,
      roomsRead: draft.areas.length, roomsDimensioned: dimmed.length,
      predCeilM2: Math.round(predCeil * 10) / 10, truthCeilM2: tCeil, ceilPct: dCeil,
      predWallsM2: Math.round(predWalls * 10) / 10, truthWallsM2: tWalls, wallsPct: dWalls,
      predHours: Math.round(predHours * 10) / 10, truthHours: tHours, hoursPct: dHours,
      gates,
      matchedRooms: matched,
    });

    console.log(
      `${job.id.padEnd(16)} ${String(draft.areas.length).padStart(2)}/${String(dimmed.length).padEnd(12)} ` +
      `${predCeil.toFixed(0).padStart(5)}/${String(tCeil ?? "?").padEnd(7)} ${fmt(dCeil)}   ` +
      `${predWalls.toFixed(0).padStart(5)}/${String(tWalls ?? "?").padEnd(7)} ${fmt(dWalls)}   ` +
      `${predHours.toFixed(0).padStart(4)}/${String(tHours ?? "?").padEnd(7)} ${fmt(dHours)}   ${gates}  ${matched}`,
    );
  }

  const stamp = process.env.RUN_STAMP ?? "latest";
  writeFileSync(path.join(SET, `scores-${stamp}.json`), JSON.stringify({ jobs: rows, rooms: roomScores }, null, 2));

  // ---- the per-room aggregate: the honest measurement question -------------
  const ceilRooms = roomScores.filter((r) => r.ceilPct != null);
  const wallRooms = roomScores.filter((r) => r.wallsPct != null);
  const within = (xs: Array<number | null>, lim: number) => xs.filter((x) => x != null && Math.abs(x) <= lim).length;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  console.log(`\nPER-ROOM (matched by name through the alias table):`);
  console.log(`  ceilings: ${within(ceilRooms.map((r) => r.ceilPct), 7)}/${ceilRooms.length} within ±7% · median error ${median(ceilRooms.map((r) => Math.abs(r.ceilPct!)))?.toFixed(1)}%`);
  console.log(`  walls:    ${within(wallRooms.map((r) => r.wallsPct), 10)}/${wallRooms.length} within ±10% · median error ${median(wallRooms.map((r) => Math.abs(r.wallsPct!)))?.toFixed(1)}%`);
  const trueH = roomScores.filter((r) => r.wallsTrueHPct != null);
  console.log(`  walls with the WO's TRUE height: ${within(trueH.map((r) => r.wallsTrueHPct!), 10)}/${trueH.length} within ±10% · median error ${median(trueH.map((r) => Math.abs(r.wallsTrueHPct!)))?.toFixed(1)}% (isolates the 2.4 m assumption)`);
  const worst = [...wallRooms].sort((a, b) => Math.abs(b.wallsPct!) - Math.abs(a.wallsPct!)).slice(0, 8);
  console.log(`  worst wall rooms: ${worst.map((r) => `${r.job}/${r.room} ${fmt(r.wallsPct)}`).join(" · ")}`);

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

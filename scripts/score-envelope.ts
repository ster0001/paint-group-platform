/**
 * E2's scorer: the exterior envelope pipeline against PaintScout work-order
 * truth (the exterior corpus — master plan Step 6).
 *
 *   Predicted wall m² (computeEnvelope over elevation-photo reads, with
 *   site-plan widths merged in) vs the work order's Walls total, and
 *   predicted trim lineal m vs the "m" total. Gate band: walls ±10%.
 *
 * Honest constraints, stated up front:
 *   - Only jobs with FACADE PHOTOS on disk can be scored — the envelope
 *     never derives from interior rooms (the rejected heuristic), so a job
 *     with only a floorplan defers to a site check BY DESIGN. The script
 *     lists exactly which photos are missing so Tom can supply them
 *     (2494 / 3109 / hutton48 / lombardy46-ext are the clean, no-brick
 *     candidates with per-elevation truth).
 *   - Brick jobs (cotham7-175, most of 2954) can never fully auto-price:
 *     there is deliberately no brick rate item.
 *   - Each photo read is a real Opus vision call (a few cents each).
 *
 *   npx tsx scripts/score-envelope.ts             # score every scoreable job
 *   JOB_IDS=rae276 npx tsx scripts/score-envelope.ts
 *
 * Reads ANTHROPIC_API_KEY from .env.local; needs no dev server and no login
 * (pure lib calls, nothing written to the database).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mergeSitePlanWidths, readElevationPhoto, readFloorplanFootprint, readSitePlan, type SitePlanRead } from "../lib/extract/elevation.ts";
import { computeEnvelope, type ElevationRead } from "../lib/extract/exterior.ts";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
const SET = path.join(ROOT, "regression-set");

for (const [k, v] of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()] as const)) {
  if (!process.env[k]) process.env[k] = v;
}

type ManifestJob = {
  id: string; address: string; plan: string | null; jobType: string;
  photos?: string[]; sitePlan?: string | null; ignored?: boolean; note?: string;
};
type WoTruth = {
  key: string;
  totalHours: number | null;
  totalDimensions: Record<string, number>;
  items: Array<{ area: string | null; name: string; qty: number; unit: string; hours: number | null }>;
};

const pct = (pred: number, truth: number) => (truth > 0 ? ((pred - truth) / truth) * 100 : null);
const fmt = (p: number | null) => (p == null ? "   n/a" : `${p >= 0 ? "+" : ""}${p.toFixed(0).padStart(4)}%`);

const CLADDING = /weatherboard|render|stucco|cement sheet|colorbond|brick/i;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not in .env.local — the elevation reader needs it.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(path.join(SET, "manifest.json"), "utf8")) as { jobs: ManifestJob[] };
  const truths = JSON.parse(readFileSync(path.join(SET, "work-order-truth.json"), "utf8")) as WoTruth[];
  const truthByKey = new Map(truths.map((t) => [t.key, t]));
  const only = process.env.JOB_IDS?.split(",").map((s) => s.trim());

  // Exterior corpus = manifest exteriors + jobs whose truth is exterior-shaped.
  const exteriorJobs = manifest.jobs.filter((j) => {
    if (j.ignored) return false;
    if (only && !only.includes(j.id)) return false;
    const t = truthByKey.get(j.id);
    if (!t) return false;
    return j.jobType === "exterior"
      || (t.totalDimensions["Ceiling"] == null && t.items.some((i) => CLADDING.test(i.name)));
  });

  const stamp = process.env.RUN_STAMP ?? new Date().toISOString().slice(0, 10);
  const results: Array<Record<string, unknown>> = [];
  const missingPhotos: string[] = [];
  let totalCostCents = 0;

  console.log("job              photos  elevations(read/measured)  walls m2 pred/truth      lineal m pred/truth    gate(W)  site-check flags");

  for (const job of exteriorJobs) {
    const truth = truthByKey.get(job.id)!;
    const photoPaths = (job.photos ?? [])
      .map((p) => (path.isAbsolute(p) ? p : path.join(SET, p)))
      .filter((p) => existsSync(p));

    if (photoPaths.length === 0) {
      missingPhotos.push(`${job.id} (${job.address}) — truth walls ${truth.totalDimensions["Walls"] ?? "?"} m²`);
      continue;
    }

    const reads: ElevationRead[] = [];
    let readCost = 0;
    for (const p of photoPaths) {
      const r = await readElevationPhoto(new Uint8Array(readFileSync(p)));
      if (r.ok) { reads.push(r.read); readCost += r.costCents; }
      else console.log(`  ${job.id}: photo ${path.basename(p)} failed — ${r.message}`);
    }

    let sitePlan: SitePlanRead | null = null;
    const sitePlanPath = job.sitePlan ? path.join(SET, job.sitePlan) : null;
    if (sitePlanPath && existsSync(sitePlanPath)) {
      const r = await readSitePlan(new Uint8Array(readFileSync(sitePlanPath)));
      if (r.ok) { sitePlan = r.read; readCost += r.costCents; }
    }
    // Rule 2 (Tom's ruling 19 Aug): no dedicated site plan → derive the edge
    // widths from the floorplan's printed room dimensions. Flagged for a
    // human check in production; scored here to learn how accurate it is.
    const planPath = job.plan ? path.join(SET, job.plan) : null;
    if (!sitePlan && planPath && existsSync(planPath) && !planPath.endsWith(".avif")) {
      const r = await readFloorplanFootprint(new Uint8Array(readFileSync(planPath)));
      if (r.ok) { sitePlan = r.read; readCost += r.costCents; }
      else console.log(`  ${job.id}: footprint read failed — ${r.message}`);
    }
    totalCostCents += readCost;

    const env = computeEnvelope(mergeSitePlanWidths(reads, sitePlan));
    const predWalls = env.elevations.reduce(
      (n, e) => n + e.surfaces.reduce((m, s) => m + (s.m2 ?? 0), 0), 0);
    const predLineal = env.elevations.reduce(
      (n, e) => n + e.surfaces.reduce((m, s) => m + (s.linealM ?? 0), 0), 0);
    const measured = env.elevations.filter((e) => e.surfaces.some((s) => s.m2)).length;

    const truthWalls = truth.totalDimensions["Walls"] ?? 0;
    const truthLineal = truth.totalDimensions["m"] ?? 0;
    const wallsPct = pct(predWalls, truthWalls);
    const gate = wallsPct == null ? "-" : Math.abs(wallsPct) <= 10 ? "PASS" : "fail";

    // Per-elevation comparison — the honest metric when only some sides are
    // photographed: the work order records each side's cladding separately.
    const SIDE_OF: Array<[RegExp, string]> = [
      [/front/i, "front"], [/left/i, "left"], [/right/i, "right"], [/back|rear/i, "rear"],
    ];
    const truthBySide = new Map<string, number>();
    for (const item of truth.items) {
      if (item.unit !== "m2" || !CLADDING.test(item.name) || !item.area) continue;
      const side = SIDE_OF.find(([re]) => re.test(item.area!))?.[1];
      if (side) truthBySide.set(side, (truthBySide.get(side) ?? 0) + item.qty);
    }
    const perElevation: Array<{ side: string; predM2: number; truthM2: number; pctErr: number | null }> = [];
    for (const e of env.elevations) {
      const predM2 = e.surfaces.reduce((m, s) => m + (s.m2 ?? 0), 0);
      const truthM2 = truthBySide.get(e.name);
      if (predM2 > 0 && truthM2 != null) {
        const err = pct(predM2, truthM2);
        perElevation.push({ side: e.name, predM2: Math.round(predM2 * 10) / 10, truthM2, pctErr: err });
        console.log(`                   side ${e.name.padEnd(6)} pred ${predM2.toFixed(0).padStart(4)} / truth ${String(truthM2).padStart(4)} m²  ${fmt(err)}`);
      }
    }

    console.log(
      `${job.id.padEnd(16)} ${String(photoPaths.length).padStart(4)}    ${reads.length}/${measured}`.padEnd(45)
      + ` ${predWalls.toFixed(0).padStart(5)}/${String(truthWalls).padStart(5)} ${fmt(wallsPct)}`
      + `   ${predLineal.toFixed(0).padStart(5)}/${String(truthLineal).padStart(5)} ${fmt(pct(predLineal, truthLineal))}`
      + `   ${gate.padEnd(5)}  ${env.requiresSiteCheck.length}`,
    );
    for (const s of env.requiresSiteCheck) console.log(`                   · ${s}`);

    results.push({
      id: job.id, address: job.address, photos: photoPaths.length,
      elevationsRead: reads.length, elevationsMeasured: measured,
      predWallsM2: Math.round(predWalls * 10) / 10, truthWallsM2: truthWalls, wallsPct,
      predLinealM: Math.round(predLineal * 10) / 10, truthLinealM: truthLineal,
      perElevation,
      requiresSiteCheck: env.requiresSiteCheck, costCents: readCost,
      reads, sitePlan,
    });
  }

  if (missingPhotos.length) {
    console.log("\nNOT SCOREABLE — no facade photos on disk (the envelope never derives from the floorplan alone):");
    for (const m of missingPhotos) console.log(`  ${m}`);
    console.log("Add photo paths to the job's \"photos\" array in regression-set/manifest.json to score them.");
  }

  const scored = results.filter((r) => typeof r.wallsPct === "number");
  const passed = scored.filter((r) => Math.abs(r.wallsPct as number) <= 10).length;
  const sides = results.flatMap((r) => (r.perElevation as Array<{ pctErr: number | null }>) ?? []);
  const sidesIn = sides.filter((s) => s.pctErr != null && Math.abs(s.pctErr) <= 10).length;
  console.log(`\n${scored.length} scored whole-job, ${passed} within ±10% walls`);
  console.log(`per photographed side: ${sidesIn}/${sides.length} within ±10%`);
  console.log(`${missingPhotos.length} awaiting photos · model cost ${totalCostCents}c`);

  const out = path.join(SET, `envelope-scores-${stamp}.json`);
  writeFileSync(out, JSON.stringify({ stamp, results, missingPhotos }, null, 2));
  console.log(`written: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

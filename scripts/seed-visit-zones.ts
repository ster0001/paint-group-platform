/**
 * Visit zones — build the suburb review list, then seed it (addendum A, S1).
 *
 *   npx tsx scripts/seed-visit-zones.ts build <path-to-australian_postcodes.csv>
 *       Reads Matthew Proctor's Australian postcodes dataset (CC0 1.0, public
 *       domain — https://www.matthewproctor.com/australian_postcodes), keeps
 *       Victorian "Delivery Area" localities with a 3xxx postcode, tests each
 *       locality's precise centre point against the approved outlines in
 *       docs/briefs/data/visit-zones-draft2.geojson (features in ascending
 *       priority, first hit wins, no hit = out of area), then applies
 *       docs/briefs/data/visit-zones-suburb-rulings.csv — the CSV always wins.
 *       Writes docs/briefs/data/visit-zones-review.csv for Tom and PRINTS every
 *       suburb where the outline and the CSV disagree. Nothing is picked quietly.
 *
 *   npx tsx scripts/seed-visit-zones.ts seed            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-visit-zones.ts seed --prod
 *       Upserts the review CSV into visit_suburbs. Idempotent on suburb +
 *       postcode. A row Tom has already REVIEWED in Settings is left alone
 *       unless --force is given, so a re-seed never undoes his changes.
 *
 * Target rule (seed-scripts-target): the test project by default, production
 * only with --prod AND SEED_ALLOW_PRODUCTION=1, and the resolved project ref is
 * printed before anything is written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { classifyPoint, isZoneStatus, type ZoneCollection, type ZoneStatus } from "../lib/visits/zoneGeo";
import { normaliseSuburb } from "../lib/visits/zones";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const GEOJSON = resolve(ROOT, "docs/briefs/data/visit-zones-draft2.geojson");
const RULINGS = resolve(ROOT, "docs/briefs/data/visit-zones-suburb-rulings.csv");
export const REVIEW = resolve(ROOT, "docs/briefs/data/visit-zones-review.csv");

// ---- CSV ---------------------------------------------------------------------

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function readCsv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim().length);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const csvCell = (s: string | number | boolean | null) => {
  const v = s == null ? "" : String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

// ---- build ---------------------------------------------------------------------

export type ReviewRow = {
  suburb: string; postcode: string; lat: number; lng: number;
  outline_status: ZoneStatus; outline_part: string;
  proposed_status: ZoneStatus; far_edge: boolean; reviewed: boolean; basis: string;
  disagreement: string;
};

export function buildReview(datasetPath: string): { rows: ReviewRow[]; disagreements: ReviewRow[]; multi: string[]; missing: string[] } {
  const zones = JSON.parse(readFileSync(GEOJSON, "utf8")) as ZoneCollection;
  const raw = readCsv(datasetPath);
  const vic = raw.filter((r) => r.state === "VIC" && r.type === "Delivery Area" && /^3\d{3}$/.test(r.postcode));

  // One row per suburb + postcode (the dataset repeats a few).
  const seen = new Set<string>();
  const rows: ReviewRow[] = [];
  for (const r of vic) {
    const key = `${normaliseSuburb(r.locality)}|${r.postcode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lat = Number(r.Lat_precise || r.lat), lng = Number(r.Long_precise || r.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const hit = classifyPoint([lng, lat], zones);
    rows.push({
      suburb: titleCase(r.locality), postcode: r.postcode, lat, lng,
      outline_status: hit.status, outline_part: hit.part ?? "",
      proposed_status: hit.status, far_edge: false, reviewed: false,
      basis: hit.status === "out_of_area" && !hit.part ? "outline:no_hit" : `outline:${hit.part ?? hit.status}`,
      disagreement: "",
    });
  }

  // The rulings CSV wins. It has no postcode column, so it joins by name.
  const rulings = readCsv(RULINGS);
  const byName = new Map<string, ReviewRow[]>();
  for (const row of rows) {
    const k = normaliseSuburb(row.suburb);
    const list = byName.get(k) ?? [];
    list.push(row);
    byName.set(k, list);
  }
  const disagreements: ReviewRow[] = [];
  const multi: string[] = [];
  const missing: string[] = [];
  for (const rule of rulings) {
    const status = rule.expected_status;
    if (!isZoneStatus(status)) throw new Error(`rulings CSV: unknown status "${status}" for ${rule.suburb}`);
    const candidates = byName.get(normaliseSuburb(rule.suburb)) ?? [];
    if (!candidates.length) { missing.push(rule.suburb); continue; }
    // Several postcodes carry this name: the ruling applies to the ones the
    // outline put somewhere (inside any drawn part); a same-named locality far
    // away stays as the outline said, and the case is reported.
    let targets = candidates;
    if (candidates.length > 1) {
      // None inside any outline (Hillside 3037 near Sydenham vs Hillside 3875
      // in Gippsland): the one nearest the Melbourne GPO is the one Tom meant.
      const inside = candidates.filter((c) => c.outline_part !== "");
      targets = inside.length ? inside : [candidates.reduce((best, c) => (distToCbd(c) < distToCbd(best) ? c : best))];
      multi.push(`${rule.suburb}: ${candidates.map((c) => `${c.postcode}=${c.outline_status}`).join(", ")} → ruling applied to ${targets.map((t) => t.postcode).join("/")}`);
    }
    for (const t of targets) {
      const agree = t.outline_status === status;
      t.proposed_status = status;
      t.far_edge = rule.far_edge.trim() === "proposed";
      t.reviewed = true;
      t.basis = rule.basis;
      if (!agree) {
        t.disagreement = `outline said ${t.outline_status}, CSV says ${status}`;
        disagreements.push(t);
      }
    }
  }
  rows.sort((a, b) => a.suburb.localeCompare(b.suburb) || a.postcode.localeCompare(b.postcode));
  return { rows, disagreements, multi, missing };
}

/** Squared degrees from the Melbourne GPO — only ever compared, never shown. */
function distToCbd(r: { lat: number; lng: number }): number {
  return (r.lat + 37.8136) ** 2 + (r.lng - 144.9631) ** 2;
}

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c) => `Mc${c.toUpperCase()}`);
}

export function writeReview(rows: ReviewRow[]): void {
  const header = ["suburb", "postcode", "lat", "lng", "outline_status", "outline_part", "proposed_status", "far_edge", "reviewed", "basis", "disagreement"];
  const body = rows.map((r) => header.map((h) => csvCell((r as unknown as Record<string, string | number | boolean>)[h])).join(","));
  writeFileSync(REVIEW, [header.join(","), ...body].join("\n") + "\n");
}

export function readReview(): ReviewRow[] {
  return readCsv(REVIEW).map((r) => {
    if (!isZoneStatus(r.proposed_status) || !isZoneStatus(r.outline_status)) throw new Error(`review CSV: bad status on ${r.suburb} ${r.postcode}`);
    return {
      suburb: r.suburb, postcode: r.postcode, lat: Number(r.lat), lng: Number(r.lng),
      outline_status: r.outline_status, outline_part: r.outline_part,
      proposed_status: r.proposed_status, far_edge: r.far_edge === "true", reviewed: r.reviewed === "true",
      basis: r.basis, disagreement: r.disagreement,
    };
  });
}

// ---- seed ---------------------------------------------------------------------

async function seed(prod: boolean, force: boolean) {
  const { loadTestEnv, refuseProduction, parseEnvFile } = await import("./c1/env.mjs");
  let url: string | undefined, key: string | undefined;
  if (prod) {
    if (process.env.SEED_ALLOW_PRODUCTION !== "1") {
      console.error("REFUSED: --prod needs SEED_ALLOW_PRODUCTION=1 — Tom runs this himself.");
      process.exit(1);
    }
    const env = parseEnvFile(resolve(ROOT, ".env.local")) as Record<string, string>;
    url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    loadTestEnv();
    url = process.env.NEXT_PUBLIC_SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    refuseProduction(url ?? "");
  }
  if (!url || !key) { console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
  console.log(`target: ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? url} (${prod ? "PRODUCTION" : "test"})`);

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const rows = readReview();
  const { data: existing, error } = await db.from("visit_suburbs").select("suburb, postcode, reviewed").limit(10000);
  if (error) { console.error(`visit_suburbs read failed: ${error.message} — is migration 20270212 applied?`); process.exit(1); }
  const keep = new Set((existing ?? []).filter((r) => r.reviewed && !force).map((r) => `${normaliseSuburb(r.suburb as string)}|${r.postcode}`));
  const payload = rows
    .filter((r) => !keep.has(`${normaliseSuburb(r.suburb)}|${r.postcode}`))
    .map((r) => ({ suburb: r.suburb, postcode: r.postcode, status: r.proposed_status, far_edge: r.far_edge, reviewed: r.reviewed, basis: r.basis, lat: r.lat, lng: r.lng, updated_at: new Date().toISOString() }));
  let written = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const slice = payload.slice(i, i + 500);
    const { error: upErr } = await db.from("visit_suburbs").upsert(slice, { onConflict: "suburb,postcode" });
    if (upErr) {
      // The unique key is an expression index, which PostgREST cannot name in
      // onConflict — fall back to delete-then-insert per slice.
      for (const row of slice) {
        const { error: delErr } = await db.from("visit_suburbs").delete().ilike("suburb", normaliseSuburb(row.suburb)).eq("postcode", row.postcode);
        if (delErr) { console.error(`delete ${row.suburb} ${row.postcode}: ${delErr.message}`); process.exit(1); }
      }
      const { error: insErr } = await db.from("visit_suburbs").insert(slice);
      if (insErr) { console.error(`insert failed: ${insErr.message}`); process.exit(1); }
    }
    written += slice.length;
  }
  const { count } = await db.from("visit_suburbs").select("id", { count: "exact", head: true });
  console.log(`seeded ${written} rows (${rows.length - payload.length} reviewed rows left alone); visit_suburbs now holds ${count ?? "?"} rows`);
}

// ---- main ---------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "build") {
  const src = rest.find((a) => !a.startsWith("--"));
  if (!src) { console.error("build needs the path to australian_postcodes.csv"); process.exit(1); }
  const { rows, disagreements, multi, missing } = buildReview(resolve(src));
  writeReview(rows);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.proposed_status] = (counts[r.proposed_status] ?? 0) + 1;
  console.log(`wrote ${REVIEW}: ${rows.length} suburb+postcode rows`);
  console.log("proposed status counts:", counts);
  console.log(`far-edge rows: ${rows.filter((r) => r.far_edge).length}; reviewed (from CSV): ${rows.filter((r) => r.reviewed).length}`);
  if (missing.length) console.log(`\nCSV suburbs NOT in the dataset (${missing.length}):\n  ${missing.join(", ")}`);
  if (multi.length) console.log(`\nCSV names carried by more than one postcode (${multi.length}):\n  ${multi.join("\n  ")}`);
  console.log(`\nOutline vs CSV disagreements (${disagreements.length}) — the CSV was applied, each is listed for Tom:`);
  for (const d of disagreements) console.log(`  ${d.suburb} ${d.postcode}: ${d.disagreement} (${d.basis})`);
} else if (cmd === "seed") {
  seed(rest.includes("--prod"), rest.includes("--force")).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error("usage: seed-visit-zones.ts build <dataset.csv> | seed [--prod] [--force]");
  process.exit(1);
}

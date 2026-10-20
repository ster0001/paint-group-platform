/**
 * Suppliers seed — Movements Session 1 (brief §3.1, ruling 5, ⚑13).
 *
 *   set -a; source .env.test.local; set +a; npx tsx scripts/seed-suppliers.ts   # TEST project
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-suppliers.ts                   # production, Tom only
 *
 * Reads docs/briefs/data/suppliers-seed.csv (69 rows) and writes:
 *   · vendors — one per brand, by name (never duplicated; an existing vendor is reused),
 *   · supplier_branches — one per (brand, branch), case-insensitively; lat/lng from the
 *     visit_suburbs centroid of the row's suburb (Session 0: all 53 suburbs have one — a
 *     miss is PRINTED, never guessed),
 *   · delivers_to_site = the CSV cell starts with "yes"; opens_weekday = HH:MM or null,
 *   · active = false for every row whose confidence starts with UNVERIFIED (⚑13: Tom fills
 *     the address in Settings before it comes on).
 * It NEVER touches supplier_branch_accounts — trade account numbers are typed in Settings.
 *
 * Idempotent: a re-run updates the CSV columns on each branch and leaves favourite,
 * map_place_id and email alone (those are Settings' — Tom's edits survive a re-seed).
 *
 * Target rule: scripts/seed-target.mjs — the environment wins, .env.local is the bare
 * fallback, production refuses without SEED_ALLOW_PRODUCTION=1, and a target the guard
 * cannot name refuses too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BRANCH_KINDS, type BranchKind } from "../lib/movements/types";
import { fetchAllRows } from "../lib/supabase/fetchAllRows";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
export const CSV = resolve(ROOT, "docs/briefs/data/suppliers-seed.csv");

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
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

export type BranchSeed = {
  brand: string; branch: string; kind: BranchKind; address: string; suburb: string; postcode: string; phone: string;
  opens_weekday: string | null; delivers_to_site: boolean; source_url: string; notes: string; active: boolean;
};

/** One CSV row → the branch row the database takes. Throws on a kind it does not know. */
export function toBranch(r: Record<string, string>): BranchSeed {
  const kind = (r.kind || "paint").toLowerCase();
  if (!(BRANCH_KINDS as readonly string[]).includes(kind)) throw new Error(`${r.brand} ${r.branch}: unknown kind "${r.kind}"`);
  const opens = r.opens_weekday.match(/^(\d{1,2}):(\d{2})$/);
  const confidence = r.confidence || "";
  const delivers = /^yes/i.test(r.delivers_to_site);
  const deliveryNote = delivers ? r.delivers_to_site.replace(/^yes\s*/i, "").replace(/^\((.*)\)$/, "$1").trim() : "";
  const notes = [confidence && !/^verified$/i.test(confidence) ? confidence : "", deliveryNote].filter(Boolean).join(" · ");
  return {
    brand: r.brand, branch: r.branch, kind: kind as BranchKind, address: r.address, suburb: r.suburb, postcode: r.postcode, phone: r.phone,
    opens_weekday: opens ? `${opens[1].padStart(2, "0")}:${opens[2]}` : null,
    delivers_to_site: delivers, source_url: r.source_url, notes: notes.slice(0, 500),
    active: !/^UNVERIFIED/i.test(confidence),
  };
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

async function main() {
  const { resolveSeedTarget } = (await import("./seed-target.mjs")) as unknown as {
    resolveSeedTarget: (name: string) => { url: string; serviceKey?: string; ref: string; isProduction: boolean };
  };
  const target = resolveSeedTarget("seed-suppliers");
  if (!target.serviceKey) { console.error("seed-suppliers: no SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
  const db: SupabaseClient = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const rows = readCsv(CSV).map(toBranch);
  console.log(`${rows.length} branch rows in ${CSV.replace(ROOT + "/", "")}`);

  // Centroids: paged past the PostgREST row cap (3,482 suburbs), matched by suburb
  // (case-insensitive). A miss is printed.
  let suburbs: { suburb: string; postcode: string; lat: number | null; lng: number | null }[];
  try {
    suburbs = await fetchAllRows((from, to) => db.from("visit_suburbs").select("suburb, postcode, lat, lng").order("id").range(from, to));
  } catch (e) {
    console.error(`visit_suburbs read failed: ${e instanceof Error ? e.message : String(e)} — is migration 20270212 applied?`); process.exit(1);
  }
  const centroid = new Map<string, { lat: number | null; lng: number | null }>();
  for (const s of suburbs) {
    centroid.set(`${norm(s.suburb)}|${s.postcode}`, { lat: s.lat, lng: s.lng });
    if (!centroid.has(norm(s.suburb))) centroid.set(norm(s.suburb), { lat: s.lat, lng: s.lng });
  }

  // Vendors by brand.
  const { data: vendors, error: vErr } = await db.from("vendors").select("id, name").limit(5000);
  if (vErr) { console.error(`vendors read failed: ${vErr.message}`); process.exit(1); }
  const vendorByName = new Map((vendors ?? []).map((v) => [norm(String(v.name)), String(v.id)] as const));
  for (const brand of [...new Set(rows.map((r) => r.brand))]) {
    if (vendorByName.has(norm(brand))) continue;
    const kind = rows.find((r) => r.brand === brand)!.kind;
    const { data, error } = await db.from("vendors").insert({ name: brand, default_category: kind === "hire" ? "equipment_hire" : "materials" }).select("id").single();
    if (error) { console.error(`vendor ${brand}: ${error.message}`); process.exit(1); }
    vendorByName.set(norm(brand), String((data as { id: string }).id));
    console.log(`  vendor created: ${brand}`);
  }

  const { data: existing, error: eErr } = await db.from("supplier_branches").select("id, brand, branch").limit(5000);
  if (eErr) { console.error(`supplier_branches read failed: ${eErr.message} — is migration 20270279 applied?`); process.exit(1); }
  const byKey = new Map((existing ?? []).map((b) => [`${norm(String(b.brand))}|${norm(String(b.branch))}`, String(b.id)] as const));

  let created = 0, updated = 0;
  const misses: string[] = [];
  for (const r of rows) {
    const c = centroid.get(`${norm(r.suburb)}|${r.postcode}`) ?? centroid.get(norm(r.suburb));
    if (!c || c.lat == null) misses.push(`${r.brand} ${r.branch} (${r.suburb} ${r.postcode})`);
    const payload = {
      vendor_id: vendorByName.get(norm(r.brand)) ?? null,
      brand: r.brand, branch: r.branch, kind: r.kind, address: r.address, suburb: r.suburb, postcode: r.postcode, phone: r.phone,
      lat: c?.lat ?? null, lng: c?.lng ?? null, delivers_to_site: r.delivers_to_site, opens_weekday: r.opens_weekday,
      active: r.active, source_url: r.source_url, notes: r.notes,
    };
    const id = byKey.get(`${norm(r.brand)}|${norm(r.branch)}`);
    if (id) {
      const { error } = await db.from("supplier_branches").update(payload).eq("id", id);
      if (error) { console.error(`update ${r.brand} ${r.branch}: ${error.message}`); process.exit(1); }
      updated++;
    } else {
      const { error } = await db.from("supplier_branches").insert(payload);
      if (error) { console.error(`insert ${r.brand} ${r.branch}: ${error.message}`); process.exit(1); }
      created++;
    }
  }
  const inactive = rows.filter((r) => !r.active).map((r) => `${r.brand} ${r.branch}`);
  console.log(`done: ${created} created, ${updated} updated, ${inactive.length} inactive (${inactive.join(", ") || "none"})`);
  if (misses.length) console.log(`no centroid for ${misses.length} row(s) — lat/lng left null:\n  ${misses.join("\n  ")}`);
  console.log("supplier_branch_accounts untouched — account numbers go in Settings → Suppliers.");
}

if (process.argv[1] && /seed-suppliers\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

/**
 * Equipment register seed — Movements Session 1 (brief §3.1, rulings 1 and 18, ⚑12).
 *
 *   EQUIPMENT_SEED_CONFIRMED=1 npx tsx scripts/seed-equipment.ts                 # TEST project
 *   EQUIPMENT_SEED_CONFIRMED=1 SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-equipment.ts
 *
 * REFUSES without EQUIPMENT_SEED_CONFIRMED=1: docs/briefs/data/equipment-seed-template.csv
 * is a TEMPLATE until Tom replaces its rows with the real inventory (⚑12), and a register
 * seeded from placeholder rows would put twelve phantom ladders on the Gear view.
 *
 * The CSV's categories (sprayer · ladder · sander · scaffold · trestles · exterior) are not
 * the enum's nine types, so each row is mapped BY NAME (Session 0 report item 9.1):
 *   Step ladder → step_ladder · Extension ladder < 8 m → ext_ladder_7 · ≥ 8 m → ext_ladder_10
 *   Platform ladder → platform_ladder · sprayer / spray gun / airless → spray_gun
 *   Planex / sander → planex_sander · dust extractor / vacuum → festool_vacuum
 *   scaffold → mobile_scaffold · harness / fall protection → fall_protection
 *   trestles / pressure washer → other
 * A row the map cannot place REFUSES the whole run and lists the row. A CSV category that
 * is already one of the nine enum values is taken as is (Tom may write the real list in
 * enum terms).
 *
 * Idempotent by tag: a re-run updates name / category / model / notes on the same tag and
 * never changes an item's status or any movement. Rows with a blank tag get the next free
 * E-### from the database (equipment_item_create's rule), never a tag made up here.
 */
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EQUIPMENT_CATEGORIES, type EquipmentCategory } from "../lib/movements/types";
import { readCsv } from "./seed-suppliers";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
export const CSV = resolve(ROOT, "docs/briefs/data/equipment-seed-template.csv");

export type EquipmentSeed = { tag: string | null; name: string; category: EquipmentCategory; serial_or_model: string; notes: string };

/** The by-name map. Null when nothing fits — the caller refuses. */
export function categoryFor(name: string, csvCategory: string): EquipmentCategory | null {
  const c = csvCategory.trim().toLowerCase();
  if ((EQUIPMENT_CATEGORIES as readonly string[]).includes(c)) return c as EquipmentCategory;
  const n = name.toLowerCase();
  if (/step ladder/.test(n)) return "step_ladder";
  if (/platform ladder/.test(n)) return "platform_ladder";
  if (/extension ladder|ext\.? ladder/.test(n)) {
    const m = n.match(/(\d+(?:\.\d+)?)\s*m\b/);
    const metres = m ? Number(m[1]) : 0;
    return metres >= 8 ? "ext_ladder_10" : "ext_ladder_7";
  }
  if (/sprayer|spray gun|airless/.test(n)) return "spray_gun";
  if (/planex|sander/.test(n)) return "planex_sander";
  if (/dust extractor|vacuum/.test(n)) return "festool_vacuum";
  if (/scaffold/.test(n)) return "mobile_scaffold";
  if (/harness|fall protection|lanyard/.test(n)) return "fall_protection";
  if (/trestle|pressure washer/.test(n)) return "other";
  return null;
}

export function toItems(rows: Array<Record<string, string>>): { items: EquipmentSeed[]; unmapped: string[] } {
  const items: EquipmentSeed[] = [];
  const unmapped: string[] = [];
  rows.forEach((r, i) => {
    const cat = categoryFor(r.name ?? "", r.category ?? "");
    if (!cat) { unmapped.push(`row ${i + 2}: ${r.tag || "(no tag)"} ${r.name} [${r.category}]`); return; }
    items.push({ tag: r.tag?.trim() || null, name: r.name.trim(), category: cat, serial_or_model: (r.serial_or_model ?? "").trim(), notes: (r.notes ?? "").trim() });
  });
  return { items, unmapped };
}

async function main() {
  if (process.env.EQUIPMENT_SEED_CONFIRMED !== "1") {
    console.error(
      "\nREFUSED: EQUIPMENT_SEED_CONFIRMED is not 1.\n\n" +
      "docs/briefs/data/equipment-seed-template.csv is a template (brief ⚑12). Replace its rows\n" +
      "with the real register first, then confirm on purpose:\n\n" +
      "    EQUIPMENT_SEED_CONFIRMED=1 npx tsx scripts/seed-equipment.ts\n",
    );
    process.exit(1);
  }
  const { resolveSeedTarget } = (await import("./seed-target.mjs")) as unknown as {
    resolveSeedTarget: (name: string) => { url: string; serviceKey?: string; ref: string; isProduction: boolean };
  };
  const target = resolveSeedTarget("seed-equipment");
  if (!target.serviceKey) { console.error("seed-equipment: no SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
  const db: SupabaseClient = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { items, unmapped } = toItems(readCsv(CSV));
  if (unmapped.length) {
    console.error(`\nREFUSED: ${unmapped.length} row(s) map to no register type (step_ladder, ext_ladder_7, ext_ladder_10, platform_ladder, spray_gun, planex_sander, festool_vacuum, mobile_scaffold, fall_protection, other):\n  ${unmapped.join("\n  ")}\n\nName them so the map can place them, or write the category column in enum terms. Nothing was written.`);
    process.exit(1);
  }
  const tags = items.map((i) => i.tag).filter((t): t is string => !!t);
  const dup = tags.find((t, i) => tags.indexOf(t) !== i);
  if (dup) { console.error(`REFUSED: tag ${dup} appears twice in the CSV.`); process.exit(1); }

  const { data: existing, error } = await db.from("equipment_items").select("id, tag").limit(5000);
  if (error) { console.error(`equipment_items read failed: ${error.message} — is migration 20270279 applied?`); process.exit(1); }
  const byTag = new Map((existing ?? []).map((e) => [String(e.tag), String(e.id)] as const));

  let created = 0, updated = 0;
  for (const it of items) {
    const base: Record<string, unknown> = { name: it.name, category: it.category, serial_or_model: it.serial_or_model, notes: it.notes };
    const id = it.tag ? byTag.get(it.tag) : undefined;
    if (id) {
      const { error: uErr } = await db.from("equipment_items").update(base).eq("id", id);
      if (uErr) { console.error(`update ${it.tag}: ${uErr.message}`); process.exit(1); }
      updated++;
    } else {
      const { error: iErr } = await db.from("equipment_items").insert(it.tag ? { ...base, tag: it.tag } : base);
      if (iErr) { console.error(`insert ${it.tag ?? it.name}: ${iErr.message}`); process.exit(1); }
      created++;
    }
  }
  console.log(`done: ${created} created, ${updated} updated (${items.length} rows). Status and movements untouched.`);
}

if (process.argv[1] && /seed-equipment\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

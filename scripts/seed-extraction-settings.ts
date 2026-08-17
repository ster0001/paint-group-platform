/**
 * Seed the plan reader's Settings tables (version 1).
 *
 * Loaded over the API, not by pasting SQL — pasted special characters mojibake,
 * and the brief says so explicitly.
 *
 * Idempotent: every table is keyed by (version, ...) with a unique index, so
 * re-running upserts rather than duplicating.
 *
 *   npx tsx scripts/seed-extraction-settings.ts
 *
 * Needs SEED_STAFF_EMAIL / SEED_STAFF_PASSWORD in the environment — these
 * tables are staff-write, and there is no service-role key in this project.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ROOM RULES COME FROM
 *
 * Not from the brief's starting table, and not from guesswork: from the 316
 * interior substrate lines in the 11 briefed PaintScout jobs. Each rule below
 * carries the count of real rooms it was seen in, so a rule that turns out to
 * be wrong can be argued with using the same evidence.
 *
 * TWO PLACES THE EVIDENCE CONTRADICTS THE BRIEF, both left as the evidence has
 * them and both worth Tom's eye:
 *
 *   1. The brief gives bathrooms and kitchens skirting boards. In 11 real jobs,
 *      NO bathroom and NO kitchen was quoted skirting — 5 bathrooms and 4
 *      kitchens, not one skirting line between them. Tiled and kicked surfaces,
 *      presumably. Generating it would pad every wet area.
 *
 *   2. The brief treats cornices as standard everywhere. They appear in only
 *      about two thirds of bedrooms (9 lines across 14 rooms) and are rarer
 *      still elsewhere — plenty of these houses have square-set or no cornice.
 *      So cornice is generated but marked requires_confirm.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const VERSION = 1;

/** surface_type, is_option, requires_confirm, notes (with the evidence count) */
type Rule = [string, boolean, boolean, string];

const SCOPE: Record<string, Rule[]> = {
  bedroom: [
    ["Walls", false, false, "25 lines / 14 rooms"],
    ["Ceiling", false, false, "17 lines"],
    ["Skirting Boards", false, false, "14 lines"],
    ["Door & Frame", false, false, "18 lines incl. panel-door variants"],
    ["Windows", false, false, "11 lines"],
    ["Cornices", false, true, "9 lines / 14 rooms - NOT universal, confirm"],
    ["Architrave", false, true, "3 lines only - usually inside the door line"],
  ],
  living: [
    ["Walls", false, false, "8 lines / 7 rooms"],
    ["Ceiling", false, false, "9 lines"],
    ["Skirting Boards", false, false, "6 lines"],
    ["Door & Frame", false, false, "8 lines incl. variants"],
    ["Windows", false, false, "7 lines"],
    ["Cornices", false, true, "4 lines / 7 rooms - confirm"],
  ],
  dining: [
    ["Walls", false, false, "seen"],
    ["Ceiling", false, false, "seen"],
    ["Skirting Boards", false, false, "seen"],
    ["Windows", false, false, "seen"],
    ["Cornices", false, true, "confirm"],
  ],
  study: [
    ["Walls", false, false, "3 lines / 2 rooms"],
    ["Ceiling", false, false, "3 lines"],
    ["Skirting Boards", false, false, "2 lines"],
    ["Door & Frame", false, false, "4 lines"],
    ["Windows", false, false, "2 lines"],
    ["Cornices", false, true, "1 line - confirm"],
  ],
  hallway: [
    ["Walls", false, false, "13 lines / 8 rooms - the most consistent surface anywhere"],
    ["Ceiling", false, true, "5 lines / 8 rooms - hallway ceilings are often left, confirm"],
    ["Skirting Boards", false, false, "5 lines"],
    ["Door & Frame", false, false, "10 lines incl. variants - hallways carry the most doors"],
    ["Cornices", false, true, "2 lines - confirm"],
  ],
  bathroom: [
    ["Walls", false, false, "7 lines / 5 rooms"],
    ["Ceiling", false, false, "6 lines"],
    ["Door & Frame", false, false, "8 lines incl. variants"],
    ["Cornices", false, true, "3 lines - confirm"],
    // Deliberately NO skirting: not one of 5 bathrooms had it.
  ],
  wc: [
    ["Walls", false, false, "7 lines"],
    ["Ceiling", false, false, "3 lines"],
    ["Door & Frame", false, false, "7 lines incl. variants"],
    ["Cornices", false, true, "3 lines - confirm"],
    ["Skirting Boards", false, true, "2 lines only - confirm"],
  ],
  kitchen: [
    ["Walls", false, false, "5 lines / 4 rooms"],
    ["Ceiling", false, false, "3 lines"],
    ["Door & Frame", false, false, "5 lines incl. variants"],
    ["Architrave", false, true, "2 lines - confirm"],
    ["Cabinets", true, true, "OPTION - never generated silently, priced only if asked for"],
    // Deliberately NO skirting and NO splashback.
  ],
  laundry: [
    ["Walls", false, false, "4 lines / 2 rooms"],
    ["Ceiling", false, false, "2 lines"],
    ["Door & Frame", false, false, "3 lines incl. variants"],
    ["Cornices", false, true, "1 line - confirm"],
  ],
  storage: [
    ["Walls", false, false, "4 lines / 3 rooms (robe, pantry, store, linen)"],
    ["Ceiling", false, false, "5 lines"],
    ["Architrave", false, true, "2 lines - confirm"],
    ["Shelving", true, true, "OPTION"],
  ],
  garage: [
    ["Walls", false, true, "no garage in the 11 jobs - confirm whether it is lined"],
    ["Ceiling", false, true, "confirm whether it is lined"],
  ],
  // 'unknown' deliberately generates nothing: it goes to the review queue.
};

/** Real names seen on these jobs, plus the marketing names from the brief. */
const ALIASES: Array<[string, string]> = [
  ["bed", "bedroom"], ["bedroom", "bedroom"], ["master", "bedroom"], ["main room", "bedroom"],
  ["upper main room", "bedroom"], ["left main room", "bedroom"], ["upstairs bedroom", "bedroom"],
  ["room 1", "bedroom"], ["room 3", "bedroom"], ["room 5", "bedroom"],
  ["living room", "living"], ["living", "living"], ["lounge", "living"], ["sitting", "living"],
  ["upstairs living", "living"], ["play room", "living"], ["rumpus", "living"],
  ["retreat", "living"], ["mpr", "living"], ["family", "living"],
  ["meals", "dining"], ["dining room", "dining"], ["dining kitchen", "dining"], ["dining", "dining"],
  ["kitchen", "kitchen"], ["kitchenette", "kitchen"], ["upper kitchenette", "kitchen"],
  ["bathroom", "bathroom"], ["primary bathroom", "bathroom"], ["bathroom 2", "bathroom"],
  ["ensuite", "bathroom"], ["upstairs ensuite", "bathroom"], ["ensuite and walk in robe", "bathroom"],
  ["toilet", "wc"], ["wc", "wc"], ["powder room", "wc"],
  ["laundry", "laundry"], ["laundry room", "laundry"],
  ["hallway", "hallway"], ["hallway upper", "hallway"], ["hall", "hallway"], ["landing", "hallway"],
  ["upper landing", "hallway"], ["entry", "hallway"], ["stairwell", "hallway"],
  ["left stairwell and hallway", "hallway"], ["upper lobby area", "hallway"],
  ["study", "study"], ["office", "study"], ["far left office", "study"], ["upper board room", "study"],
  ["robe", "storage"], ["walk in robe", "storage"], ["pantry", "storage"], ["linen", "storage"],
  ["cupboard", "storage"], ["left store 1", "storage"], ["store", "storage"],
  ["garage", "garage"],
  ["alfresco", "exterior_excluded"], ["void", "excluded"], ["front door", "excluded"],
];

/** From the brief's table. Starting guesses, to be tuned against actuals. */
const DEFECTS: Array<[string, string, number, number, number]> = [
  ["peeling", "m2", 0.10, 0.18, 0.30],
  ["flaking", "m2", 0.08, 0.15, 0.25],
  ["water_damage", "m2", 0.20, 0.35, 0.60],
  ["mould", "m2", 0.15, 0.28, 0.45],
  ["plaster_cracks", "lin_m", 0.12, 0.22, 0.40],
  ["holes_dents", "each", 0.15, 0.25, 0.45],
  ["timber_rot", "lin_m", 0.30, 0.55, 1.00],
  ["rust", "m2", 0.20, 0.35, 0.55],
  ["nicotine_staining", "m2", 0.05, 0.10, 0.18],
  ["previous_poor_finish", "m2", 0.12, 0.22, 0.38],
  ["render_cracks", "lin_m", 0.15, 0.30, 0.55],
  ["efflorescence", "m2", 0.18, 0.30, 0.50],
];

/** The repeating units the exterior height methods count (brief section 5.2). */
const UNITS: Array<[string, string, number, number, string[]]> = [
  ["brick_course", "Brick course (76 mm brick + 10 mm joint)", 86, 4, ["brick"]],
  ["weatherboard_course", "Weatherboard course (profile-dependent)", 142, 10, ["weatherboard"]],
  ["roof_tile_course", "Roof tile batten gauge", 330, 15, []],
  ["door_head", "Australian standard door height", 2040, 8, []],
  ["storey_default", "Assumed storey height", 2400, 15, []],
  ["storey_modern", "Assumed storey height, newer build", 2550, 15, []],
];

async function main() {
  const email = process.env.SEED_STAFF_EMAIL;
  const password = process.env.SEED_STAFF_PASSWORD;
  if (!email || !password) {
    console.error("Set SEED_STAFF_EMAIL and SEED_STAFF_PASSWORD — these tables are staff-write.");
    process.exit(1);
  }

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) { console.error("sign-in failed:", authErr.message); process.exit(1); }

  const scopeRows = Object.entries(SCOPE).flatMap(([room_type, rules]) =>
    rules.map(([surface_type, is_option, requires_confirm, notes]) => ({
      version: VERSION, room_type, surface_type, is_option, requires_confirm, notes,
    })),
  );
  const aliasRows = ALIASES.map(([alias, room_type]) => ({ version: VERSION, alias, room_type }));
  const defectRows = DEFECTS.map(([defect_type, unit, h1, h2, h3]) => ({
    version: VERSION, defect_type, unit, hours_sev1: h1, hours_sev2: h2, hours_sev3: h3,
  }));
  const unitRows = UNITS.map(([unit_key, label, size_mm, tolerance_pct, applies_to_substrate]) => ({
    version: VERSION, unit_key, label, size_mm, tolerance_pct, applies_to_substrate,
  }));

  const jobs: Array<[string, unknown[], string]> = [
    ["room_type_scope_rules", scopeRows, "version,room_type,surface_type"],
    ["room_name_aliases", aliasRows, "version,alias"],
    ["defect_prep_rates", defectRows, "version,defect_type"],
    ["measurement_units", unitRows, "version,unit_key"],
  ];

  for (const [table, rows, onConflict] of jobs) {
    const { error } = await sb.from(table).upsert(rows, { onConflict });
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1); }
    const { count } = await sb.from(table).select("*", { count: "exact", head: true }).eq("version", VERSION);
    console.log(`${table.padEnd(22)} ${String(rows.length).padStart(3)} sent, ${count} rows at version ${VERSION}`);
  }

  console.log("\nRoom types with rules:", Object.keys(SCOPE).join(", "));
  console.log("An unrecognised room generates NOTHING and goes to the review queue — by design.");
}

main();

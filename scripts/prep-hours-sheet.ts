/**
 * The prep-hours worksheet for Tom (9 September 2026).
 *
 *   npx tsx scripts/prep-hours-sheet.ts > prep-hours.csv
 *
 * READS ONLY — it takes the substrate registry and the defect vocabulary the
 * code already uses and lays them out as a grid to fill in. Nothing here
 * touches a database.
 *
 * Tom's rule, which is what shapes the sheet: *"the standard rate accounts for
 * minor prep (sanding, caulking and minor filling) to all substrates. It is
 * only when the paint is peeling, is raw MDF, is badly damaged, or is painted
 * in oil and needs waterbased top coats that additional prep is required."*
 *
 * So the sheet has FOUR condition cases, not a general "prep" column — a
 * column for prep-in-general would invite a number that double-counts what the
 * rate card already covers.
 *
 * Three severity columns because that is what `defect_prep_rates` carries, and
 * what the customer's own extent answer maps onto: a couple of spots, patches
 * here and there, most of it.
 */

import { SUBSTRATE_DEFS } from "@/lib/estimate/substrates";

/**
 * The four cases Tom named — and WHICH SUBSTRATES EACH ONE CAN HAPPEN TO.
 *
 * The first cut asked for every case against every substrate, which produced
 * a hundred rows including "raw MDF on the walls" and "oil-based render".
 * A sheet that asks nonsense questions gets nonsense answers, or gets
 * abandoned. Each case now only appears where it is real.
 */
type Case = {
  key: string; label: string; defectType: string; unit: string;
  applies: (key: string) => boolean;
};

/** Anything made of, or clad in, timber — where bare/raw is a real state. */
const TIMBER = new Set([
  "skirting", "architraves", "doors", "windows",
  "weatherboards", "exterior_doors", "exterior_windows", "fascias",
  "deck", "fence", "pergola", "balustrade",
]);

/** Joinery that gets enamel, so an oil-to-water conversion is possible. */
const ENAMELLED = new Set([
  "skirting", "architraves", "doors", "windows",
  "exterior_doors", "exterior_windows", "fascias", "gutters", "downpipes", "balustrade",
]);

const CASES: Case[] = [
  {
    key: "peeling", label: "Paint is peeling or flaking", defectType: "peeling",
    unit: "per m2 / per item",
    // Bare brick has no paint to peel — it is the one substrate this cannot happen to.
    applies: (k) => k !== "brick_unpainted",
  },
  {
    key: "raw_timber", label: "Raw MDF or bare timber", defectType: "(none yet — see note)",
    unit: "per m2 / per item",
    applies: (k) => TIMBER.has(k),
  },
  {
    key: "damaged", label: "Badly damaged — holes, cracks, rot", defectType: "holes_dents / plaster_cracks / timber_rot",
    unit: "per m2 / each",
    applies: () => true,
  },
  {
    key: "oil_to_water", label: "Oil-based, needs water-based topcoats", defectType: "(none yet — see note)",
    unit: "per m2 / per item",
    applies: (k) => ENAMELLED.has(k),
  },
];

const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const rows: string[][] = [];
rows.push([
  "Side", "Substrate", "Condition case", "Prices as", "Unit",
  "A couple of spots (h)", "Patches here and there (h)", "Most of it (h)", "Notes",
]);

for (const def of SUBSTRATE_DEFS) {
  // A substrate with no rate code cannot be priced, so it cannot carry prep.
  if (def.codes.length === 0) continue;
  const side = def.key.startsWith("exterior_")
    || ["weatherboards", "render", "stucco", "cement_sheet", "colorbond", "concrete", "brick",
        "brick_unpainted", "eaves", "fascias", "gutters", "downpipes", "garage_doors",
        "deck", "fence", "pergola"].includes(def.key)
    ? "Exterior" : "Interior";
  for (const c of CASES) {
    if (!c.applies(def.key)) continue;
    rows.push([side, def.label, c.label, c.defectType, c.unit, "", "", "", ""]);
  }
}

console.log(rows.map((r) => r.map(q).join(",")).join("\n"));
console.log("");
console.log("# HOW THIS IS USED");
console.log("# Leave a row blank where the standard rate already covers it — a blank means");
console.log("# 'no extra prep', which is the honest answer for most substrates in good order.");
console.log("# The three hour columns are the severity columns defect_prep_rates already has,");
console.log("# and are what the customer's own answer maps onto: a couple of spots / patches");
console.log("# here and there / most of it. So a number here prices a real customer answer.");
console.log("#");
console.log("# TWO CASES HAVE NO DEFECT TYPE YET — raw MDF/bare timber, and oil-to-water.");
console.log("# Both are real and neither is in the defect vocabulary. Fill the hours in and");
console.log("# they get seeded as new defect types with the rest.");
console.log("# (Raw timber already has an hours-and-a-note ALLOWANCE the estimator can add by");
console.log("#  hand — ALLOWANCE_DEFS in lib/capture/commit.ts — but nothing a customer can");
console.log("#  trigger, and nothing per substrate.)");

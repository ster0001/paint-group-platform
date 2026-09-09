/**
 * The prep-hours worksheet for Tom (9 September 2026).
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/prep-hours-sheet.ts > prep-hours.csv
 *
 * READS ONLY. It pulls the CURRENT `defect_prep_rates` rows and lays them out
 * per substrate, so Tom is correcting his own numbers rather than inventing
 * new ones from a blank grid.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS SHEET IS ACTUALLY ASKING
 *
 * The rates already exist and are seeded. What they are NOT is per-substrate:
 * there is ONE `peeling` rate applied everywhere, whether it is plaster in a
 * bedroom or a weatherboard in the weather. Tom's question was per-substrate
 * hours, so the only question this sheet asks is:
 *
 *     does this defect cost the same on THIS substrate as it does generally?
 *
 * Leave the row alone and it keeps the current rate. Put a number in the
 * override columns and that substrate gets its own.
 *
 * Tom's rule sets the scope: *"the standard rate accounts for minor prep
 * (sanding, caulking and minor filling) to all substrates — it is only when
 * the paint is peeling, is raw MDF, is badly damaged, or is painted in oil and
 * needs waterbased top coats that additional prep is required."*
 */

import { createClient } from "@supabase/supabase-js";
import { SUBSTRATE_DEFS } from "@/lib/estimate/substrates";
import { SCOPE_VERSION } from "@/lib/extract/scope";

type Rate = { defect_type: string; unit: string; hours_sev1: number; hours_sev2: number; hours_sev3: number };

/**
 * Tom's four cases, mapped onto the defect types that already price them.
 *
 * Two of the four are NOT prep rows and must not become them — they are
 * already priced as an extra COAT in the paint-systems table
 * (`DEFAULT_SURFACE_FLAGS.bare_timber` → primer + 2; `glossBondingPrimer` →
 * +1 coat). Adding prep hours on top would charge the same work twice, so the
 * sheet says so rather than offering a tempting blank cell.
 */
const CASES: Array<{
  label: string;
  defects: string[];
  applies: (key: string) => boolean;
  note?: string;
}> = [
  {
    label: "Paint is peeling or flaking",
    defects: ["peeling", "flaking"],
    // Bare brick has no paint to peel.
    applies: (k) => k !== "brick_unpainted",
  },
  {
    label: "Badly damaged — holes, cracks, rot",
    defects: ["holes_dents", "plaster_cracks", "render_cracks", "timber_rot"],
    applies: () => true,
  },
  {
    label: "Water damage, mould or staining",
    defects: ["water_damage", "mould", "nicotine_staining"],
    applies: () => true,
  },
  {
    label: "Raw MDF or bare timber",
    defects: [],
    applies: (k) => TIMBER.has(k),
    note: "ALREADY PRICED AS A COAT (primer + 2 coats). Only add hours if the sanding/prep is beyond that.",
  },
  {
    label: "Oil-based, needs water-based topcoats",
    defects: [],
    applies: (k) => ENAMELLED.has(k),
    note: "ALREADY PRICED AS A COAT (bonding primer). Only add hours if the prep is beyond that.",
  },
];

const TIMBER = new Set([
  "skirting", "architraves", "doors", "windows",
  "weatherboards", "exterior_doors", "exterior_windows", "fascias",
  "deck", "fence", "pergola", "balustrade",
]);
const ENAMELLED = new Set([
  "skirting", "architraves", "doors", "windows",
  "exterior_doors", "exterior_windows", "fascias", "gutters", "downpipes", "balustrade",
]);
const EXTERIOR = new Set([
  "weatherboards", "render", "stucco", "cement_sheet", "colorbond", "concrete", "brick",
  "brick_unpainted", "eaves", "fascias", "gutters", "downpipes", "exterior_windows",
  "exterior_doors", "garage_doors", "deck", "fence", "pergola",
]);

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (source .env.test.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("defect_prep_rates")
    .select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3")
    .eq("version", SCOPE_VERSION);
  if (error) { console.error(error.message); process.exit(1); }
  const rates = new Map((data as Rate[]).map((r) => [r.defect_type, r]));

  const rows: string[][] = [[
    "Side", "Substrate", "Condition case", "Prices as", "Unit",
    "NOW: a couple of spots", "NOW: patches", "NOW: most of it",
    "CHANGE TO: spots", "CHANGE TO: patches", "CHANGE TO: most", "Notes",
  ]];

  for (const def of SUBSTRATE_DEFS) {
    if (def.codes.length === 0) continue;
    const side = EXTERIOR.has(def.key) ? "Exterior" : "Interior";
    for (const c of CASES) {
      if (!c.applies(def.key)) continue;
      // The current rate is the FIRST of the case's defect types that exists —
      // they are variants of one job (a crack is a crack, in plaster or render).
      const r = c.defects.map((d) => rates.get(d)).find(Boolean);
      rows.push([
        side, def.label, c.label,
        c.defects.length === 0 ? "an extra coat" : (r?.defect_type ?? "NO RATE ROW"),
        r?.unit ?? "—",
        r ? String(r.hours_sev1) : "", r ? String(r.hours_sev2) : "", r ? String(r.hours_sev3) : "",
        "", "", "",
        c.note ?? "",
      ]);
    }
  }

  console.log(rows.map((r) => r.map(q).join(",")).join("\n"));
}

void main();

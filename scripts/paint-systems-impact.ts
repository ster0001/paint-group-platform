/**
 * What the paint-systems derivation moves in money (estimator journey v2 §4.2).
 *
 *   npx tsx scripts/paint-systems-impact.ts
 *
 * READS ONLY. It touches no database at all: the rate card, products and
 * modifiers come from the golden fixture (lib/pricing/__fixtures__), so the
 * numbers are reproducible and this can never write anywhere near production.
 *
 * It prices one representative 3-bed single-storey interior twice — once with
 * the old whole-job coat count (`coatsFor`), once with the derived per-group
 * systems — and prints the difference for each colour intent and condition
 * band. Run it after changing the table in Settings → Estimates → Paint
 * systems, or before turning "fix online" on, so the movement is a number
 * somebody has looked at rather than a surprise in the proving window.
 */
import { readFileSync } from "node:fs";
import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate.ts";
import { coatsFor } from "@/lib/wizard/state.ts";
import { deriveSystem, groupForSubstrate, colourIntentFromTier, conditionBandFromDamageTier } from "@/lib/pricing/systems.ts";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates.ts";

const fx = JSON.parse(readFileSync("lib/pricing/__fixtures__/golden-estimates.json", "utf8"));
const ctx: PricingContext = {
  rateItems: fx.reference.rateItems, products: fx.reference.products,
  modifiers: fx.reference.modifiers, settings: fx.reference.settings,
};
const adj = { modSel: {}, materials: {} };

// A plain 3-bed single-storey interior: the usual full repaint.
const ROOMS = [
  { name: "Living", L: 5.5, W: 4.0, H: 2.4, doors: 1, windows: 2 },
  { name: "Kitchen/Meals", L: 4.5, W: 3.5, H: 2.4, doors: 1, windows: 1 },
  { name: "Bed 1", L: 3.8, W: 3.4, H: 2.4, doors: 1, windows: 1 },
  { name: "Bed 2", L: 3.3, W: 3.0, H: 2.4, doors: 1, windows: 1 },
  { name: "Bed 3", L: 3.2, W: 3.0, H: 2.4, doors: 1, windows: 1 },
  { name: "Bathroom", L: 2.4, W: 2.0, H: 2.4, doors: 1, windows: 1 },
  { name: "Hall", L: 6.0, W: 1.2, H: 2.4, doors: 0, windows: 0 },
];
const SURFACES = (r: typeof ROOMS[number]) => [
  { code: "Walls", count: 1 }, { code: "Ceilings", count: 1 },
  { code: "Standard Cornices", count: 1 }, { code: "Skirting Boards", count: 1 },
  ...(r.doors ? [{ code: "Flat Door and Frame (1 Side)", count: r.doors }] : []),
  ...(r.windows ? [{ code: "Awning / Casement Window", count: r.windows }] : []),
];

type Mode = "old" | "new";
function blocks(mode: Mode, tier: "fresh" | "change" | "dark_to_light", damageTier: number): BlockInput[] {
  const answers = {
    colourIntent: colourIntentFromTier(tier),
    condition: conditionBandFromDamageTier(damageTier),
    glossTrims: "no" as const, ceilingsMarked: false, ceilingsChangingColour: false,
  };
  let id = 1;
  return ROOMS.map((r) => ({
    id: String(id++), kind: "area" as const, name: r.name, type: "Interior",
    areaType: "room", L: r.L, W: r.W, H: r.H, isOption: false,
    surfaces: SURFACES(r).map((s) => {
      const key = substrateKeyForRateCode(s.code);
      const group = groupForSubstrate(key);
      const coats = mode === "old" || group == null
        ? coatsFor(tier, false)
        : deriveSystem(group, answers).coats;
      return { id: String(id++), code: s.code, coats, count: s.count, prepHr: 0 };
    }),
  })) as unknown as BlockInput[];
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const rows: string[] = [];
for (const [tier, label] of [["fresh", "Same colours again"], ["change", "New colours"], ["dark_to_light", "Much lighter / bold"]] as const) {
  for (const [dt, cond] of [[0, "good"], [1, "some wear"], [2, "needs work"]] as const) {
    const o = priceEstimateTotals(blocks("old", tier, dt), ctx, adj).totalCents;
    const n = priceEstimateTotals(blocks("new", tier, dt), ctx, adj).totalCents;
    const d = n - o;
    const pct = ((d / o) * 100).toFixed(1);
    rows.push(`${label.padEnd(22)} ${cond.padEnd(11)} ${money(o).padStart(9)} → ${money(n).padStart(9)}   ${(d >= 0 ? "+" : "") + money(d)} (${d >= 0 ? "+" : ""}${pct}%)`);
  }
}
console.log("A 3-bed single-storey interior, whole-house repaint, on the golden rate card\n");
console.log("colour intent          condition        was        now      change");
console.log("-".repeat(72));
for (const r of rows) console.log(r);

/**
 * S8 replay set — pure module (the test and the report script both read it).
 *   · SYNTHETIC_ENQUIRIES: twenty enquiries in the shape real ones arrive.
 *   · corpusReplay(): the regression corpus (regression-set/ground-truth.json,
 *     PaintScout estimates Tom sent; git-ignored — carries addresses) turned
 *     into ANONYMISED briefs run through co-work; reports the correction
 *     between the proposed total and the sent total. Null when absent (CI).
 */
import { existsSync, readFileSync } from "node:fs";
import { heuristicExtract } from "../brief-extract";
import { proposeFromBrief } from "../propose";
import { priceScope } from "../scope-tools";
import { emptyDoc } from "../scope-store";
import { docBlocks, type ScopeDeps } from "../scope-doc";
import { median } from "./metrics";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("../__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
export const REPLAY_REFS: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
export const REPLAY_CTX: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
export const REPLAY_DEPS: ScopeDeps = { refs: REPLAY_REFS, ctx: REPLAY_CTX, actor: "staff" };
const deps = REPLAY_DEPS;

export const SYNTHETIC_ENQUIRIES = [
  "Hi, looking for a quote to paint the inside of our 3 bedroom 1 bathroom house in Coburg. Walls and ceilings, doors and skirting. Change of colour throughout.",
  "2 bed unit, walls only, freshen up same colour. Kitchen and living open plan.",
  "4 bedroom 2 bathroom double storey house. All interior walls, ceilings, trims. A few minor cracks in the hallway. Colour match to existing.",
  "Just the living room and hallway please — walls, ceilings, skirting. Panel doors. 2.7m ceilings.",
  "Exterior of a single storey weatherboard house, weathered paintwork, windows and doors and fascias.",
  "Rendered double storey, exterior only, in good condition, body and roofline.",
  "3 bed 2 bath townhouse, inside and out. Interior walls and trims; exterior render. Dark to light on the walls.",
  "One bedroom flat: walls, ceilings, doors. Vacant, keys available.",
  "Painting 5 bedrooms, 2 bathrooms, study and laundry — walls ceilings trims — sash windows, colonial style.",
  "House interior, 3 bedrooms, one bathroom, kitchen 4 x 3, walls only, some water damage in the bathroom ceiling.",
  "Need walls painted in 2 bedrooms and the hallway. Flat doors. Same colour.",
  "Full interior repaint 3 bedroom house, occupied, walls ceilings cornices doors frames skirtings, minor holes in the bedroom walls.",
  "Weatherboard exterior single storey, peeling in places, gutters and downpipes too.",
  "Apartment 2 bed 1 bath, walls and ceilings, change of colour, 2.4m ceilings.",
  "3 bedroom house, interior, walls and ceilings only, plus wallpaper removal in the dining room.",
  "Brick house exterior, painted brick, eaves fascias gutters, double storey.",
  "Small job: study and laundry walls, ceilings, doors.",
  "3 bed 1 bath house interior — walls trims doors windows — mould in the bathroom, otherwise good.",
  "Living, dining, kitchen and hallway: walls, ceilings and trims, colour match.",
  "6 bedroom house, 3 bathrooms, all interior walls and ceilings, casement windows, panel doors, nicotine staining in the lounge.",
];

/** The corpus replay — reported, not gated (proving-window metric). */
export function corpusReplay(): { jobs: number; medianCorrectionCents: number; roomsMatchedPct: number } | null {
  const path = new URL("../../../regression-set/ground-truth.json", import.meta.url);
  if (!existsSync(path)) return null;
  type Truth = { estimateId: string; jobType: string; areas: Array<{ name: string; priceCents: number; doors: number; windows: number }> };
  const truth = JSON.parse(readFileSync(path, "utf8")) as Truth[];
  const corrections: number[] = [];
  let matched = 0, total = 0;
  for (const job of truth.filter((j) => j.jobType === "interior")) {
    // Anonymised: the area names become the counts a person would say.
    const rooms = job.areas.filter((a) => !/preparation|allowance|setup|clean|scaffold/i.test(a.name));
    const isBed = (n: string) => /\b(bed(room)?|master)\b/i.test(n) && !/robe/i.test(n);
    const isBath = (n: string) => /\b(bath(room)?|en ?suite)\b/i.test(n);
    const beds = rooms.filter((a) => isBed(a.name)).length;
    const baths = rooms.filter((a) => isBath(a.name)).length;
    const others = rooms.filter((a) => !isBed(a.name) && !isBath(a.name)).map((a) => a.name);
    const brief = `${beds} bedroom ${baths} bathroom house interior${others.length ? `, plus ${others.join(", ")}` : ""}. Walls, ceilings, doors, frames, skirting. ${rooms.reduce((n, a) => n + a.doors, 0)} doors and ${rooms.reduce((n, a) => n + a.windows, 0)} windows in total. Change of colour.`;
    const p = proposeFromBrief(emptyDoc(job.estimateId, "residential"), heuristicExtract(brief), deps, { mode: "cowork", gateCents: 15_000 });
    if (!p.ok) continue;
    const sent = job.areas.reduce((n, a) => n + a.priceCents, 0);
    corrections.push(Math.abs(priceScope(p.working, deps).totalCents - sent));
    const proposedTypes = new Set(docBlocks(p.working).map((b) => String(b.roomType)));
    for (const a of rooms) { total++; if ([...proposedTypes].some((t) => a.name.toLowerCase().includes(t.replace("_", " ").slice(0, 4)))) matched++; }
  }
  return { jobs: corrections.length, medianCorrectionCents: median(corrections), roomsMatchedPct: total ? Math.round((matched / total) * 100) : 0 };
}


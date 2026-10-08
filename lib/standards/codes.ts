/**
 * Which rate-card codes mean which standards surface (ruling S2; Step 1 of
 * the brief asks for this table and for Tom to approve it).
 *
 * Seeded into `standards_surface_codes` by scripts/seed-standards.ts and read
 * back from there by the app — this constant is the SOURCE of that table the
 * way the JSON is the source of the words. The codes are `rate_items.code`
 * strings exactly as the rate card spells them (supabase/seed/ratecard_v7.sql
 * and later migrations). Three window codes exist on both sides of the card,
 * so every entry names its side and the resolver uses the area's side to tell
 * them apart.
 *
 * Judgement calls, flagged for Tom rather than hidden (Step 1 report lists them):
 *   · render ← Stucco, Cement Sheet, Concrete / Tilt Slab: the rate card clones
 *     Render for all three ("prepared and coated like render"), so the Render
 *     standard is the closest wording. Remove any Tom disagrees with.
 *   · eaves ← Soffits / Exterior Ceilings: an exterior ceiling is judged from
 *     the ground like an eave.
 *   · picket: the two Picket Fence rates only. Paling Fence is a different
 *     fence and is NOT mapped.
 *   · extdoors: Standard Door and Front Door. Security Door is hardware and is
 *     NOT mapped.
 * Fretwork has no rate code at all: it keeps its standard with no codes, so a
 * painter can still read it from the Standards screen.
 */
import type { Side } from "./model";

export const SURFACE_CODES: Record<string, { side: Side; codes: string[] }> = {
  walls: { side: "interior", codes: ["Walls"] },
  ceilings: { side: "interior", codes: ["Ceilings"] },
  cornices: { side: "interior", codes: ["Standard Cornices", "Patterned Cornices"] },
  skirting: { side: "interior", codes: ["Skirting Boards", "Skirting Boards MDF"] },
  architraves: { side: "interior", codes: ["Architrave (1 Side)"] },
  windowframes: {
    side: "interior",
    codes: ["Fixed / Picture / Window Reveal", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"],
  },
  doors: {
    side: "interior",
    codes: ["Flat Door and Frame (1 Side)", "Flat Door (1 Side)", "4-6 Panel Door and Frame (1 Side)", "4-6 Panel Door (1 Side)"],
  },
  weatherboards: { side: "exterior", codes: ["Weatherboards"] },
  brick: { side: "exterior", codes: ["Brick", "Brick (Unpainted)"] },
  render: { side: "exterior", codes: ["Render", "Stucco", "Cement Sheet", "Concrete / Tilt Slab"] },
  picket: { side: "exterior", codes: ["Picket Fence (Hand Paint)", "Picket Fence (Spray)"] },
  extwindows: {
    side: "exterior",
    codes: ["Fixed / Picture Window", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"],
  },
  extdoors: { side: "exterior", codes: ["Standard Door (1 Side)", "Front Door"] },
  fascias: { side: "exterior", codes: ["Fascias"] },
  eaves: { side: "exterior", codes: ["Eaves", "Soffits / Exterior Ceilings"] },
  strapping: { side: "exterior", codes: ["Strapping"] },
  fretwork: { side: "exterior", codes: [] },
};

/**
 * Rate-card codes that map to NO standards surface — listed so the Step 1
 * report can show them and so a test notices when the card gains a code
 * nobody has placed. A work-order line with one of these shows no link.
 */
export const UNMAPPED_RATE_CODES: string[] = [
  "Gutters", "Downpipes", "Roof", "Deck Painting", "Pergola", "Garage Door (1 Car)", "Garage Door (2 Car)",
  "Pressure Washing", "Colorbond Cladding", "Cutek", "Columns", "Posts", "Wood Shutters", "Window Shutters",
  "Hand Rails", "Balustrades", "Picture Rails", "Paling Fence", "Security Door", "Side Gate", "Meter Box", "Shed",
  "Air Vent", "Kitchen Cupboard Front", "Robe Door", "Vanity Door", "Kitchen Cupboard Interior", "Robe Interior",
  "Vanity Interior", "Linen / Broom Cupboard Interior", "Colour Match Allowance", "Ceilings Only Allowance",
  "Minor Fascia Rot Allowance", "Access Allowance", "Custom surface (imported)",
];

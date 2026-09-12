import type { DraftArea } from "@/lib/extract/draft";
import type { Deferred } from "@/lib/extract/scope";
import {
  DEFAULT_COMMERCIAL_PRICING, WAREHOUSE_HEIGHT_M, needsEwpAtHeight, rackingSharePct, warehouseDimensions,
  type CommercialPricing, type RackingAnswer, type WarehouseAreaBracket, type WarehouseHeightBracket,
} from "@/lib/pricing/commercial";
import { extSurface } from "./starter";
import type { Choice } from "./quick-look";
import type { CommercialRoom, Segment } from "./segments";

/**
 * C13 — THE WAREHOUSE PATTERN (addendum S6b, §4.13; prototype `s-com-warehouse`).
 *
 * No bedrooms, no storeys — area and height. Floor-area brackets to over
 * 5,000 m² or a typed L × W; height to the underside of the roof (above the
 * threshold a scissor-lift line appears, unless the customer has a lift on
 * site); the industrial surface set with counted roller and personnel doors
 * and counted offices; wall material, nothing pre-ticked; and the three
 * access answers that move a warehouse price most: racking against the
 * walls, operating during the works, equipment on site.
 *
 * The tree: ONE "Warehouse floor" room whose walls are 2(L+W) × H at the
 * material's own rate row (split evenly when several are ticked) × the
 * racking share; roller doors per door per face and personnel doors per door
 * both sides on the same room; offices priced like offices (the office row's
 * typicals); amenities; and every item the range must not guess — the
 * underside of the roof, structural steel, bollards, line marking, the
 * mezzanine, the prep a material needs — as a flagged, unpriced line that
 * reads "priced on confirmation".
 *
 * Nothing here is money. The rows price it; `lib/pricing/commercial.ts`
 * owns the geometry and the share.
 */

export type WarehouseSurfaceKey = "walls" | "roof" | "steel" | "roller" | "personnel" | "bollards" | "lines" | "offices" | "mezz" | "amenities";
export type WarehouseMaterial = "precast" | "blockwork" | "sheeting" | "cement_sheet" | "plasterboard" | "unsure";

export type WarehouseAnswers = {
  areaBracket: WarehouseAreaBracket;
  lengthM: number | null;
  widthM: number | null;
  roofHeight: WarehouseHeightBracket;
  whSurfaces: WarehouseSurfaceKey[];
  rollerDoors: number;
  personnelDoors: number;
  offices: number;
  materials: WarehouseMaterial[];
  racking: RackingAnswer;
  operating: boolean;
  liftOnSite: boolean;
};

/** The prototype's defaults, with the C8b ruling applied: no material pre-ticked. */
export const DEFAULT_WAREHOUSE_ANSWERS: WarehouseAnswers = {
  areaBracket: "1000",
  lengthM: null,
  widthM: null,
  roofHeight: "6",
  whSurfaces: ["walls", "roller", "personnel", "offices"],
  rollerDoors: 2,
  personnelDoors: 4,
  offices: 2,
  materials: [],
  racking: "no",
  operating: false,
  liftOnSite: false,
};

export const WH_AREAS: Choice<WarehouseAreaBracket>[] = [
  { value: "500", label: "Up to 500 m²" }, { value: "1000", label: "500–1,000" }, { value: "2500", label: "1,000–2,500" },
  { value: "5000", label: "2,500–5,000" }, { value: "9000", label: "Over 5,000" },
];
export const WH_HEIGHTS: Choice<WarehouseHeightBracket>[] = [
  { value: "4", label: "Up to 4 m" }, { value: "6", label: "4–6 m" }, { value: "9", label: "6–9 m" }, { value: "12", label: "Over 9 m" },
];
/** The industrial surfaces. `counted` rows carry a stepper; `flagged` rows price nothing and say so. */
export const WH_SURFACES: Array<Choice<WarehouseSurfaceKey> & { counted?: "rollerDoors" | "personnelDoors" | "offices"; flagged?: boolean }> = [
  { value: "walls", label: "Walls", hint: "Precast, blockwork, sheeting — we ask which next" },
  { value: "roof", label: "Underside of the roof", hint: "Usually sprayed · a person confirms", flagged: true },
  { value: "steel", label: "Structural steel and columns", hint: "Rust treatment where flagged", flagged: true },
  { value: "roller", label: "Roller doors", hint: "Inside face · both if you tick outside", counted: "rollerDoors" },
  { value: "personnel", label: "Personnel doors and frames", hint: "Enamel · both sides", counted: "personnelDoors" },
  { value: "bollards", label: "Bollards and safety yellow", hint: "Counted on site", flagged: true },
  { value: "lines", label: "Line marking", hint: "Priced per metre · a person confirms", flagged: true },
  { value: "offices", label: "Offices inside", hint: "Priced like an office", counted: "offices" },
  { value: "mezz", label: "Mezzanine", hint: "Walls and balustrade", flagged: true },
  { value: "amenities", label: "Amenities and kitchen" },
];
export const WH_MATERIALS: Choice<WarehouseMaterial>[] = [
  { value: "precast", label: "Precast or tilt slab" }, { value: "blockwork", label: "Blockwork" }, { value: "sheeting", label: "Metal sheeting" },
  { value: "cement_sheet", label: "Cement sheet" }, { value: "plasterboard", label: "Plasterboard" }, { value: "unsure", label: "Not sure" },
];
export const WH_RACKING: Choice<RackingAnswer>[] = [
  { value: "no", label: "No" }, { value: "some", label: "Some" }, { value: "most", label: "Most walls" },
];

/** "Not sure" is exclusive on the materials, as it is on the outside screen. */
export function toggleWarehouseMaterial(current: WarehouseMaterial[], value: WarehouseMaterial): WarehouseMaterial[] {
  if (value === "unsure") return current.includes("unsure") ? [] : ["unsure"];
  const rest = current.filter((m) => m !== "unsure");
  return rest.includes(value) ? rest.filter((m) => m !== value) : [...rest, value];
}

// ---------------------------------------------------------------------------
// Materials → the card's rows, and the ticks the merge reads
// ---------------------------------------------------------------------------

/**
 * Material → the rate row and the substrate tick. The rows are the card's
 * cladding rows (Exterior side; the engine prices an interior wall at them
 * when the interior side has no row). Precast and blockwork name the prep
 * §4.13 wants — a crew note, never invented hours, because the derivation
 * table has no industrial rule.
 */
export const WAREHOUSE_MATERIAL_ROW: Record<WarehouseMaterial, { code: string; key: string; label: string; prep: string | null }> = {
  precast: { code: "Concrete / Tilt Slab", key: "concrete", label: "precast / tilt slab", prep: "bare precast takes a sealer before the topcoats" },
  blockwork: { code: "Brick (Unpainted)", key: "brick_unpainted", label: "blockwork", prep: "blockwork takes a block filler before the topcoats" },
  sheeting: { code: "Colorbond Cladding", key: "colorbond", label: "metal sheeting", prep: "sheeting is washed down and takes a metal primer on any bare or rusted metal" },
  cement_sheet: { code: "Cement Sheet", key: "cement_sheet", label: "cement sheet", prep: null },
  plasterboard: { code: "Walls", key: "walls", label: "plasterboard", prep: null },
  unsure: { code: "Concrete / Tilt Slab", key: "concrete", label: "material to confirm", prep: null },
};

/** The substrate ticks a warehouse job carries into the merge (`state.surfaces`). */
export function warehouseSurfaceKeys(a: WarehouseAnswers): string[] {
  const keys = new Set<string>();
  const on = new Set(a.whSurfaces);
  if (on.has("walls")) for (const m of (a.materials.length ? a.materials : ["unsure" as const])) keys.add(WAREHOUSE_MATERIAL_ROW[m].key);
  if (on.has("roller")) keys.add("garage_doors");
  if (on.has("personnel")) keys.add("exterior_doors");
  // The offices and amenities are ordinary rooms — the usual interior set.
  if (on.has("offices") || on.has("amenities")) for (const k of ["walls", "ceilings", "doors", "architraves", "skirting"]) keys.add(k);
  return [...keys];
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type WarehouseDeferred = { room: string; areaId: number | null } & Deferred;

/**
 * The warehouse floor as ONE interior room: L × W from the bracket or the
 * typed size, H from the roof bracket, so the engine's own rule (walls =
 * 2(L+W) × H) does the arithmetic. Walls at the material rows, split evenly
 * by share when several are ticked, each × the racking share; roller doors
 * at the per-door-per-face row (one face — an inside job never ticks the
 * outside); personnel doors at the per-side row × 2.
 */
export function warehouseFloorArea(
  nextId: () => number,
  a: WarehouseAnswers,
  pricing: CommercialPricing = DEFAULT_COMMERCIAL_PRICING,
): { area: DraftArea; deferred: WarehouseDeferred[] } {
  const dims = warehouseDimensions(a.areaBracket, a.lengthM, a.widthM);
  const H = WAREHOUSE_HEIGHT_M[a.roofHeight] ?? WAREHOUSE_HEIGHT_M["6"];
  const on = new Set(a.whSurfaces);
  const id = nextId();
  const surfaces: DraftArea["surfaces"] = [];
  const deferred: WarehouseDeferred[] = [];
  const share = rackingSharePct(a.racking, pricing);

  if (on.has("walls")) {
    const mats = a.materials.length ? a.materials : (["unsure"] as WarehouseMaterial[]);
    const split = Math.round(100 / mats.length);
    for (const m of mats) {
      const row = WAREHOUSE_MATERIAL_ROW[m];
      const s = extSurface(nextId(), row.code);
      s.internalLabel = `Walls — ${row.label}`;
      s.clientLabel = `Walls — ${row.label}`;
      // The share carries BOTH the split and the racking; the engine scales the derived m².
      s.sharePct = Math.max(1, Math.round((split * share) / 100));
      if (m === "unsure") { s.assumedFields = [...s.assumedFields, "material"]; }
      surfaces.push(s);
      if (row.prep) s.crewNote = row.prep;
    }
    if (mats.includes("unsure")) {
      deferred.push({ room: "Warehouse floor", areaId: id, count: 1, kind: "commercial_material", what: "wall material to confirm", needs: "priced at the tilt-slab row until the material is confirmed on site" });
    }
    for (const m of mats) {
      const row = WAREHOUSE_MATERIAL_ROW[m];
      if (row.prep) deferred.push({ room: "Warehouse floor", areaId: id, count: 1, kind: "commercial_prep", what: `${row.label} — preparation`, needs: `${row.prep}; the extent is confirmed on site, not priced from a form` });
    }
    if (a.racking !== "no") {
      deferred.push({ room: "Warehouse floor", areaId: id, count: 1, kind: "commercial_racking", what: a.racking === "most" ? "racking against most walls" : "racking against some walls", needs: "we paint above the racking, or you clear it — the share is a Settings factor a person confirms on site" });
    }
  }
  if (on.has("roller") && a.rollerDoors > 0) {
    surfaces.push({ ...extSurface(nextId(), "Garage Door (1 Car)"), count: a.rollerDoors, internalLabel: "Roller doors — inside face", clientLabel: "Roller doors — inside face" });
  }
  if (on.has("personnel") && a.personnelDoors > 0) {
    surfaces.push({ ...extSurface(nextId(), "Standard Door (1 Side)"), count: a.personnelDoors * 2, internalLabel: "Personnel doors — both sides", clientLabel: "Personnel doors — both sides" });
  }
  const FLAGGED: Partial<Record<WarehouseSurfaceKey, { what: string; needs: string }>> = {
    roof: { what: "Underside of the roof", needs: "usually sprayed — a person sizes and prices it on site" },
    steel: { what: "Structural steel and columns", needs: "rust treatment where flagged — counted and priced on site" },
    bollards: { what: "Bollards and safety yellow", needs: "counted on site" },
    lines: { what: "Line marking", needs: "priced per metre — a person measures it" },
    mezz: { what: "Mezzanine — walls and balustrade", needs: "sized on site" },
  };
  for (const [key, f] of Object.entries(FLAGGED) as Array<[WarehouseSurfaceKey, { what: string; needs: string }]>) {
    if (on.has(key)) deferred.push({ room: "Warehouse floor", areaId: id, count: 1, kind: "commercial_flagged", what: f.what, needs: f.needs });
  }
  if (needsEwpAtHeight(H, pricing, a.liftOnSite)) {
    deferred.push({
      room: "Whole job", areaId: null, count: 1, kind: "commercial_ewp",
      what: `Scissor lift for walls to ${H} m`,
      needs: "access equipment hire is quoted, not estimated — a person sizes it before any price is fixed",
    });
  }

  const area: DraftArea = {
    id, kind: "area", name: "Warehouse floor", type: "Interior", areaType: "room", roomType: "storage",
    L: dims.L, W: dims.W, H, storey: "ground",
    isOption: false, description: "", open: true, media: [],
    surfaces, origin: "ai_assumed", confidence: dims.typed ? 0.6 : 0.4,
    assumedFields: dims.typed ? ["H"] : ["L", "W", "H"],
    extractionSourceId: null,
  } as DraftArea;
  return { area, deferred };
}

/** The offices and amenities, priced like an office: the office row's typicals. */
export function warehouseRoomList(a: WarehouseAnswers, office: Segment | null): CommercialRoom[] {
  const rooms: CommercialRoom[] = [];
  const on = new Set(a.whSurfaces);
  const officeTyp = office?.typicals.rooms.offices ?? ["Office", [3.5, 4], "study"];
  const amenTyp = office?.typicals.alsoSize["Amenities"] ?? [3, 2.5, "bathroom"];
  if (on.has("offices")) {
    for (let i = 1; i <= Math.min(60, a.offices); i++) {
      rooms.push({ name: a.offices > 1 ? `${officeTyp[0]} ${i}` : officeTyp[0], roomType: officeTyp[2], L: officeTyp[1][0], W: officeTyp[1][1], open: false, outside: false });
    }
  }
  if (on.has("amenities")) rooms.push({ name: "Amenities", roomType: amenTyp[2], L: amenTyp[0], W: amenTyp[1], open: false, outside: false });
  return rooms;
}

// ---------------------------------------------------------------------------
// The reveal's words
// ---------------------------------------------------------------------------

const SIZE_WORD: Record<WarehouseAreaBracket, string> = { "500": "small", "1000": "medium", "2500": "large", "5000": "very large", "9000": "multi-bay" };
const HEIGHT_WORD: Record<WarehouseHeightBracket, string> = { "4": "up to 4 m", "6": "4–6 m", "9": "6–9 m", "12": "over 9 m" };

export function warehouseRestatement(a: WarehouseAnswers, colour: "same" | "new" | "bold", condition: string): string {
  const size = a.lengthM != null && a.widthM != null ? `${a.lengthM} × ${a.widthM} m` : SIZE_WORD[a.areaBracket];
  const colourWord = colour === "same" ? "the same colours" : colour === "bold" ? "a big colour change" : "new colours";
  const cond = condition === "good" ? "good condition" : condition === "wear" ? "some wear" : "needing some work";
  return `Based on a ${size} warehouse, ${HEIGHT_WORD[a.roofHeight]} high, ${a.racking === "no" ? "walls clear" : a.racking === "most" ? "racking against most walls" : "racking against some walls"}, ${colourWord}, ${cond}${a.operating ? ", operating during the works" : ""}. If that's about right, this is about right.`;
}

export type WarehouseAssumption = { key: string; what: string; why: string; rung?: string };

export function warehouseAssumedList(a: WarehouseAnswers, pricing: CommercialPricing = DEFAULT_COMMERCIAL_PRICING): WarehouseAssumption[] {
  const H = WAREHOUSE_HEIGHT_M[a.roofHeight];
  const out: WarehouseAssumption[] = [];
  out.push({
    key: "rooms",
    what: a.lengthM != null && a.widthM != null ? `A ${a.lengthM} × ${a.widthM} m floor` : `A ${SIZE_WORD[a.areaBracket]} floor from the bracket`,
    why: "The walls are sized from the floor area and the height — typing the real length and width tightens this most.",
    rung: "rooms",
  });
  out.push({
    key: "height",
    what: H > pricing.ewpHeightThresholdM
      ? (a.liftOnSite ? "Your lift used — no hire allowed for" : "Scissor lift hire allowed for, shown as its own line")
      : "Ladder and platform reach — no lift needed",
    why: "Hire is quoted, never estimated — a person sizes it before any price is fixed.",
  });
  if (a.whSurfaces.includes("walls")) {
    out.push({
      key: "racking",
      what: a.racking === "no" ? "Walls clear of racking" : "We paint above the racking — clearing it changes the price",
      why: a.racking === "no" ? "Tell us if stock or racking sits against the walls; it changes the price a lot." : "The share we paint is a Settings factor; a person confirms it on site.",
    });
    if (a.materials.length === 0 || a.materials.includes("unsure")) {
      out.push({ key: "material", what: "The wall material — to confirm", why: "Priced at the tilt-slab row until your estimator confirms it." });
    }
  }
  out.push({
    key: "operating",
    what: a.operating ? "Operating during the works — staged, with exclusion zones" : "Vacant — one setup",
    why: a.operating ? "Staging is a loading on the hours, never on the materials." : "Tell us if you'll be operating; staging changes the hours.",
  });
  out.push({
    key: "excluded",
    what: "No roof, steel, line marking or bollards priced",
    why: "Anything ticked from that list is on the estimate as \"priced on confirmation\" — a person prices it on site.",
  });
  return out;
}

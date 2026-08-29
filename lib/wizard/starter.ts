import type { Extraction } from "@/lib/extract/schema";
import type { DraftArea } from "@/lib/extract/draft";
import type { WizardBasics } from "./state";

/**
 * W2's no-plan path: a STARTER LIST built from the quick basics (bedrooms,
 * storeys, open-plan toggle), sized from Tom's typical room dimensions
 * (room_type_defaults, business inputs §1) — with everything tagged
 * ai_assumed so the review queue and the accuracy score treat every number
 * as the assumption it is.
 *
 * The list is deliberately CONSERVATIVE: under-scoping is a conversation in
 * the editor ("add what's missing"), over-scoping is a wrong quote. So no
 * ensuite, no separate WC, no garage — one tap adds any of them.
 *
 * Mechanically this builds a synthetic Extraction and lets buildDraft() turn
 * it into the tree — the same stage-5 code path as a real plan, no fork —
 * then markStarterProvenance() downgrades the origins to ai_assumed.
 */

export type TypicalSizeRow = { room_type: string; typical_length_m: number; typical_width_m: number };

/**
 * Fallbacks when a room_type_defaults row is missing (pre-seed databases).
 * Values from business inputs §1; kitchen and hallway are mockup-derived
 * placeholders (16 m² kitchen/meals, 12 m² hall & entry) pending Tom's own
 * numbers — both editable in Settings once seeded.
 */
export const FALLBACK_TYPICALS: Record<string, { L: number; W: number }> = {
  bedroom: { L: 3.5, W: 3.25 },
  living: { L: 4.0, W: 4.0 },
  open_plan_kitchen_living: { L: 6.0, W: 6.0 },
  kitchen: { L: 4.0, W: 4.0 },
  bathroom: { L: 2.0, W: 1.5 },
  laundry: { L: 2.0, W: 1.5 },
  hallway: { L: 6.0, W: 2.0 },
  wc: { L: 1.25, W: 1.0 },
  garage: { L: 6.0, W: 4.0 },
};

export function typicalSize(roomType: string, rows: TypicalSizeRow[]): { L: number; W: number } {
  const row = rows.find((r) => r.room_type === roomType);
  if (row && row.typical_length_m > 0 && row.typical_width_m > 0) {
    return { L: row.typical_length_m, W: row.typical_width_m };
  }
  return FALLBACK_TYPICALS[roomType] ?? FALLBACK_TYPICALS.bedroom;
}

/**
 * Plan-read rooms are often UNDIMENSIONED (a WC, bathroom, laundry rarely
 * carries printed dimensions on a marketing plan), so they arrive at L/W = 0
 * and price at $0 with no size to confirm. Fill any such interior room from
 * its room-type typical, flagged ai_assumed + assumedFields L/W, so it shows
 * "typical size — confirm" and the estimator adjusts rather than starts from
 * nothing. Mutates in place. (Feature #5, and the fix behind #4: a WC that
 * had no size to save now arrives pre-sized at 1.25 × 1.0.)
 */
export function backfillTypicalSizes(areas: DraftArea[], typicals: TypicalSizeRow[]): void {
  for (const a of areas) {
    if (a.type !== "Interior") continue;
    if (Number(a.L) > 0 && Number(a.W) > 0) continue;
    const size = typicalSize(a.roomType, typicals);
    a.L = size.L;
    a.W = size.W;
    a.origin = "ai_assumed";
    a.confidence = Math.min(a.confidence, 0.5);
    for (const f of ["L", "W"]) if (!a.assumedFields.includes(f)) a.assumedFields.push(f);
  }
}

export type StarterRoom = {
  name: string;
  roomType: string;
  storey: "Ground" | "First";
  /**
   * Where the typical size comes from when it isn't the room type's own row.
   * The open-plan kitchen/living is SCOPED as a living room (that room type
   * owns real scope rules; open_plan_kitchen_living is not an extraction
   * room type) but SIZED from its own 36 m² archetype.
   */
  sizeType?: string;
};

/**
 * Composition per the mockup's no-plan build, plus the open-plan archetype
 * split from business inputs §1. Double storey puts bedrooms and the
 * bathroom upstairs and adds a landing — the one room every double-storey
 * home has that the basics can't ask about.
 */
export function starterRoomList(basics: WizardBasics): StarterRoom[] {
  const up: StarterRoom["storey"] = basics.storeys === "double" ? "First" : "Ground";
  const rooms: StarterRoom[] = [];

  for (let i = 1; i <= basics.bedrooms; i++) {
    rooms.push({ name: `Bed ${i}`, roomType: "bedroom", storey: up });
  }
  if (basics.openPlanKitchenLiving) {
    rooms.push({ name: "Kitchen / Living", roomType: "living", sizeType: "open_plan_kitchen_living", storey: "Ground" });
  } else {
    rooms.push({ name: "Living room", roomType: "living", storey: "Ground" });
    rooms.push({ name: "Kitchen / Meals", roomType: "kitchen", storey: "Ground" });
  }
  rooms.push({ name: "Bathroom", roomType: "bathroom", storey: up });
  rooms.push({ name: "Laundry", roomType: "laundry", storey: "Ground" });
  rooms.push({ name: "Hall & Entry", roomType: "hallway", storey: "Ground" });
  if (basics.storeys === "double") {
    rooms.push({ name: "Landing & stairs", roomType: "hallway", storey: "First" });
  }
  return rooms;
}

/**
 * Typical openings per room type. Conservative: each room carries its own
 * side of its door; the hallway carries the hall side of the bedroom doors
 * (mockup: Hall & Entry "Doors ×3" on a 3-bed). Styles are "unknown" —
 * the wizard's "mostly" answers resolve them in merge.ts, or they stay
 * deferred (Tom's rule: a guessed style is a wrong rate on every door).
 */
function typicalOpenings(roomType: string, bedrooms: number): { doors: number; windows: number } {
  switch (roomType) {
    case "bedroom": return { doors: 1, windows: 1 };
    case "living": return { doors: 0, windows: 2 };
    case "open_plan_kitchen_living": return { doors: 0, windows: 3 };
    case "kitchen": return { doors: 0, windows: 1 };
    case "bathroom": return { doors: 1, windows: 1 };
    case "laundry": return { doors: 1, windows: 0 };
    case "hallway": return { doors: bedrooms, windows: 0 };
    case "wc": return { doors: 1, windows: 0 };
    default: return { doors: 0, windows: 0 };
  }
}

const unknownDoor = {
  type: "internal_hinged" as const,
  style: "unknown" as const,
  style_confidence: 0,
  width_m: null,
  confidence: 0.5,
};
const unknownWindow = {
  size_class: "unknown" as const,
  style: "unknown" as const,
  style_confidence: 0,
  confidence: 0.5,
};

/**
 * A synthetic Extraction for buildDraft. Never stored as a run reading —
 * it exists only so the starter list and a real plan go through the same
 * stage-5 drafting code.
 */
export function starterExtraction(
  rooms: StarterRoom[],
  typicals: TypicalSizeRow[],
  opts: { heightM: number | null; bedrooms: number },
): Extraction {
  const storeys = [...new Set(rooms.map((r) => r.storey))].map((label) => ({
    label,
    kind: label === "First" ? ("first" as const) : ("ground" as const),
    stated_area_m2: null,
  }));

  return {
    storeys,
    scale: { method: "none", stated_total_area_m2: null, not_to_scale_disclaimer: false, confidence: 0 },
    ceiling_height_m: opts.heightM,
    rooms: rooms.map((r) => {
      const size = typicalSize(r.sizeType ?? r.roomType, typicals);
      const openings = typicalOpenings(r.sizeType ?? r.roomType, opts.bedrooms);
      return {
        name_on_plan: r.name,
        normalised_type: r.roomType as Extraction["rooms"][number]["normalised_type"],
        storey: r.storey,
        length_m: size.L,
        width_m: size.W,
        dimension_source: "derived" as const,
        dimension_confidence: 0.5,
        area_m2_printed: null,
        irregular: false,
        cornice: "unknown" as const,
        doors: Array.from({ length: openings.doors }, () => ({ ...unknownDoor })),
        windows: Array.from({ length: openings.windows }, () => ({ ...unknownWindow })),
        openings_no_door: 0,
        wet_area: ["bathroom", "laundry", "wc"].includes(r.roomType),
        notes_read_from_plan: "",
      };
    }),
    has_site_plan: false,
    unreadable_regions: [],
  };
}

/**
 * After buildDraft: every starter room is a TYPICAL size, not a measurement.
 * Origin drops to ai_assumed and L/W join the assumed fields, so the editor
 * shows "typical size — tap to confirm" and the accuracy score counts these
 * rooms against the estimate until someone confirms them. L/W stay set —
 * pricing at the typical size is the point of the starter list; the review
 * gate's $0-room check keys on missing dimensions, so there is no double
 * counting.
 */
export function markStarterProvenance(areas: DraftArea[]): void {
  for (const a of areas) {
    a.origin = "ai_assumed";
    a.confidence = 0.5;
    for (const f of ["L", "W"]) {
      if (!a.assumedFields.includes(f)) a.assumedFields.push(f);
    }
  }
}

/**
 * Feature #2: a STARTER EXTERIOR scaffold. An exterior/both job whose envelope
 * measured nothing (no facade photos, or a floorplan with no cladding read)
 * used to produce ZERO exterior surfaces — the estimator saw only interior.
 * This lays out the four elevations with the usual exterior substrates,
 * UNMEASURED (priced $0, flagged for site check), so the estimator has the
 * scaffold to enter real measurements in the builder. No numbers are invented:
 * every line is a placeholder awaiting a measurement, consistent with the E1
 * rule that the envelope is measured, never derived.
 */
function extSurface(id: number, code: string): DraftSurfaceLike {
  return {
    id, code, internalLabel: code, clientLabel: code,
    coats: 2, count: 1, hidden: false, media: [],
    measureL: null, measureH: null, qtyOverride: null,
    rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
    productName: null, color: "", colorHex: "", coverageOverride: null,
    volumeOverride: null, unitPriceOverride: null, crewNote: "",
    hideQty: false, showCoats: false, showPrice: false, useCustomRate: false,
    customRate: null, open: false,
    origin: "ai_assumed", confidence: 0.4, assumedFields: ["exterior_envelope"],
  };
}

type DraftSurfaceLike = DraftArea["surfaces"][number];

/** The scaffold's cladding line: the first cladding substrate the user
 * ticked (weatherboards → render → tilt slab → brick), else weatherboards as
 * the conventional default — a placeholder to swap in the builder either way. */
function scaffoldCladdingCode(ticked: ReadonlySet<string>): string {
  if (ticked.has("weatherboards")) return "Weatherboards";
  if (ticked.has("render")) return "Render";
  if (ticked.has("concrete")) return "Concrete / Tilt Slab";
  if (ticked.has("brick")) return "Brick";
  return "Weatherboards";
}

export function starterExteriorNodes(
  nextId: () => number,
  ticked: ReadonlySet<string> = new Set(),
): { areas: DraftArea[]; deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }> } {
  const elevations = ["Front", "Left", "Right", "Rear"] as const;
  const areas: DraftArea[] = [];
  const deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }> = [];

  // A2: the scaffold is built FROM the page-2 ticks — an unticked trim never
  // appears; an empty tick set (older saved states) lays out the usual four.
  const wantsTrim = (key: string) => ticked.size === 0 || ticked.has(key);

  for (const name of elevations) {
    const id = nextId();
    const surfaces: DraftSurfaceLike[] = [extSurface(nextId(), scaffoldCladdingCode(ticked))];
    if (wantsTrim("fascias")) surfaces.push(extSurface(nextId(), "Fascias"));
    if (wantsTrim("gutters")) surfaces.push(extSurface(nextId(), "Gutters"));
    if (wantsTrim("eaves")) surfaces.push(extSurface(nextId(), "Eaves"));
    if (ticked.has("downpipes")) surfaces.push(extSurface(nextId(), "Downpipes"));
    if (ticked.has("exterior_windows")) surfaces.push(extSurface(nextId(), "Fixed / Picture Window"));
    if (ticked.has("exterior_doors") && name === "Front") surfaces.push(extSurface(nextId(), "Front Door"));

    areas.push({
      id, kind: "area", name: `Exterior - ${name}`, type: "Exterior", areaType: "surface",
      roomType: "exterior", storey: "ground",
      L: 0, W: 0, H: 0,
      isOption: false, description: "", open: false, media: [],
      origin: "ai_assumed", confidence: 0.4,
      assumedFields: ["exterior_envelope", "width_from_plan"],
      extractionSourceId: null,
      surfaces,
    });
    deferred.push({
      room: `Exterior - ${name}`, areaId: id, what: "wall + trim measurements", count: 1,
      needs: "width measurement required - measure this elevation on site and enter it in the builder",
      kind: "exterior_width",
    });
  }
  return { areas, deferred };
}

/** Ticked exterior EXTRAS — whole-job items (a deck, a fence, a pergola) that
 * no elevation photo or site plan measures. One "Exterior - Extras" area with
 * a $0 placeholder line per tick, each deferred for a site measurement, so
 * a ticked fence can never silently vanish from the estimate. */
const EXTRA_CODES: ReadonlyArray<{ key: string; code: string; label: string }> = [
  { key: "garage_doors", code: "Garage Door (1 Car)", label: "Garage door" },
  { key: "deck", code: "Deck Painting", label: "Deck" },
  { key: "fence", code: "Paling Fence", label: "Fence" },
  { key: "pergola", code: "Pergola", label: "Pergola" },
  { key: "balustrade", code: "Hand Rails", label: "Balustrades & hand rails" },
];

export function exteriorExtrasNodes(
  nextId: () => number,
  ticked: ReadonlySet<string>,
): { areas: DraftArea[]; deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }> } {
  const wanted = EXTRA_CODES.filter((e) => ticked.has(e.key));
  if (wanted.length === 0) return { areas: [], deferred: [] };

  const id = nextId();
  const surfaces = wanted.map((e) => extSurface(nextId(), e.code));
  const area: DraftArea = {
    id, kind: "area", name: "Exterior - Extras", type: "Exterior", areaType: "surface",
    roomType: "exterior", storey: "ground",
    L: 0, W: 0, H: 0,
    isOption: false, description: "", open: false, media: [],
    origin: "ai_assumed", confidence: 0.4,
    assumedFields: ["exterior_envelope"],
    extractionSourceId: null,
    surfaces,
  };
  const deferred = wanted.map((e) => ({
    room: "Exterior - Extras", areaId: id, what: `${e.label} measurements`, count: 1,
    needs: "selected on the surfaces page - measure on site and enter it in the builder",
    kind: "exterior_width",
  }));
  return { areas: [area], deferred };
}

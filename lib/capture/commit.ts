/**
 * RoomDraft -> the builder's own area node. Pure, no I/O.
 *
 * THE TWO RULES (room-loop brief section 0), enforced here:
 *   1. The tree is unchanged - what comes out is exactly the node
 *      QuoteBuilder's newArea()/newSurface() make by hand, same fields, same
 *      defaults, plus capture metadata the builder ignores.
 *   2. Capture must not change any price - so for a plain rectangular room we
 *      set ONLY L/W/H and let lib/pricing derive walls/ceiling/lineal exactly
 *      as it does for a hand-built room. Overrides are written only when the
 *      estimator explicitly measured something different (wall segments or a
 *      corrected perimeter), and then through the SAME fields the builder
 *      itself uses (qtyOverride / measureL).
 */
import { perimeterM, resolveQuantity, type RoomGeometry } from "./quantities";
import type { SurfaceTile } from "./presets";

/** One room's capture state - the client draft. */
export type RoomDraft = {
  localId: string;
  /** Builder node id when this room was committed before (re-entry edits it). */
  areaId?: number | null;
  name: string;
  roomType: string;
  storey: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  heightInherited: boolean;
  extraWallSegmentsM: number[];
  perimeterOverrideM: number | null;
  /** tileId -> count. Measured tiles use 1/0; countables the tap count. */
  selections: Record<string, number>;
  /** tileIds marked excluded (splashback-style "not this one"). */
  exclusions: string[];
  /** tileId -> extra prep hours (RoomReview stepper). */
  prepHours: Record<string, number>;
  /** tileId -> coats when changed from the default 2. */
  coats: Record<string, number>;
  /** tileId -> crew note. */
  crewNotes: Record<string, string>;
  /**
   * tileId -> observed defects. Hours are NEVER carried here - the commit
   * computes them from defect_prep_rates so a client cannot post its own
   * prep arithmetic. qty is in the rate's own unit (m2 / lineal m / each).
   */
  defects: Record<string, DefectObservation[]>;
  /** tileId -> manual painting-hours override (RoomReview). Bounded by the route. */
  hoursOverride?: Record<string, number>;
  /** A6: tileId -> window size (S/M/L rate multiplier). Absent = medium. */
  sizes?: Record<string, "small" | "medium" | "large">;
  /** tileId -> user label override ("Cupboard door"). */
  labels?: Record<string, string>;
  /** Duplicated substrate instances: unique id cloning a base tile. */
  extraTiles?: Array<{ id: string; from: string }>;
  /**
   * Work this room needs that isn't a painted surface: plastering, sealing raw
   * timber. Hours the estimator types on site, plus where — see ALLOWANCE_DEFS.
   */
  allowances?: Record<string, { hours: number; note: string }>;
  /**
   * 30 Aug: EVERY Walls tile now taps in quarters (100/75/50/25%). Before
   * that, only wet-area walls and exterior cladding did — an interior Walls
   * selection of 1 meant "on" (100%), which after the change would silently
   * read as 25%. This marker says the draft was written under the new
   * semantics; a draft without it is normalised by normalizeWallQuarters().
   */
  wallsQuartered?: boolean;
  status: "capturing" | "complete";
};

/** The room types whose Walls tile ALREADY tapped in quarters before 30 Aug. */
const LEGACY_QUARTERED_ROOMS = new Set(["bathroom", "wc", "laundry"]);

/**
 * Upgrade a pre-30-Aug draft to quarter-tap wall semantics. Interior non-wet
 * walls stored 1 for "the whole room's walls" — that must become 4, or every
 * restored draft would reprice at 25%. Wet rooms and exterior planes already
 * counted quarters, so their selections pass through untouched.
 */
export function normalizeWallQuarters(draft: RoomDraft): RoomDraft {
  if (draft.wallsQuartered) return draft;
  const legacyQuarters =
    LEGACY_QUARTERED_ROOMS.has(draft.roomType) || draft.roomType.startsWith("exterior");
  const selections = { ...draft.selections };
  if (!legacyQuarters) {
    for (const key of Object.keys(selections)) {
      if (key.endsWith(":Walls") && selections[key] === 1) selections[key] = 4;
    }
  }
  return { ...draft, selections, wallsQuartered: true };
}

/**
 * The two hour-and-a-note allowances (Tom, 23 Aug).
 *
 * Both are the same shape: real work, charged at the charge-out rate, with a
 * note saying WHERE — which is the part the crew actually needs.
 *
 * The hours ride `prepHr`, NOT a quantity. That is deliberate: pricing charges
 * prep hours at the charge-out rate whether or not the code matches a rate-card
 * row, so these price correctly with no new rate rows and no migration to wait
 * on. A rate row would also have had to be kept at exactly one hour per unit
 * for ever, and any drift there would have silently changed every plastering
 * line ever quoted.
 *
 * Raw timber is a TAG as much as an allowance: the note is stamped whether or
 * not hours are added, because the crew has to know to seal it before the
 * topcoats go on. Coat counts are untouched — Tom's call.
 */
export const ALLOWANCE_DEFS = [
  {
    code: "Plastering",
    label: "Plastering",
    hint: "Hours, and where it needs plastering",
    placeholder: "Where — e.g. hallway ceiling crack, patch behind the door",
    stamp: "",
  },
  {
    code: "Raw Timber Sealing",
    label: "Raw timber — seal first",
    hint: "Bare timber that needs sealing before the topcoats",
    placeholder: "Where — e.g. new architraves, replaced weatherboards",
    stamp: "RAW TIMBER — seal before topcoats.",
  },
] as const;

export type AllowanceCode = (typeof ALLOWANCE_DEFS)[number]["code"];

export type DefectObservation = { type: string; severity: 1 | 2 | 3; qty: number };

/** One row of defect_prep_rates as the commit needs it. */
export type DefectRate = {
  defect_type: string;
  unit: string; // m2 | lin_m | each
  hours_sev1: number;
  hours_sev2: number;
  hours_sev3: number;
};

export const DEFECT_LABELS: Record<string, string> = {
  peeling: "Peeling",
  flaking: "Flaking",
  water_damage: "Water damage",
  plaster_cracks: "Plaster cracks",
  holes_dents: "Holes / dents",
  previous_poor_finish: "Previous poor finish",
  mould: "Mould",
  nicotine_staining: "Nicotine staining",
  needs_bogging: "Needs bogging",
  needs_stripping: "Needs stripping",
  scraping_filling: "Scraping & filling",
  caulking: "Caulking",
  // R1.3: four types the reader emits that previously rendered as raw enums.
  render_cracks: "Render cracks",
  efflorescence: "Efflorescence",
  rust: "Rust",
  timber_rot: "Timber rot",
};

const DEFECT_UNIT_LABEL: Record<string, string> = { m2: "m2", lin_m: "lin m", each: "x" };

/** Hours for one observation, from the rates table. Unknown types cost nothing. */
export function defectHours(obs: DefectObservation, rates: DefectRate[]): number {
  const rate = rates.find((r) => r.defect_type === obs.type);
  if (!rate || obs.qty <= 0) return 0;
  const perUnit = obs.severity === 1 ? rate.hours_sev1 : obs.severity === 2 ? rate.hours_sev2 : rate.hours_sev3;
  return Math.round(perUnit * obs.qty * 100) / 100;
}

/** "Peeling sev2 3 m2 (0.54h)" - the reason, recorded on the work order. */
export function defectSummary(obs: DefectObservation[], rates: DefectRate[]): string {
  return obs
    .filter((o) => o.qty > 0)
    .map((o) => {
      const rate = rates.find((r) => r.defect_type === o.type);
      const unit = DEFECT_UNIT_LABEL[rate?.unit ?? ""] ?? "";
      return `${DEFECT_LABELS[o.type] ?? o.type} sev${o.severity} ${o.qty}${unit === "x" ? "" : " "}${unit} (${defectHours(o, rates)}h)`;
    })
    .join("; ");
}

export function emptyDraft(localId: string, name: string, roomType: string, storey: string, heightM: number): RoomDraft {
  return {
    localId, areaId: null, name, roomType, storey,
    lengthM: 0, widthM: 0, heightM, heightInherited: true,
    extraWallSegmentsM: [], perimeterOverrideM: null,
    selections: {}, exclusions: [], prepHours: {}, coats: {}, crewNotes: {},
    defects: {}, labels: {}, extraTiles: [], hoursOverride: {}, sizes: {}, allowances: {},
    wallsQuartered: true,
    status: "capturing",
  };
}

/** Exactly QuoteBuilder.newSurface()'s fields and defaults. */
type BuilderSurface = {
  id: number; code: string; internalLabel: string; clientLabel: string;
  coats: number; count: number;
  size: "small" | "medium" | "large" | null;
  hidden: boolean; media: never[];
  measureL: number | null; measureH: number | null;
  qtyOverride: number | null; rateOverride: number | null;
  paintingHrOverride: number | null; prepHr: number; priceOverride: number | null;
  productName: string | null; color: string; colorHex: string;
  coverageOverride: number | null; volumeOverride: number | null;
  unitPriceOverride: number | null; crewNote: string; hideQty: boolean;
  showCoats: boolean; showPrice: boolean; useCustomRate: boolean;
  customRate: number | null; open: boolean;
  origin: "human_confirmed"; confidence: 1; assumedFields: string[];
};

export type BuilderAreaNode = {
  id: number; kind: "area"; name: string; type: "Interior" | "Exterior";
  areaType: "room" | "surface"; L: number; W: number; H: number;
  isOption: boolean; description: string; open: boolean; media: never[];
  surfaces: BuilderSurface[];
  origin: "human_confirmed"; confidence: 1; assumedFields: string[];
  // capture metadata (brief section 8) - node fields in the jsonb tree
  capturedVia: "room_loop"; roomType: string; storey: string;
  perimeterM: number; perimeterOverridden: boolean; irregular: boolean;
  extraWallSegmentsM: number[]; perimeterOverrideM: number | null;
  /** The exact draft this node was committed from - re-entry restores it losslessly. */
  captureDraft: RoomDraft;
};

/** Whether the room's perimeter differs from plain 2(L+W). */
function perimeterDiffers(geo: RoomGeometry): boolean {
  const derived = 2 * (geo.lengthM + geo.widthM);
  return Math.abs(perimeterM(geo) - derived) > 1e-9;
}

/**
 * Build the area node. `nextId` allocates builder ids; call with the current
 * max+1 and it consumes ids sequentially exactly like the builder does.
 */
export function draftToAreaNode(
  draft: RoomDraft,
  tiles: SurfaceTile[],
  nextId: () => number,
  opts: { exterior?: boolean; defectRates?: DefectRate[] } = {},
): BuilderAreaNode {
  // A legacy draft (offline queue, stored captureDraft) may still carry
  // binary wall selections — upgrade before any fraction math sees them.
  draft = normalizeWallQuarters(draft);
  const defectRates = opts.defectRates ?? [];
  const geo: RoomGeometry = {
    lengthM: draft.lengthM, widthM: draft.widthM, heightM: draft.heightM,
    extraWallSegmentsM: draft.extraWallSegmentsM,
    perimeterOverrideM: draft.perimeterOverrideM,
  };
  const perim = perimeterM(geo);
  const irregular = draft.extraWallSegmentsM.length > 0;
  const overridden = perimeterDiffers(geo);
  const excluded = new Set(draft.exclusions);

  // Duplicated substrates become real tiles cloning their base's pricing.
  const allTiles = [
    ...tiles,
    ...(draft.extraTiles ?? []).flatMap((x) => {
      const base = tiles.find((t) => t.id === x.from);
      return base ? [{ ...base, id: x.id }] : [];
    }),
  ];
  const surfaces: BuilderSurface[] = [];
  for (const tile of allTiles) {
    const count = draft.selections[tile.id] ?? 0;
    if (count <= 0 || excluded.has(tile.id) || !tile.rateCode) continue;

    // Perimeter-driven quantities only override when the room isn't the plain
    // rectangle the builder would assume - rule 2.
    let qtyOverride: number | null = null;
    let measureL: number | null = null;
    // Fractional tiles: the tap count IS the fraction (1..4 = 25..100%) —
    // wet-area walls (room basis) and exterior cladding (plane basis) alike.
    const fraction = tile.fractional ? Math.min(count, 4) / 4 : 1;
    if (tile.fractional && fraction < 1) {
      const basis = tile.measureBasis === "plane_area" ? "plane_area" : "wall_area";
      qtyOverride = Math.round(resolveQuantity({ basis, geo }) * fraction * 100) / 100;
    }
    if (overridden) {
      if (tile.measureBasis === "wall_area") {
        qtyOverride = Math.round(resolveQuantity({ basis: "wall_area", geo }) * fraction * 100) / 100;
      } else if (tile.measureBasis === "perimeter") {
        measureL = perim;
      }
    }

    // Prep = the manual stepper + every recorded defect priced from the rates
    // table. The defect NAMES ride the crew note so the reason reaches site.
    const observations = draft.defects[tile.id] ?? [];
    const defectPrep = observations.reduce((n, o) => n + defectHours(o, defectRates), 0);
    const note = [draft.crewNotes[tile.id] ?? "", defectSummary(observations, defectRates)]
      .filter(Boolean).join(" | ");

    surfaces.push({
      id: nextId(),
      code: tile.rateCode,
      internalLabel: (draft.labels?.[tile.id] ?? tile.label) + (tile.fractional && fraction < 1 ? ` (${fraction * 100}%)` : ""),
      clientLabel: (draft.labels?.[tile.id] ?? tile.label) + (tile.fractional && fraction < 1 ? ` (${fraction * 100}%)` : ""),
      coats: draft.coats[tile.id] ?? 2,
      count: tile.countable && !tile.fractional ? count : 1,
      // A6: window size (rate multiplier); null/absent = medium.
      size: draft.sizes?.[tile.id] ?? null,
      hidden: false, media: [],
      measureL, measureH: null,
      qtyOverride, rateOverride: null,
      // The typed override is the TOTAL the review screen showed (painting +
      // the manual prep stepper). Pricing adds prepHr back on top, so the
      // manual prep is subtracted here — otherwise typing the displayed
      // number inflates the line by its prep hours.
      paintingHrOverride: draft.hoursOverride?.[tile.id] != null
        ? Math.max(0, Math.round((draft.hoursOverride[tile.id] - (draft.prepHours[tile.id] ?? 0)) * 100) / 100)
        : null,
      prepHr: Math.round(((draft.prepHours[tile.id] ?? 0) + defectPrep) * 100) / 100,
      priceOverride: null, productName: null, color: "", colorHex: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
      crewNote: note,
      hideQty: false, showCoats: false, showPrice: false,
      useCustomRate: false, customRate: null, open: false,
      origin: "human_confirmed", confidence: 1, assumedFields: [],
    });
  }

  // The hour-and-a-note allowances. One line each, the hours carried as PREP
  // hours — see the note on ALLOWANCE_DEFS — so 2.5 hours of plastering prices
  // as 2.5 hours at the charge-out rate. A raw-timber line with no hours still
  // rides, because the STAMP is the point: the crew must know to seal it.
  for (const def of ALLOWANCE_DEFS) {
    const entry = draft.allowances?.[def.code];
    if (!entry) continue;
    const hours = Math.max(0, Math.round((Number(entry.hours) || 0) * 100) / 100);
    const where = (entry.note ?? "").trim();
    if (hours <= 0 && !where && !def.stamp) continue;
    if (hours <= 0 && !where) continue;

    surfaces.push({
      id: nextId(),
      code: def.code,
      internalLabel: def.label,
      clientLabel: def.label,
      coats: 1,
      count: 1,
      size: null,
      hidden: false, media: [],
      measureL: null, measureH: null,
      // No painted quantity: this is hours of work, not m² of coating.
      qtyOverride: 0,
      rateOverride: null,
      paintingHrOverride: null,
      prepHr: hours,
      priceOverride: null, productName: null, color: "", colorHex: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
      crewNote: [def.stamp, where].filter(Boolean).join(" "),
      hideQty: false, showCoats: false, showPrice: false,
      useCustomRate: false, customRate: null, open: false,
      origin: "human_confirmed", confidence: 1, assumedFields: [],
    });
  }

  return {
    id: draft.areaId ?? nextId(),
    kind: "area",
    name: draft.name,
    type: opts.exterior ? "Exterior" : "Interior",
    // An elevation is one PLANE (width x height), not a room — pricing then
    // derives m2 as L x H and lineal as L, exactly like builder exteriors.
    areaType: opts.exterior ? "surface" : "room",
    L: draft.lengthM, W: draft.widthM, H: draft.heightM,
    isOption: false, description: "", open: false, media: [],
    surfaces,
    origin: "human_confirmed", confidence: 1, assumedFields: [],
    capturedVia: "room_loop",
    roomType: draft.roomType,
    storey: draft.storey,
    perimeterM: perim,
    perimeterOverridden: overridden,
    irregular,
    extraWallSegmentsM: draft.extraWallSegmentsM,
    perimeterOverrideM: draft.perimeterOverrideM,
    captureDraft: { ...draft, status: "complete" },
  };
}

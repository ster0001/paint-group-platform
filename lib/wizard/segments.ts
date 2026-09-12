import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openSpaceDimensions, type OpenCeiling, type OpenHeightBracket, type OpenSizeBracket } from "@/lib/pricing/commercial";
import type { QuickLook } from "./quick-look";
import {
  DEFAULT_WAREHOUSE_ANSWERS, warehouseAssumedList, warehouseRestatement, warehouseSurfaceKeys, type WarehouseAnswers,
} from "./warehouse";

/**
 * C12 — commercial SEGMENTS AS DATA (estimator journey v2 addendum S6a, §4.11).
 *
 * *"The wizard renders counts, open-space blocks, also-areas, surfaces, hours
 * and occupied from `commercial_segments`. No segment-specific JSX beyond
 * the two patterns (areas + job, warehouse) and the brief."* This module is
 * the shape of a row, the loader, the defaults that mirror the seed (so a
 * database that has not run the migration still renders the eight tiles),
 * and the pure helpers the screens and the submit route share: which
 * screens a segment walks, what its default answers are, and the room list
 * its counts and typicals seed.
 *
 * Nothing here is money. Open-space GEOMETRY (the bracket midpoints, the
 * wall height by mode) lives in `lib/pricing/commercial.ts`, because sizing a
 * wall is a pricing input — this file only asks it for a length and a width.
 *
 * ⚑ `DEFAULT_SEGMENTS` mirrors the migration's seed and `segments.test.ts`
 * parses the SQL to prove it. Edit the seed, and the test says where the
 * mirror drifted; never edit only one.
 */

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

const pair = z.tuple([z.string(), z.string()]);

export const segmentConfigSchema = z.object({
  kick: z.string().default(""),
  title: z.string().optional(),
  sub: z.string().optional(),
  /** "warehouse" = S6b's pattern (C13). Absent = the areas + job pattern. */
  pattern: z.enum(["areas", "warehouse"]).optional(),
  /** Halls and warehouses size walls by height, not floor area (§4.12). */
  openMode: z.enum(["size", "height"]).optional(),
  openCopy: z.string().optional(),
  /** health: aged care / clinic / hospital (⚑19). */
  kindQ: z.tuple([z.string(), z.array(pair)]).optional(),
  /** A kind answer that leaves for a brief — hospital → the hospital brief. */
  kindBrief: z.record(z.string(), z.string()).optional(),
  /** [key, label, hint, default] — the count rows with steppers. */
  counts: z.array(z.tuple([z.string(), z.string(), z.string(), z.number().int().min(0)])).optional(),
  openKey: z.string().optional(),
  openLabel: z.string().optional(),
  also: z.array(z.string()).optional(),
  /** "outside — priced on site" and the like: the tile shows it, the tree flags it. */
  alsoFlag: z.record(z.string(), z.string()).optional(),
  /** null = the warehouse pattern's own tiles (C13). */
  surf: z.array(z.string()).nullable().optional(),
  /** surface label → the wizard's substrate key it ticks; null = no rate yet,
   * flagged for the estimator instead of priced. Data, so a new surface is a
   * seed edit — never a switch on a label in code. */
  surfKeys: z.record(z.string(), z.string().nullable()).optional(),
  hours: z.array(pair).default([]),
  occ: z.tuple([z.string(), z.array(pair)]).nullable().optional(),
  wear: z.string().default(""),
  work: z.string().default(""),
});
export type SegmentConfig = z.infer<typeof segmentConfigSchema>;

export const segmentBriefSchema = z.object({
  kick: z.string(),
  title: z.string(),
  sub: z.string(),
  what: z.array(z.string()),
  rows: z.array(z.tuple([z.string(), z.array(z.string())])),
  photo: z.string().default(""),
  /** C14: which answers raise which site_checklist_items keys — `always` for
   * every brief of this kind, `rows` by question → option → key. */
  checklist: z.object({
    always: z.array(z.string()).default([]),
    rows: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  }).optional(),
  /** C14: a date the brief asks for (strata's meeting date), and the checklist key it fills. */
  date: z.object({ key: z.string(), label: z.string(), hint: z.string().default("") }).optional(),
});
export type SegmentBrief = z.infer<typeof segmentBriefSchema>;

const size = z.tuple([z.number().positive(), z.number().positive()]);
export const segmentTypicalsSchema = z.object({
  /** count key → [label, [L, W], scope room type] */
  rooms: z.record(z.string(), z.tuple([z.string(), size, z.string()])).default({}),
  /** also-area label → [L, W, scope room type | "outside"] */
  alsoSize: z.record(z.string(), z.tuple([z.number().positive(), z.number().positive(), z.string()])).default({}),
});
export type SegmentTypicals = z.infer<typeof segmentTypicalsSchema>;

export const segmentSchema = z.object({
  key: z.string().min(1).max(40),
  position: z.number().int().default(100),
  name: z.string(),
  tile_hint: z.string().default(""),
  route: z.enum(["range", "brief"]),
  tile: z.boolean().default(true),
  config: segmentConfigSchema.default({ kick: "", hours: [], wear: "", work: "" }),
  brief: segmentBriefSchema.nullable().default(null),
  typicals: segmentTypicalsSchema.default({ rooms: {}, alsoSize: {} }),
});
export type Segment = z.infer<typeof segmentSchema>;
export type SegmentRoute = Segment["route"];

// ---------------------------------------------------------------------------
// The mirror of the seed (20270140000000_commercial_segments.sql)
// ---------------------------------------------------------------------------

const HOURS_BUSINESS: [string, string][] = [["business", "Business hours"], ["after", "After hours"], ["weekend", "Weekends"]];

export const DEFAULT_SEGMENTS: Segment[] = [
  {
    key: "office", position: 10, name: "Office", tile_hint: "Suites, floors, fit-out make-good", route: "range", tile: true,
    config: {
      kick: "OFFICE", title: "Tell us about the office", sub: "Counts are fine. We size each one from typicals and you can adjust any of them after.",
      counts: [["offices", "Private offices", "Enclosed, one or two desks", 4], ["open", "Open-plan areas", "Workstations, breakout — we ask about the ceiling next", 1], ["meeting", "Meeting rooms and boardrooms", "", 1]],
      openKey: "open", openLabel: "Open-plan area", also: ["Reception", "Corridors", "Kitchen or break room", "Amenities", "Server or comms room", "Fire stairs"],
      surf: ["Walls", "Ceilings — plaster only", "Doors", "Door frames", "Window frames — timber only", "Skirtings", "Columns and bulkheads", "Feature walls"],
      surfKeys: { "Walls": "walls", "Ceilings — plaster only": "ceilings", "Doors": "doors", "Door frames": "architraves", "Window frames — timber only": "windows", "Skirtings": "skirting", "Columns and bulkheads": "walls", "Feature walls": "walls" },
      hours: HOURS_BUSINESS,
      occ: ["Is it occupied?", [["vacant", "Vacant — between tenants"], ["occ", "Occupied — furniture stays"]]],
      wear: "Scuffs, picture hooks, holes from the last fit-out", work: "Damaged plaster, water marks, patched walls",
    },
    brief: null,
    typicals: {
      rooms: { offices: ["Office", [3.5, 4], "study"], open: ["Open plan", [10, 8], "living"], meeting: ["Meeting room", [4, 5], "dining"] },
      alsoSize: { "Reception": [5, 4, "living"], "Corridors": [12, 1.8, "hallway"], "Kitchen or break room": [4, 3.5, "kitchen"], "Amenities": [3, 2.5, "bathroom"], "Server or comms room": [2.5, 2, "storage"], "Fire stairs": [3, 2.5, "hallway"] },
    },
  },
  {
    key: "warehouse", position: 20, name: "Industrial or warehouse", tile_hint: "Factory, storage, workshop", route: "range", tile: true,
    config: {
      kick: "INDUSTRIAL OR WAREHOUSE", pattern: "warehouse", surf: null,
      hours: HOURS_BUSINESS, occ: null,
      wear: "Dust, scuffs, forklift marks", work: "Forklift damage, rust, cracked blockwork",
    },
    brief: null, typicals: { rooms: {}, alsoSize: {} },
  },
  {
    key: "retail", position: 30, name: "Retail, hospitality, restaurants", tile_hint: "Shops, cafés, restaurants, bars", route: "range", tile: true,
    config: {
      kick: "RETAIL, HOSPITALITY AND RESTAURANTS", title: "Tell us about the shop or venue", sub: "Shops, cafés, restaurants and bars follow the same shape: the front of house is the part that's easy to misprice, and kitchens get a washable system.",
      openCopy: "Front of house — sales floors and dining rooms — is where prices go wrong: exposed or black ceilings, a full-width frontage, a lot of cutting-in. Tell us the size and the ceiling, and a photo lets your estimator check.",
      counts: [["floor", "Sales floor or dining areas", "Usually one or two — we ask about the ceiling next", 1], ["boh", "Back of house, kitchens and store rooms", "Commercial kitchens get a washable, wipe-down system", 1], ["fit", "Fitting rooms or private dining", "", 0]],
      openKey: "floor", openLabel: "Front of house area", also: ["Bar", "Amenities", "Staff room", "Corridor", "Covered outdoor dining"], alsoFlag: { "Covered outdoor dining": "outside — priced on site" },
      surf: ["Walls", "Ceilings — plaster only", "Exposed ceiling — sprayed", "Kitchen walls — washable", "Doors", "Door frames", "Skirtings", "Feature walls"],
      surfKeys: { "Walls": "walls", "Ceilings — plaster only": "ceilings", "Exposed ceiling — sprayed": null, "Kitchen walls — washable": "walls", "Doors": "doors", "Door frames": "architraves", "Skirtings": "skirting", "Feature walls": "walls" },
      hours: [["after", "After trading"], ["before", "Before opening"], ["closed", "Any time — closed for refit"]],
      occ: ["Stock, fixtures and furniture?", [["vacant", "Cleared — empty"], ["occ", "Stays — we work around it"]]],
      wear: "Scuffs, fixing holes, sign shadows, grease near the kitchen", work: "Damaged plaster, water marks, heat damage behind the kitchen line",
    },
    brief: null,
    typicals: {
      rooms: { floor: ["Front of house", [10, 8], "living"], boh: ["Back of house", [5, 4], "kitchen"], fit: ["Fitting room", [1.5, 1.5], "storage"] },
      alsoSize: { "Bar": [6, 3, "living"], "Amenities": [3, 2.5, "bathroom"], "Staff room": [4, 3.5, "living"], "Corridor": [8, 1.5, "hallway"], "Covered outdoor dining": [8, 5, "outside"] },
    },
  },
  {
    key: "health", position: 40, name: "Healthcare or aged care", tile_hint: "Aged care and clinics online · hospitals we visit", route: "range", tile: true,
    config: {
      kick: "HEALTHCARE OR AGED CARE", title: "Tell us about the facility", sub: "Counts are fine. We work in small areas at a time around residents and patients, and price it that way.",
      openCopy: "Lounges and dining rooms are open, with tiled or set ceilings and a lot of cutting-in. Tell us the size and the ceiling; a photo or two lets your estimator check.",
      kindQ: ["Which kind?", [["aged", "Aged care"], ["clinic", "Medical centre or clinic"], ["hospital", "Hospital — we visit"]]], kindBrief: { hospital: "hospital" },
      counts: [["rooms", "Resident rooms, wards or treatment rooms", "", 12], ["lounges", "Lounges and dining rooms", "Open spaces — we ask about them next", 2], ["corr", "Corridors or wings", "", 2]],
      openKey: "lounges", openLabel: "Lounge or dining room", also: ["Nurses' stations", "Reception", "Amenities", "Kitchen", "Fire stairs"],
      surf: ["Walls", "Ceilings — plaster only", "Doors", "Door frames", "Handrails and bump rails", "Skirtings", "Window frames — timber only", "Feature walls"],
      surfKeys: { "Walls": "walls", "Ceilings — plaster only": "ceilings", "Doors": "doors", "Door frames": "architraves", "Handrails and bump rails": null, "Skirtings": "skirting", "Window frames — timber only": "windows", "Feature walls": "walls" },
      hours: [["business", "Daytime"], ["after", "After hours"], ["staged", "Staged, a wing at a time"]],
      occ: ["Working around residents or patients?", [["occ", "Yes — small areas at a time"], ["vacant", "No — the area will be closed"]]],
      wear: "Scuffs, trolley marks, bed-head knocks", work: "Damaged plaster, bump-rail damage, water marks",
    },
    brief: {
      kick: "HOSPITAL", title: "Tell us about the hospital", sub: "Hospitals are priced on site — infection control, clearances and approvals come before the painting. A few questions get us ready, then you pick a time.",
      what: ["Wards", "Corridors", "Treatment rooms", "Theatres or clinical areas", "Common areas and reception", "Exterior"],
      rows: [["Working hours", ["Staged around patients", "Closed areas only", "After hours"]], ["You are", ["Facilities manager", "Maintenance", "Project manager"]]],
      photo: "— a ward, a corridor, a treatment room",
      checklist: { always: ["hazmat_check", "induction", "low_odour"], rows: {} },
    },
    typicals: {
      rooms: { rooms: ["Room", [3.5, 4], "bedroom"], lounges: ["Lounge", [8, 7], "living"], corr: ["Corridor", [20, 2], "hallway"] },
      alsoSize: { "Nurses' stations": [5, 4, "study"], "Reception": [5, 4, "living"], "Amenities": [3, 2.5, "bathroom"], "Kitchen": [5, 4, "kitchen"], "Fire stairs": [3, 2.5, "hallway"] },
    },
  },
  {
    key: "school", position: 50, name: "School or education", tile_hint: "Classrooms, halls, corridors", route: "range", tile: true,
    config: {
      kick: "SCHOOL OR EDUCATION", title: "Tell us about the school", sub: "Counts are fine. Most school work happens in the holidays — tell us the window and we plan around it.", openMode: "height",
      openCopy: "Halls and gyms have high walls. Above about four metres we allow for a platform or lift, shown as its own line — the height matters more than the floor area.",
      counts: [["classrooms", "Classrooms", "", 8], ["halls", "Halls or gyms", "High ceilings — we ask about them next", 1], ["corr", "Corridors", "", 2]],
      openKey: "halls", openLabel: "Hall or gym", also: ["Admin offices", "Staff room", "Toilets", "Library", "Covered outdoor areas", "Canteen"], alsoFlag: { "Covered outdoor areas": "outside — priced on site" },
      surf: ["Walls", "Ceilings — plaster only", "Doors", "Door frames", "Skirtings", "Window frames — timber only", "Pinboard surrounds", "Feature walls"],
      surfKeys: { "Walls": "walls", "Ceilings — plaster only": "ceilings", "Doors": "doors", "Door frames": "architraves", "Skirtings": "skirting", "Window frames — timber only": "windows", "Pinboard surrounds": null, "Feature walls": "walls" },
      hours: [["holidays", "School holidays"], ["after", "After hours in term"], ["weekend", "Weekends"]],
      occ: ["Which holidays?", [["next", "The next break"], ["later", "A later one"], ["ns", "Not sure yet"]]],
      wear: "Scuffs, blu-tack, pinboard marks", work: "Damaged plaster, water marks, graffiti",
    },
    brief: null,
    typicals: {
      rooms: { classrooms: ["Classroom", [8, 7], "living"], halls: ["Hall", [20, 15], "living"], corr: ["Corridor", [25, 2.2], "hallway"] },
      alsoSize: { "Admin offices": [4, 3.5, "study"], "Staff room": [6, 5, "living"], "Toilets": [4, 3, "bathroom"], "Library": [10, 8, "living"], "Covered outdoor areas": [12, 6, "outside"], "Canteen": [6, 5, "kitchen"] },
    },
  },
  {
    key: "strata", position: 60, name: "Strata or common property", tile_hint: "Lobbies, stairwells, facade", route: "brief", tile: true,
    config: { kick: "", hours: [], wear: "", work: "" },
    brief: {
      kick: "STRATA OR COMMON PROPERTY", title: "Tell us what the building needs", sub: "Buildings like this are priced on site — access, heights and shared areas can't be guessed from a form. Four quick questions get us ready, then you pick a time.",
      what: ["Lobbies and corridors", "Stairwells", "Lift lobbies", "Car park", "Fire doors", "Exterior facade", "Balconies", "Fences and gates"],
      rows: [["Levels", ["1–3", "4–8", "9+"]], ["Approx. units", ["Under 10", "10–30", "30–80", "80+"]], ["You are", ["Owners corp manager", "Committee member", "Building manager", "Owner"]], ["Is there a scope of works already?", ["Yes — I can send it", "No"]], ["Timing", ["Before the next meeting", "No rush"]]],
      photo: "— the lobby, a corridor, a stairwell, the outside from the street",
      checklist: { always: ["hazmat_check"], rows: { "Timing": { "Before the next meeting": "meeting_date" } } },
      date: { key: "meeting_date", label: "Your next meeting date", hint: "The quote is held to it, so we work back from it" },
    },
    typicals: { rooms: {}, alsoSize: {} },
  },
  {
    key: "shopfront", position: 70, name: "Shop front — the facade", tile_hint: "Street frontage, awnings, signage", route: "brief", tile: true,
    config: { kick: "", hours: [], wear: "", work: "" },
    brief: {
      kick: "SHOP FRONT — THE FACADE", title: "Tell us about the frontage", sub: "Shop fronts are priced on site — awnings, signage, heights and the footpath change everything. A few questions get us ready, then you pick a time.",
      what: ["Render or masonry", "Timber", "Metal frames or shutters", "Awning or verandah", "Signage to work around", "Roller shutter or grille"],
      rows: [["Levels on the frontage", ["Ground only", "Two", "More"]], ["Where is it?", ["Strip shop", "Shopping centre", "Stand-alone"]], ["Trading hours we work around?", ["Yes", "No — closed for refit"]], ["Footpath in front?", ["Yes", "No"]]],
      photo: "— from across the street, and one close up of the frontage",
      checklist: { always: ["hazmat_check"], rows: { "Where is it?": { "Shopping centre": "centre_rules" } } },
    },
    typicals: { rooms: {}, alsoSize: {} },
  },
  {
    key: "other", position: 80, name: "Something else", tile_hint: "Church, club, gym, hotel…", route: "brief", tile: true,
    config: { kick: "", hours: [], wear: "", work: "" },
    brief: {
      kick: "SOMETHING ELSE", title: "Tell us a bit about the place", sub: "A few questions get us ready, then you pick a time.",
      what: ["Inside", "Outside", "Both"],
      rows: [["Roughly how big?", ["One room or space", "A few spaces", "A whole building"]], ["Approx. height", ["Up to 4 m", "Over 4 m"]], ["You are", ["Owner", "Manager", "Committee"]]],
      photo: "— a few of the spaces",
      checklist: { always: ["hazmat_check"], rows: {} },
    },
    typicals: { rooms: {}, alsoSize: {} },
  },
  {
    key: "exterior", position: 90, name: "Commercial — outside", tile_hint: "Every commercial exterior is priced on site", route: "brief", tile: false,
    config: { kick: "", hours: [], wear: "", work: "" },
    brief: {
      kick: "COMMERCIAL — OUTSIDE", title: "Tell us about the outside", sub: "The outside of a commercial building is always priced on site — heights, access equipment and traffic management decide the job. A few questions get us ready, then you pick a time.",
      what: ["Render or masonry", "Precast or tilt slab", "Metal cladding", "Timber", "Windows and frames", "Roller doors", "Fences and gates", "Signage to work around"],
      rows: [["Levels", ["Ground only", "Two", "More"]], ["Street frontage or footpath?", ["Yes", "No"]], ["Trading or operating while we work?", ["Yes", "No"]]],
      photo: "— from across the street, and each side you can reach",
      checklist: { always: ["hazmat_check"], rows: { "Street frontage or footpath?": { "Yes": "loading_dock" } } },
    },
    typicals: { rooms: {}, alsoSize: {} },
  },
];

// ---------------------------------------------------------------------------
// Loading and lookup
// ---------------------------------------------------------------------------

/**
 * Parse rows from the table; a row that fails the schema is dropped and named,
 * never silently rendered half-shaped. An empty result (the migration not run
 * yet, a read error) falls back to the mirror so the screens still work.
 */
export function parseSegments(rows: unknown[] | null | undefined): Segment[] {
  const out: Segment[] = [];
  for (const r of rows ?? []) {
    const p = segmentSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out.length ? out.sort((a, b) => a.position - b.position) : DEFAULT_SEGMENTS;
}

export async function loadSegments(db: SupabaseClient): Promise<Segment[]> {
  const { data, error } = await db.from("commercial_segments")
    .select("key, position, name, tile_hint, route, tile, config, brief, typicals")
    .order("position", { ascending: true });
  if (error) return DEFAULT_SEGMENTS;
  return parseSegments(data);
}

/**
 * Phase 7a's six keys, mapped onto the table's. `healthcare` and `industrial`
 * were renamed by the prototype; every stored draft that still carries the
 * old word resolves to the row it meant.
 */
export const LEGACY_SEGMENT_KEYS: Record<string, string> = { healthcare: "health", industrial: "warehouse" };

export function resolveSegmentKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return LEGACY_SEGMENT_KEYS[key] ?? key;
}

export function segmentByKey(segments: Segment[], key: string | null | undefined): Segment | null {
  const k = resolveSegmentKey(key);
  return k ? segments.find((s) => s.key === k) ?? null : null;
}

/** The tiles, in order: the rows with `tile = true`. */
export function segmentTiles(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.tile);
}

/** The tag on a tile — derived from the route, never typed per tile. */
export function routeTag(route: SegmentRoute): string {
  return route === "range" ? "ONLINE · OR WE VISIT" : "WE VISIT";
}

// ---------------------------------------------------------------------------
// The customer's commercial answers
// ---------------------------------------------------------------------------

export const OPEN_SIZES: { value: OpenSizeBracket; label: string }[] = [
  { value: "50", label: "Up to 50 m²" }, { value: "150", label: "50–150" }, { value: "400", label: "150–400" }, { value: "800", label: "400+" },
];
export const OPEN_HEIGHTS: { value: OpenHeightBracket; label: string }[] = [
  { value: "4", label: "Up to 4 m" }, { value: "6", label: "4–6 m" }, { value: "9", label: "Over 6 m" },
];
export const OPEN_CEILINGS: { value: OpenCeiling; label: string }[] = [
  { value: "tiles", label: "Tiles — not painted" }, { value: "plaster", label: "Plaster — painted" }, { value: "exposed", label: "Exposed — not included" },
];

/** What the commercial screens write to the state (`state.commercial`).
 * C13: the warehouse pattern's answers ride the same block (lib/wizard/warehouse.ts). */
export type CommercialAnswers = {
  segment: string;
  kind: string | null;
  counts: Record<string, number>;
  openSize: OpenSizeBracket;
  openHeight: OpenHeightBracket | null;
  ceiling: OpenCeiling;
  also: string[];
  surfaces: string[];
  hours: string;
  occ: string | null;
} & WarehouseAnswers;

export function isWarehouse(seg: Pick<Segment, "config"> | null | undefined): boolean {
  return seg?.config.pattern === "warehouse";
}

/** The prototype's defaults: every count at its seed value, the first tile of each row on. */
export function defaultCommercialAnswers(seg: Segment): CommercialAnswers {
  const c = seg.config;
  return {
    segment: seg.key,
    kind: c.kindQ?.[1][0]?.[0] ?? null,
    counts: Object.fromEntries((c.counts ?? []).map(([k, , , d]) => [k, d])),
    openSize: "150",
    openHeight: c.openMode === "height" ? "6" : null,
    ceiling: "tiles",
    also: [],
    // The prototype ticks the first six surfaces.
    surfaces: (c.surf ?? []).slice(0, 6),
    hours: c.hours[0]?.[0] ?? "",
    occ: c.occ?.[1][0]?.[0] ?? null,
    ...DEFAULT_WAREHOUSE_ANSWERS,
  };
}

/** The open-space count for a segment's answers, 0 when the pattern has none. */
export function openCount(seg: Segment, a: Pick<CommercialAnswers, "counts">): number {
  const key = seg.config.openKey;
  if (!key) return 0;
  const def = seg.config.counts?.find((c) => c[0] === key)?.[3] ?? 0;
  return Math.max(0, a.counts[key] ?? def);
}

/** Does this kind answer leave for a brief (hospital)? Returns the brief key. */
export function kindLeavesForBrief(seg: Segment, kind: string | null): string | null {
  if (!kind || !seg.config.kindBrief) return null;
  return seg.config.kindBrief[kind] ?? null;
}

/**
 * The substrate keys the ticked surfaces select (what `state.surfaces`
 * carries into the merge), and the ticked labels that have no rate yet —
 * those become flagged lines, never a guess. Walls ride whenever nothing
 * mapped, so a job can never price to nothing by an unlucky set of ticks.
 */
export function commercialSurfaceKeys(seg: Segment, a: Pick<CommercialAnswers, "surfaces"> & Partial<WarehouseAnswers>): { keys: string[]; unmapped: string[] } {
  // C13: the warehouse pattern's ticks are the industrial surfaces and materials.
  if (isWarehouse(seg)) return { keys: warehouseSurfaceKeys({ ...DEFAULT_WAREHOUSE_ANSWERS, ...a }), unmapped: [] };
  const map = seg.config.surfKeys ?? {};
  const keys: string[] = [];
  const unmapped: string[] = [];
  for (const label of a.surfaces) {
    if (!(label in map)) continue;
    const k = map[label];
    if (k == null) unmapped.push(label);
    else if (!keys.includes(k)) keys.push(k);
  }
  return { keys: keys.length ? keys : ["walls"], unmapped };
}

// ---------------------------------------------------------------------------
// The room list: counts × typicals, plus the also-areas
// ---------------------------------------------------------------------------

export type CommercialRoom = {
  name: string;
  /** The scope room type the room is priced as (lib/extract/scope rules). */
  roomType: string;
  L: number;
  W: number;
  /** The open-space areas: sized from the bracket, ceiling by the answer. */
  open: boolean;
  /** An also-area configured as outside — flagged for the estimator, never priced. */
  outside: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * *"Seed the tree from counts and typicals (⚑23) and also-areas."* Every
 * count key becomes N rooms named from the typical's label (Office 1, Office
 * 2…), each at the typical size; the open-space areas take the bracket
 * instead. An also-area is one room at its own typical, or an outside flag.
 */
export function commercialRoomList(seg: Segment, a: CommercialAnswers): CommercialRoom[] {
  const rooms: CommercialRoom[] = [];
  const c = seg.config;
  for (const [key, , , def] of c.counts ?? []) {
    const n = Math.max(0, Math.min(500, Math.round(a.counts[key] ?? def)));
    const typ = seg.typicals.rooms[key];
    if (!typ || n === 0) continue;
    const [label, [L, W], roomType] = typ;
    const open = key === c.openKey;
    const dims = open ? openSpaceDimensions(a.openSize) : { L, W };
    for (let i = 1; i <= n; i++) {
      rooms.push({ name: n > 1 ? `${label} ${i}` : label, roomType, L: round2(dims.L), W: round2(dims.W), open, outside: false });
    }
  }
  for (const label of a.also) {
    const typ = seg.typicals.alsoSize[label];
    if (!typ) continue;
    const [L, W, roomType] = typ;
    const outside = roomType === "outside" || Boolean(c.alsoFlag?.[label]);
    rooms.push({ name: label, roomType: outside ? "unknown" : roomType, L, W, open: false, outside });
  }
  return rooms;
}

// ---------------------------------------------------------------------------
// The reveal's words
// ---------------------------------------------------------------------------

function joinList(parts: string[]): string {
  return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Based on an office with 4 private offices, 1 open-plan area and 1 meeting room…" */
export function commercialRestatement(seg: Segment, a: CommercialAnswers, q: Pick<QuickLook, "changing" | "bold" | "undecided" | "condition">): string {
  const c = seg.config;
  if (isWarehouse(seg)) {
    const changing = q.undecided || q.changing.walls || q.changing.ceilings || q.changing.trims;
    return warehouseRestatement(a, !changing ? "same" : q.bold ? "bold" : "new", q.condition);
  }
  const counted = (c.counts ?? [])
    .map(([key, , , def]) => ({ n: a.counts[key] ?? def, typ: seg.typicals.rooms[key] }))
    .filter((x) => x.n > 0 && x.typ)
    .map((x) => plural(x.n, x.typ![0].toLowerCase()));
  const also = a.also.filter((l) => !c.alsoFlag?.[l]).map((l) => l.toLowerCase());
  const changing = (["walls", "ceilings", "trims"] as const).filter((k) => q.changing[k]);
  const named = joinList(changing.map((k) => (k === "trims" ? "doors and trims" : k)));
  const colour = q.undecided ? "colours still being chosen"
    : changing.length === 0 ? "the same colours"
    : q.bold ? `a much lighter or bolder colour on the ${named}`
    : `new colours on the ${named}`;
  const cond = q.condition === "good" ? "good condition" : q.condition === "wear" ? "some wear" : "needing some work";
  const hours = c.hours.find(([v]) => v === a.hours)?.[1]?.toLowerCase();
  const an = /^[aeiou]/i.test(seg.name) ? "an" : "a";
  const what = counted.length ? `${an} ${seg.name.toLowerCase()} with ${joinList(counted)}` : `${an} ${seg.name.toLowerCase()}`;
  return `Based on ${what}${also.length ? `, plus ${joinList(also)}` : ""}, ${colour}, ${cond}${hours ? `, ${hours}` : ""}. If that's about right, this is about right.`;
}

export type CommercialAssumption = { key: string; what: string; why: string; rung?: string };

/** The segment assume list — what we decided for them, each a tap away. */
export function commercialAssumedList(seg: Segment, a: CommercialAnswers, photos: number): CommercialAssumption[] {
  const c = seg.config;
  if (isWarehouse(seg)) return warehouseAssumedList(a);
  const out: CommercialAssumption[] = [];
  const n = openCount(seg, a);
  out.push({
    key: "rooms",
    what: "Typical sizes for each area",
    why: "Sized from our averages for this kind of place — the biggest single thing you can tighten, area by area.",
    rung: "rooms",
  });
  if (n > 0 && c.openLabel) {
    const label = `${c.openLabel}${n > 1 ? "s" : ""}`;
    if (c.openMode === "height") {
      const h = OPEN_HEIGHTS.find((o) => o.value === a.openHeight)?.label.toLowerCase() ?? "4–6 m";
      out.push({
        key: "open",
        what: `${label} at ${h} — ${a.openHeight != null && Number(a.openHeight) > 4 ? "platform or lift allowed for" : "ladder reach"}`,
        why: "Walls sized from the floor area and the height. The access equipment is its own line, and a person confirms it.",
        rung: "rooms",
      });
    } else {
      const ceil = a.ceiling === "plaster" ? "plaster ceilings (painted)" : a.ceiling === "tiles" ? "tiled ceilings (not painted)" : "exposed ceilings (not included)";
      out.push({
        key: "open",
        what: `${label} sized from the bracket, ${ceil}, cutting-in allowed for`,
        why: photos > 0 ? "Your photo is with your estimator to check the shape of it." : "A photo or two narrows this — without one the range stays wider.",
        rung: "rooms",
      });
    }
  }
  out.push({
    key: "systems",
    what: "The coats and preparation for each surface",
    why: "Worked out from your colours and condition answers, not guessed — check it and change any line.",
    rung: "systems",
  });
  if (c.openMode !== "height") {
    out.push({
      key: "height",
      what: "Standard ceiling height in the smaller rooms",
      why: "We've assumed the usual 2.4 m in offices and corridors. Higher ceilings change the access and the paint.",
      rung: "rooms",
    });
  }
  const hours = c.hours.find(([v]) => v === a.hours)?.[1];
  if (hours) {
    out.push({
      key: "hours",
      what: `${hours} — allowed for in the labour`,
      why: "Out-of-hours and staged work carry a loading on the hours, never on the materials.",
    });
  }
  out.push({
    key: "excluded",
    what: "No scaffolding, structural repairs or signage work",
    why: "Access equipment and anything structural are quoted separately if they turn out to be needed.",
  });
  return out;
}

// ---------------------------------------------------------------------------
// C14 — the brief
// ---------------------------------------------------------------------------

/** The brief config a brief key names: the segment's own row, the health row for a hospital, the exterior row for outside work. */
export function briefConfigFor(segments: Segment[], briefKey: string | null | undefined): { row: Segment; brief: SegmentBrief } | null {
  if (!briefKey) return null;
  const rowKey = briefKey === "hospital" ? "health" : briefKey;
  const row = segmentByKey(segments, rowKey);
  return row?.brief ? { row, brief: row.brief } : null;
}

/** What the customer answered on the brief screen (`state.brief`). */
export type BriefAnswers = {
  briefKey: string;
  what: string[];
  answers: Record<string, string>;
  notes: string;
  date: string | null;
};

export function defaultBriefAnswers(briefKey: string, brief: SegmentBrief): BriefAnswers {
  return {
    briefKey,
    what: brief.what.length ? [brief.what[0]] : [],
    answers: Object.fromEntries(brief.rows.map(([q, opts]) => [q, opts[0]])),
    notes: "",
    date: null,
  };
}

/**
 * The site_checklist_items a brief raises, from the config's map: the
 * `always` keys, plus one per answered row whose option names a key, plus
 * the date question's key when a date was given (its value is the date).
 */
export function checklistFromBrief(brief: SegmentBrief, a: BriefAnswers): Array<{ key: string; value: string | null }> {
  const out = new Map<string, string | null>();
  for (const k of brief.checklist?.always ?? []) out.set(k, null);
  for (const [q, byOption] of Object.entries(brief.checklist?.rows ?? {})) {
    const picked = a.answers[q];
    const key = picked != null ? byOption[picked] : undefined;
    if (key) out.set(key, picked);
  }
  if (brief.date && a.date) out.set(brief.date.key, a.date);
  return [...out.entries()].map(([key, value]) => ({ key, value }));
}

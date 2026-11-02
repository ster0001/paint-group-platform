import type { SiteAccess } from "@/lib/wizard/site-access";
import type { CustomerScopeRoom, CustomerTile, RoomSpot } from "@/lib/wizard/scope-editor";
import type { RoomLoopView } from "@/lib/wizard/rooms-loop";
import type { SideKey, SidesView, SideView } from "@/lib/wizard/sides";

/**
 * QUOTE STAGE v10 — the cards, as data (brief §3; prototype
 * `design/reference/wizard-quote-stage-v10-prototype.html`).
 *
 * "Get my detailed price" is one question per card: the whole-house
 * questions first (A), then the rooms one at a time (B, four cards each —
 * the size, what we're painting in here, robes and cupboards, anything
 * needing attention), then the last checks (E — every room? anything we
 * haven't listed?) and the done screen (F). Every card writes an
 * EXISTING `wizard-edit` action (R0, R3 — the inventory in the S0 map of
 * `docs/briefs/quote-stage-v10-progress.md`); this module only says which
 * cards exist, in what order, with what words and options. Pure: nothing
 * here renders, prices or posts.
 */
export type JobKind = "interior" | "trims" | "exterior";

export type CardOption = {
  value: string;
  label: string;
  hint?: string;
  /** A drawing on the tile (the doors and the windows cards). */
  drawing?: "door-panel" | "door-flat" | "win-casement" | "win-sash" | "win-colonial" | "win-winder";
  /** The `wizard-edit` action this answer writes. */
  action: Record<string, unknown>;
};

export type GeneralCard = {
  kind: "general";
  /** `g:<key>` — the key names the answer in `GeneralAnswers`. */
  id: string;
  key: GeneralKey;
  stage: string;
  question: string;
  hint?: string;
  options: CardOption[];
  /** The answer so far (pre-selected), or null. */
  value: string | null;
  columns: 2 | 3 | 4;
};
export type MeasureCard = {
  kind: "measure";
  id: string;
  areaId: number;
  name: string;
  stage: string;
  lengthM: number; widthM: number; heightM: number;
  /** The customer typed the size (`room_dims`); else the typical stands. */
  measured: boolean;
  /** "Not sure — use the typical size for now" was taken (`room_size_ok`), or the size was never touched. */
  typical: boolean;
  position: { n: number; of: number };
};
/** §3 B2 — "What we're painting in here": the room's tiles, its window groups, the door scope and the wall share. */
export type SurfacesCard = { kind: "surfaces"; id: string; areaId: number; name: string; stage: string; room: QuoteRoom };
/** §3 B3 — robes and cupboards; only where the room type has a cupboard row to write (D-Q4, see the ledger). */
export type RobeCard = { kind: "robe"; id: string; areaId: number; name: string; stage: string; room: QuoteRoom };
/** §3 B4 — anything needing attention: the spot tags, how much, a photo; a feature wall. */
export type AttentionCard = { kind: "attention"; id: string; areaId: number; name: string; stage: string; room: QuoteRoom };
/** §3 E1 — have we got every room? (+ the doors-and-windows check and a plan garage, kept from the live page). */
export type RoomsCard = { kind: "rooms"; id: "rooms"; stage: string; rooms: QuoteRoom[]; doors: number; windows: number };
/** §3 E2 — anything we haven't listed? */
export type ExtrasCard = { kind: "extras"; id: "extras"; stage: string };
/** §3 C — per painted side: how big (across · high), on this side (counts, the paint's condition), anything needing attention. */
export type SideSizeCard = { kind: "side-size"; id: string; areaId: number; sideKey: SideKey; name: string; stage: string; side: QuoteRoom; position: { n: number; of: number } };
export type SideOnCard = { kind: "side-on"; id: string; areaId: number; sideKey: SideKey; name: string; stage: string; side: QuoteRoom };
export type SideAttentionCard = { kind: "side-attn"; id: string; areaId: number; sideKey: SideKey; name: string; stage: string; side: QuoteRoom };
export type DoneCard = { kind: "done"; id: "done"; stage: string };
export type QuoteCard = GeneralCard | MeasureCard | SurfacesCard | RobeCard | AttentionCard | RoomsCard | ExtrasCard | SideSizeCard | SideOnCard | SideAttentionCard | DoneCard;

export type GeneralKey = "cornices" | "height" | "doors" | "windows" | "paintBase" | "glossTrims" | "cleared" | "stairwell" | "parking" | "lift";
export type GeneralAnswers = Partial<Record<GeneralKey, string | null>>;

export type QuoteRoom = {
  areaId: number;
  name: string;
  lengthM: number; widthM: number; heightM: number;
  /** The loop's size state: "adjusted" = typed, "yes" = the typical accepted, null = not yet. */
  size: "yes" | "adjusted" | null;
  confirmed: boolean;
  /** B2: the scope page's tiles for this room, as the server sends them. */
  tiles: CustomerTile[];
  windows: RoomLoopView["windows"];
  /** B3: the cupboard rows (doors, the walls inside) the loop offers this room type — null = no row to write. */
  cupboard: { question: string; on: boolean | null } | null;
  cupboardInterior: { question: string; on: boolean | null } | null;
  /** B4: the repairs pinned to the room, and its extras row (feature wall / wallpaper / other). */
  spots: RoomSpot[];
  extras: { featureWalls: number; wallpaper: boolean; other: string };
  /** E1: a plan garage still waiting on "are we painting it?". */
  garagePending: boolean;
  /** S6 (§3 C): an outside job's line is a SIDE — `lengthM` is across, `widthM` is high, the side's own tiles ride here. */
  kind?: "room" | "side";
  sideKey?: SideKey;
  sideTiles?: SideView["tiles"];
  sideNote?: string | null;
  sideNotePhotos?: number;
};

/** §3 C — an outside job's lines are its painted sides, from the sides view the scope page's sides editor reads. */
export function quoteSidesFrom(sides: SidesView | null): QuoteRoom[] {
  if (!sides) return [];
  return sides.sides.filter((s) => s.include !== false).map((s) => ({
    areaId: s.areaId, name: s.label,
    lengthM: s.L, widthM: s.H, heightM: 0,
    size: s.size === "adjusted" ? "adjusted" : s.size === "yes" || s.size === "ns" ? "yes" : null,
    confirmed: s.confirmed,
    tiles: [], windows: [], cupboard: null, cupboardInterior: null, spots: [],
    extras: { featureWalls: 0, wallpaper: false, other: "" }, garagePending: false,
    kind: "side", sideKey: s.key, sideTiles: s.tiles, sideNote: s.note, sideNotePhotos: s.notePhotos,
  }));
}

/** One room model from the three views the server sends (`scopeRooms`, `interiorLoop.rooms`, `roomExtras`). */
export function quoteRoomsFrom(scopeRooms: CustomerScopeRoom[], loop: RoomLoopView[], roomExtras: Record<string, { featureWalls: number; wallpaper: boolean; other: string }>): QuoteRoom[] {
  return scopeRooms.map((r) => {
    const l = loop.find((x) => x.areaId === r.areaId);
    return {
      areaId: r.areaId, name: r.name,
      lengthM: l?.lengthM ?? 0, widthM: l?.widthM ?? 0, heightM: l?.heightM ?? 2.4,
      size: l?.size ?? null, confirmed: l?.confirmed ?? false,
      tiles: r.tiles, windows: l?.windows ?? [],
      cupboard: l?.cupboard ? { question: l.cupboard.question, on: l.cupboard.on } : null,
      cupboardInterior: l?.cupboardInterior ? { question: l.cupboardInterior.question, on: l.cupboardInterior.on } : null,
      spots: r.spots ?? [],
      extras: roomExtras[String(r.areaId)] ?? { featureWalls: 0, wallpaper: false, other: "" },
      garagePending: r.garagePending === true,
    };
  });
}

export type QuoteInput = {
  jobKind: JobKind;
  general: GeneralAnswers;
  /** The job still has an assumed ceiling height (the height card is asked first). */
  heightUnconfirmed: boolean;
  access: SiteAccess;
  asksLift: boolean;
  rooms: QuoteRoom[];
};

const STAGE_A = "A few things first";

const opt = (value: string, label: string, action: Record<string, unknown>, extra: Partial<CardOption> = {}): CardOption => ({ value, label, action, ...extra });

/** The whole-house cards (§3 A, plus the four the live scope page asks that §3 does not list — kept, R3). */
export function generalCards(i: QuoteInput): GeneralCard[] {
  const g = i.general;
  const a = i.access;
  const cards: GeneralCard[] = [];
  const push = (key: GeneralKey, question: string, options: CardOption[], columns: 2 | 3 | 4, value: string | null, hint?: string) =>
    cards.push({ kind: "general", id: `g:${key}`, key, stage: STAGE_A, question, hint, options, value, columns });
  if (i.jobKind === "exterior") return cards;
  if (i.jobKind === "interior") {
    push("cornices", "Do you have cornices?", [
      opt("none", "No", { action: "set_cornices", answer: "none" }),
      opt("standard", "Standard", { action: "set_cornices", answer: "standard" }, { hint: "A plain moulding" }),
      opt("decorative", "Decorative", { action: "set_cornices", answer: "decorative" }, { hint: "Patterned or ornate" }),
    ], 3, g.cornices ?? null, "The moulding where the walls meet the ceiling.");
    push("height", "How high are the ceilings?", [
      opt("2.4", "2.4 m", { action: "confirm_height", heightM: 2.4 }, { hint: "Most homes" }),
      opt("2.7", "2.7 m", { action: "confirm_height", heightM: 2.7 }),
      opt("3", "3 m or more", { action: "confirm_height", heightM: 3 }, { hint: "Older homes" }),
    ], 3, g.height ?? null, "Sets every room — you can change any room on its own card.");
  }
  push("doors", "The doors — mostly panelled, or flat?", [
    opt("panel", "Panelled", { action: "set_door_style", style: "panel" }, { drawing: "door-panel" }),
    opt("flat", "Flat", { action: "set_door_style", style: "flat" }, { drawing: "door-flat" }),
  ], 2, g.doors ?? null);
  push("windows", "The windows — which type, mostly?", [
    opt("casement", "Casement", { action: "set_window_style", style: "casement" }, { drawing: "win-casement", hint: "Hinged at the side" }),
    opt("sash", "Sash", { action: "set_window_style", style: "sash" }, { drawing: "win-sash", hint: "Slides up and down" }),
    opt("colonial", "Colonial", { action: "set_window_style", style: "colonial" }, { drawing: "win-colonial", hint: "Small panes, lots of bars" }),
    opt("winder", "Winder", { action: "set_window_style", style: "winder" }, { drawing: "win-winder", hint: "Louvres on a crank" }),
  ], 2, g.windows ?? null, "Mixed is fine — pick the most common.");
  push("paintBase", "Water-based or oil-based paint on the trims?", [
    opt("water", "Water-based", { action: "set_paint_system", field: "paintBase", value: "water" }),
    opt("oil", "Oil-based", { action: "set_paint_system", field: "paintBase", value: "oil" }),
    opt("unsure", "Not sure", { action: "set_paint_system", field: "paintBase", value: "unsure" }, { hint: "Priced as water-based" }),
  ], 3, g.paintBase ?? null, "Over oil, water-based needs an undercoat first.");
  push("glossTrims", "What was the woodwork last painted in?", [
    opt("yes", "Oil-based", { action: "set_paint_system", field: "glossTrims", value: "yes" }, { hint: "Shinier, a rubbery feel" }),
    opt("no", "Water-based", { action: "set_paint_system", field: "glossTrims", value: "no" }),
    opt("unsure", "Not sure", { action: "set_paint_system", field: "glossTrims", value: "unsure" }, { hint: "We check on the visit" }),
  ], 3, g.glossTrims ?? null);
  push("cleared", "Will the rooms be cleared before we start?", [
    opt("yes", "Yes", { action: "set_site_access", field: "cleared", value: "yes" }),
    opt("some", "Mostly", { action: "set_site_access", field: "cleared", value: "some" }),
    opt("no", "Furniture stays", { action: "set_site_access", field: "cleared", value: "no" }, { hint: "We move and cover it" }),
  ], 3, a.cleared ?? null);
  push("stairwell", "A stairwell or void with high walls?", [
    opt("no", "No", { action: "set_site_access", field: "stairwell", value: "no" }),
    opt("yes", "Yes", { action: "set_site_access", field: "stairwell", value: "yes" }, { hint: "So your painter brings the right gear" }),
  ], 2, a.stairwell ?? null);
  push("parking", "Where can we park?", [
    opt("drive", "Driveway", { action: "set_site_access", field: "parking", value: "drive" }),
    opt("street", "Street", { action: "set_site_access", field: "parking", value: "street" }),
    opt("hard", "Tricky", { action: "set_site_access", field: "parking", value: "hard" }),
  ], 3, a.parking ?? null);
  if (i.asksLift) push("lift", "Does the building need a lift booking?", [
    opt("no", "No", { action: "set_site_access", field: "lift", value: "no" }),
    opt("yes", "Yes", { action: "set_site_access", field: "lift", value: "yes" }, { hint: "We book it and work to the building's hours" }),
  ], 2, a.lift ?? null);
  return cards;
}

/** The measure card for each room (§3 B1). */
export function measureCards(i: QuoteInput): MeasureCard[] {
  return i.rooms.map((r, k) => ({
    kind: "measure", id: `measure:${r.areaId}`, areaId: r.areaId, name: r.name, stage: `${r.name} · ${k + 1} of ${i.rooms.length}`,
    lengthM: r.lengthM, widthM: r.widthM, heightM: r.heightM,
    measured: r.size === "adjusted", typical: r.size !== "adjusted",
    position: { n: k + 1, of: i.rooms.length },
  }));
}

/**
 * §3 B2–B4 — the three cards after the size, per room; the robe card only where the loop offers a cupboard row.
 * §3 D — a doors-and-trims job: one card per room, the lines with their counters (the surfaces card), nothing else.
 */
export function roomCards(i: QuoteInput): QuoteCard[] {
  const out: QuoteCard[] = [];
  const measure = measureCards(i);
  i.rooms.forEach((r, k) => {
    const stage = `${r.name} · ${k + 1} of ${i.rooms.length}`;
    if (i.jobKind === "trims") { out.push({ kind: "surfaces", id: `surfaces:${r.areaId}`, areaId: r.areaId, name: r.name, stage, room: r }); return; }
    out.push(measure[k]);
    out.push({ kind: "surfaces", id: `surfaces:${r.areaId}`, areaId: r.areaId, name: r.name, stage, room: r });
    if (r.cupboard) out.push({ kind: "robe", id: `robe:${r.areaId}`, areaId: r.areaId, name: r.name, stage, room: r });
    out.push({ kind: "attention", id: `attention:${r.areaId}`, areaId: r.areaId, name: r.name, stage, room: r });
  });
  return out;
}

/** §3 C — three cards per painted side (an outside job's whole stage: no whole-house cards, no last checks). */
export function sideCards(i: QuoteInput): QuoteCard[] {
  const out: QuoteCard[] = [];
  i.rooms.forEach((s, k) => {
    if (s.kind !== "side" || !s.sideKey) return;
    const stage = `${s.name} · ${k + 1} of ${i.rooms.length}`;
    const base = { areaId: s.areaId, sideKey: s.sideKey, name: s.name, stage, side: s };
    out.push({ kind: "side-size", id: `side-size:${s.sideKey}`, ...base, position: { n: k + 1, of: i.rooms.length } });
    out.push({ kind: "side-on", id: `side-on:${s.sideKey}`, ...base });
    out.push({ kind: "side-attn", id: `side-attn:${s.sideKey}`, ...base });
  });
  return out;
}

/** The house-wide door and window counts, from the rooms' tiles — for E1's "N doors and M windows — right?". */
export function houseCounts(rooms: QuoteRoom[]): { doors: number; windows: number } {
  const sum = (key: string) => rooms.reduce((n, r) => n + r.tiles.filter((t) => t.key === key && t.on).reduce((m, t) => m + (t.count ?? 1), 0), 0);
  return { doors: sum("doors"), windows: sum("windows") };
}

/** Every card in the brief's order: A, then B ×4 per room, then E, then F — or, outside, C ×3 per side, then F. */
export function quoteCards(i: QuoteInput): QuoteCard[] {
  if (i.jobKind === "exterior") return [...sideCards(i), { kind: "done", id: "done", stage: "Your detailed price" }];
  const { doors, windows } = houseCounts(i.rooms);
  return [
    ...generalCards(i),
    ...roomCards(i),
    { kind: "rooms", id: "rooms", stage: "Last checks", rooms: i.rooms, doors, windows },
    { kind: "extras", id: "extras", stage: "Last checks" },
    { kind: "done", id: "done", stage: "Your detailed price" },
  ];
}

/** §2 — the bar carries on from the gate's 55% to 100%. */
export function quoteProgress(index: number, total: number): number {
  if (total <= 1) return 100;
  return 55 + Math.round((Math.max(0, Math.min(index, total - 1)) / (total - 1)) * 45);
}

/** The words of the done screen's small print: which rooms stayed typical. */
export function typicalRoomNames(rooms: QuoteRoom[]): string[] {
  return rooms.filter((r) => r.size !== "adjusted").map((r) => r.name);
}

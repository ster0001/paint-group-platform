import type { SiteAccess } from "@/lib/wizard/site-access";

/**
 * QUOTE STAGE v10 — the cards, as data (brief §3; prototype
 * `design/reference/wizard-quote-stage-v10-prototype.html`).
 *
 * "Get my detailed price" is one question per card: the whole-house
 * questions first (A), then the rooms one at a time (B, four cards each —
 * session 1 builds the measure card; sessions 3 adds the other three),
 * then the last checks (E) and the done screen (F). Every card writes an
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
export type DoneCard = { kind: "done"; id: "done"; stage: string };
export type QuoteCard = GeneralCard | MeasureCard | DoneCard;

export type GeneralKey = "cornices" | "height" | "doors" | "windows" | "paintBase" | "glossTrims" | "cleared" | "stairwell" | "parking" | "lift";
export type GeneralAnswers = Partial<Record<GeneralKey, string | null>>;

export type QuoteRoom = {
  areaId: number;
  name: string;
  lengthM: number; widthM: number; heightM: number;
  /** The loop's size state: "adjusted" = typed, "yes" = the typical accepted, null = not yet. */
  size: "yes" | "adjusted" | null;
  confirmed: boolean;
};

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

/** Every card in the brief's order: A, then B per room, then F. (E's last checks and B2–B4 arrive in session 3.) */
export function quoteCards(i: QuoteInput): QuoteCard[] {
  return [...generalCards(i), ...measureCards(i), { kind: "done", id: "done", stage: "Your detailed price" }];
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

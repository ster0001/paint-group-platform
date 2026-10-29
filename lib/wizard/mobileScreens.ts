import {
  changingForScope, exclusionOptions, visibleChanging,
  type InteriorExcludable, type QuickLook, type QuickLookStep, type ScopePreset,
} from "./quick-look";
import { typicalFor, type ExteriorTypicalRow } from "./exterior-typicals";
import { EXTERIOR_EXTRAS, type ExteriorExtra, type ExteriorPart, type ExteriorV2 } from "./state";
import { VERANDAH_PARTS, anyBrick, anyVerticalTimber } from "./exterior-model";

/**
 * Wizard mobile v5, session 2 (brief §2) — the phone's screens, as data.
 *
 * On a phone (`< 768px`) the customer answers ONE question per screen (R7).
 * The quick look's steps (`stepsFor`, lib/wizard/quick-look.ts) stay the
 * one order of record — autosave, resume, the server's gate and every
 * validation run on them — and this module only says how each step is
 * SPLIT on a phone: the place step becomes "What kind of place is it?",
 * "How many bedrooms?" and "One storey or two?"; the job step becomes
 * "What's the job?" and "What's being painted?"; the condition step
 * carries "Colours?", "How are the walls looking?" and "Anyone living
 * there?". A step this module does not split (the "both" doors, the
 * commercial screens, the exterior v2 steps — their order is the exterior
 * brief's, §2.4) is one screen with a Continue bar, rendered as it is.
 *
 * The answers themselves are the quick look's (`QuickLook`), untouched:
 * the data model is unchanged (§2.6). Nothing here renders or prices.
 */
export const MOBILE_SCREEN_IDS = ["what", "property", "beds", "storeys", "job", "surfaces", "rooms", "colours", "condition", "living", "shape", "size", "row", "p-house", "p-win", "p-ver", "p-around",
  "a-walls", "a-wallsUp", "a-brick", "a-timber", "a-gable", "a-win", "a-garage", "a-posts", "a-extras", "a-colours", "a-access", "details"] as const;
export type MobileScreenId = (typeof MOBILE_SCREEN_IDS)[number];

export type MobileScreen = {
  /** One of the eleven, or the quick-look step's own name for a screen rendered as it is. */
  id: MobileScreenId | QuickLookStep;
  /** The quick-look step this screen belongs to (its validation and its autosave tag). */
  step: QuickLookStep;
  /** `auto`: a single choice that advances itself ~250ms after the tap; `bar`: a Continue (or Show my range) bar. */
  advance: "auto" | "bar";
  heading: string | null;
  sub: string | null;
  /** Exterior on mobile v5: the stage kicker over the heading ("Your home"), the exterior brief's rail name. */
  stage?: string;
};

/** Brief §2 — the words, one heading and at most one grey line (R8). */
/** The Painting screens' words live with their step (they depend on the shape); every other screen's are here. */
type WordedScreenId = Exclude<MobileScreenId, PaintScreenId | "p-around" | AboutScreenId>;
const WORDS: Record<WordedScreenId, { heading: string; sub: string }> = {
  what: { heading: "What are we painting?", sub: "Your range in under a minute." },
  property: { heading: "What kind of place is it?", sub: "Near enough is fine." },
  beds: { heading: "How many bedrooms?", sub: "This builds your room list for you." },
  storeys: { heading: "One storey or two?", sub: "Two adds the stairwell and upper hall." },
  job: { heading: "What's the job?", sub: "Coats and preparation come from this." },
  surfaces: { heading: "What's being painted?", sub: "Tap a surface and watch it paint in." },
  rooms: { heading: "We're painting these rooms", sub: "We've guessed from the bedrooms. Untick any, add any." },
  colours: { heading: "Colours?", sub: "Still deciding is fine." },
  condition: { heading: "How are the walls looking?", sub: "Honest is best — it sets the prep." },
  living: { heading: "Anyone living there while we paint?", sub: "We work room by room and pack down each day." },
  // Exterior on mobile v5, session 1 (plan §2 screens 2–4; the prototype's words): the Your home step, one question a screen.
  shape: { heading: "What kind of home is it?", sub: "Near enough is fine." },
  size: { heading: "About how big is it?", sub: "Roughly — the house size, not the block." },
  row: { heading: "Where is it in the row?", sub: "Shared walls aren't painted." },
  details: { heading: "Where shall we send your range?", sub: "It shows on the next screen. We text you the link so you can come back to it." },
};

const screen = (id: WordedScreenId, step: QuickLookStep, advance: MobileScreen["advance"], heading = WORDS[id].heading): MobileScreen =>
  ({ id, step, advance, heading, sub: WORDS[id].sub });

/**
 * The phone's screens for these answers, in order — one list, derived from
 * the step list it splits, so the two can never disagree on what comes next.
 *
 * Skip rules (§2): storeys is skipped for a unit or apartment; an outside
 * job has no bedrooms or storeys here (the exterior brief asks them its own
 * way) and no job or rooms screens — its steps follow the place screen as
 * they are. A commercial place keeps its own screens.
 */
export function mobileScreensFor(
  steps: readonly QuickLookStep[], quick: QuickLook,
  /** Exterior on mobile v5: the outside answers — the shape decides whether "Where is it in the row?" is asked. */
  outside: { v2?: ExteriorV2 | null } | null = null, rows: ReadonlyArray<ExteriorTypicalRow> = [],
): MobileScreen[] {
  const out: MobileScreen[] = [];
  const interior = quick.jobType !== "exterior";
  for (const step of steps) {
    switch (step) {
      case "start":
        out.push(screen("what", step, "auto"));
        break;
      case "place":
        out.push(screen("property", step, "auto"));
        if (interior && quick.propertyKind !== "commercial") {
          out.push(screen("beds", step, "auto"));
          if (quick.propertyKind !== "unit_apartment") out.push(screen("storeys", step, "auto"));
        }
        break;
      case "job":
        out.push(screen("job", step, "auto"));
        // "Walls and ceilings only" (a desktop preset) offers nothing to untick — no screen for it.
        if (exclusionOptions(quick.scope).length > 0) out.push(screen("surfaces", step, "bar"));
        break;
      case "rooms":
        out.push(screen("rooms", step, "bar", quick.scope === "some_rooms" ? "Which rooms?" : WORDS.rooms.heading));
        break;
      case "condition":
        out.push(screen("colours", step, "auto"));
        out.push(screen("condition", step, "auto"));
        out.push(screen("living", step, "auto"));
        break;
      case "home": {
        // Exterior on mobile v5, session 1 (plan §2 screens 2–4): the shape, the size, and — for a shape that
        // usually shares a wall (townhouse, unit, terrace) — where it is in the row. Each advances itself.
        const v2 = outside?.v2 ?? null;
        out.push({ ...screen("shape", step, "auto"), stage: "Your home" });
        out.push({ ...screen("size", step, "auto"), stage: "Your home" });
        if (v2 && typicalFor(v2.propertyType, rows).sharedSides.length > 0) out.push({ ...screen("row", step, "auto"), stage: "Your home" });
        break;
      }
      case "paint": {
        // Exterior on mobile v5, session 2 (plan §2 screens 5a–5d; D-E5): one group a screen, Continue on each; nothing pre-ticked (C8b).
        const v2 = outside?.v2 ?? null;
        const t = v2 ? typicalFor(v2.propertyType, rows) : null;
        out.push({ id: "p-house", step, advance: "bar", heading: "Tap everything we're painting", sub: "Walls and roofline. Tap each part and watch it paint in.", stage: "Painting" });
        out.push({ id: "p-win", step, advance: "bar", heading: "Windows and doors", sub: null, stage: "Painting" });
        out.push({ id: "p-ver", step, advance: "bar", heading: "The verandah", sub: t && t.verandah !== "none" ? null : "Tick it if there is one.", stage: "Painting" });
        out.push({ id: "p-around", step, advance: "bar", heading: "Around the house", sub: "Anything else outside we're painting?", stage: "Painting" });
        break;
      }
      case "about": {
        // Exterior on mobile v5, session 3 (plan §2 screens 6a–6n, 7, 8): one card a screen, only for the ticked parts.
        const v2 = outside?.v2 ?? null;
        const t = v2 ? typicalFor(v2.propertyType, rows) : null;
        const has = (p: ExteriorPart) => Boolean(v2?.parts.includes(p));
        const two = t?.storeys === 2;
        const A = (id: AboutScreenId, heading: string, sub: string | null, advance: MobileScreen["advance"] = "auto") => out.push({ id, step, advance, heading, sub, stage: "About it" });
        if (has("walls")) {
          A("a-walls", two ? "Downstairs walls — what are they made of?" : "What are the walls made of?", t && !t.wallsPainted ? "Brick veneer is usually left bare — tick only if the brick is being painted." : null);
          if (two) A("a-wallsUp", "And upstairs?", "Two storeys are often two materials.");
          if (v2 && anyBrick(v2)) A("a-brick", "Has the brick been painted before?", "Bare brick needs a sealer and three coats.");
          if (v2 && anyVerticalTimber(v2)) A("a-timber", "Is the vertical timber painted?", "Usually stained, not painted — we price the stain.");
        }
        if (has("gable")) A("a-gable", "What's in the gable?", "The triangle under the roof.");
        if (has("windows")) A("a-win", "What kind of windows?", "Mostly — mixed is fine.");
        if (has("garage")) A("a-garage", "Garage door", null);
        if (has("posts")) A("a-posts", "The verandah posts", null);
        if (v2 && extraSizeRows(v2).length > 0) A("a-extras", "Roughly how big?", "Pace it out — near enough is fine.", "bar");
        A("a-colours", "Colours?", "Same again, new, or going much lighter.");
        A("a-access", "Getting around the house", "Tick anything that applies.", "bar");
        break;
      }
      case "gate":
        out.push(screen("details", step, "bar"));
        break;
      default:
        out.push({ id: step, step, advance: step === "both" ? "auto" : "bar", heading: null, sub: null });
    }
  }
  return out;
}

/**
 * §2.1 — the 3px bar: `index / (screens − 1) × 55%`, where the screens
 * include the gate, so the gate itself sits at 55% and the quote stage
 * continues to 100%. `total` is the number of QUESTION screens.
 */
export function mobileProgress(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, Math.min(index, total)) / total) * 55);
}

/** §2 — the three colour answers, derived from (and written back to) the quick look's colour tiles. */
export type ColourChoice = "new" | "same" | "deciding";
export const COLOUR_CHOICES: Array<{ value: ColourChoice; label: string; hint: string }> = [
  { value: "new", label: "New colours", hint: "A change — we allow for an undercoat" },
  { value: "same", label: "Same colours", hint: "A fresh coat of what's there" },
  { value: "deciding", label: "Still deciding", hint: "We'll allow for new colours" },
];
export function colourChoiceOf(q: Pick<QuickLook, "changing" | "undecided" | "scope" | "excluded">): ColourChoice {
  if (q.undecided) return "deciding";
  return visibleChanging(q.scope, q.excluded ?? []).some((k) => q.changing[k]) ? "new" : "same";
}
export function applyColourChoice(q: Pick<QuickLook, "scope" | "excluded">, choice: ColourChoice): Partial<QuickLook> {
  const all = changingForScope(q.scope, q.excluded ?? []);
  if (choice === "same") return { changing: { walls: false, ceilings: false, trims: false, windows: false }, undecided: false, bold: false, boldGroups: [] };
  return { changing: all, undecided: choice === "deciding", bold: false, boldGroups: [] };
}

/** §2 — the three job answers a phone offers (the desktop's "Walls and ceilings only" is not one of them). */
export const JOB_CHOICES: Array<{ value: ScopePreset; label: string; hint: string }> = [
  { value: "whole", label: "The whole interior", hint: "Walls, ceilings, skirtings, doors, frames" },
  { value: "some_rooms", label: "Some rooms", hint: "You pick which, next" },
  { value: "trims_doors", label: "Doors, windows and trims", hint: "No walls or ceilings" },
];
/**
 * §2.6 — picking a job pre-ticks its surfaces: "Doors, windows and trims"
 * pre-ticks skirtings, doors and windows (the architraves ride with the
 * doors on a phone — §3.2 names five surfaces, and a door's frame is part
 * of the door to a customer); "Some rooms" pre-ticks the first two rooms (§2.3).
 */
export function applyJobChoice(scope: ScopePreset, roomNames: readonly string[]): Partial<QuickLook> {
  const excluded: InteriorExcludable[] = [];
  return { scope, excluded, changing: changingForScope(scope, excluded), rooms: scope === "some_rooms" ? roomNames.slice(0, 2) : null };
}

/** §3.2 / §2.6 — the five surface chips, in the order a person thinks about a room; ticked = painted (the state is still `excluded`). The architraves ride with the doors. */
const SURFACE_ORDER: InteriorExcludable[] = ["walls", "ceilings", "skirting", "doors", "windows"];
const RIDES_WITH: Partial<Record<InteriorExcludable, InteriorExcludable[]>> = { doors: ["architraves"] };
const SURFACE_LABEL: Record<InteriorExcludable, string> = {
  walls: "Walls", ceilings: "Ceilings", skirting: "Skirtings", doors: "Doors", windows: "Window frames", architraves: "Architraves", cornices: "Cornices",
};
export function surfaceChips(q: Pick<QuickLook, "scope" | "excluded">): Array<{ key: InteriorExcludable; label: string; on: boolean }> {
  const offered = exclusionOptions(q.scope).map((o) => o.value);
  return SURFACE_ORDER.filter((k) => offered.includes(k)).map((key) => ({ key, label: SURFACE_LABEL[key], on: !(q.excluded ?? []).includes(key) }));
}
export function toggleSurface(q: Pick<QuickLook, "scope" | "excluded">, key: InteriorExcludable): Partial<QuickLook> {
  const cur = q.excluded ?? [];
  const group = [key, ...(RIDES_WITH[key] ?? [])].filter((k) => exclusionOptions(q.scope).some((o) => o.value === k));
  const excluded = cur.includes(key) ? cur.filter((k) => !group.includes(k)) : [...cur.filter((k) => !group.includes(k)), ...group];
  return { excluded, changing: changingForScope(q.scope, excluded) };
}
/** "N surfaces ticked" — what the strip will say (S3); here for the ribbon's count and the tests. */
export function surfacesTicked(q: Pick<QuickLook, "scope" | "excluded">): number {
  return surfaceChips(q).filter((c) => c.on).length;
}

/**
 * §2.3 — the rooms screen: the generated list (Bed 1…N, Living room,
 * Kitchen / Meals, Bathroom, Laundry, Hall & Entry; two storeys adds the
 * landing and stairs — the starter list's own names, so the submit finds
 * them), ticked unless unticked; then the extra chips offered unticked
 * (Study, Ensuite, Garage), which become rooms added by hand.
 */
export const EXTRA_ROOMS: Array<{ name: string; roomType: string }> = [
  { name: "Study", roomType: "study" }, { name: "Ensuite", roomType: "bathroom" }, { name: "Garage", roomType: "garage" },
];
export type RoomChip = { name: string; on: boolean; kind: "listed" | "extra" | "added"; index: number };
export function roomChips(q: Pick<QuickLook, "rooms">, names: readonly string[], added: ReadonlyArray<{ name: string }>): RoomChip[] {
  const out: RoomChip[] = names.map((name, index) => ({ name, on: !q.rooms || q.rooms.includes(name), kind: "listed", index }));
  const addedNames = added.map((r) => r.name);
  for (const extra of EXTRA_ROOMS) {
    if (names.includes(extra.name)) continue;
    const at = addedNames.indexOf(extra.name);
    out.push({ name: extra.name, on: at >= 0, kind: "extra", index: at });
  }
  added.forEach((r, index) => { if (!EXTRA_ROOMS.some((e) => e.name === r.name)) out.push({ name: r.name, on: true, kind: "added", index }); });
  return out;
}
/** Tick or untick a listed room — `null` once every listed room is on again (the quick look's "all of them"). */
export function toggleListedRoom(q: Pick<QuickLook, "rooms">, names: readonly string[], name: string): Partial<QuickLook> {
  const cur = q.rooms ?? [...names];
  const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
  return { rooms: next.length === names.length && names.every((n) => next.includes(n)) ? null : next };
}
export function roomsTicked(q: Pick<QuickLook, "rooms">, names: readonly string[], added: ReadonlyArray<{ name: string }>): number {
  return roomChips(q, names, added).filter((c) => c.on).length;
}

/**
 * §2 — the details screen's button. Tom, 28 Oct 2026 (D17): a FULL name
 * (two words at least), a 10-digit mobile and an email — the lead is keyed
 * on the email, and a first name alone is not a customer the office can
 * find. The server's gate (`/api/wizard/submit`, `gate_required`) asks for
 * the same three.
 */
export function fullNameGiven(name: string): boolean {
  return name.trim().split(/\s+/).filter((w) => w.length > 0).length >= 2;
}
export function detailsReady(c: { name: string; email: string; phone: string }): boolean {
  return fullNameGiven(c.name) && c.phone.replace(/\D/g, "").length >= 10 && /.+@.+\..+/.test(c.email.trim());
}

/** Where the phone's screen id is kept between reloads, beside the resume record. */
export const MOBILE_SCREEN_KEY = "pg-wizard-mobile-screen-v1";

/**
 * Exterior on mobile v5, session 2 (plan §2 screens 5a–5c): the parts each
 * Painting screen offers — the house and its roofline on one screen (Tom,
 * 29 Oct), windows and doors, the verandah (its posts, ceiling and handrail
 * once the verandah is ticked — D-E5). The around-the-house screen offers
 * the brief's extras. The order is the exterior brief's.
 */
export type PaintScreenId = "p-house" | "p-win" | "p-ver";
export const PAINT_SCREEN_PARTS: Record<PaintScreenId, ExteriorPart[]> = {
  "p-house": ["walls", "gable", "fascias", "gutters", "downpipes", "eaves"],
  "p-win": ["windows", "doors", "garage", "shutters"],
  "p-ver": ["verandah", "posts", "ceiling", "handrail"],
};
export function paintScreenParts(id: PaintScreenId, v2: Pick<ExteriorV2, "parts">): ExteriorPart[] {
  const verandahOn = v2.parts.includes("verandah");
  return PAINT_SCREEN_PARTS[id].filter((p) => !VERANDAH_PARTS.includes(p) || verandahOn);
}
/** Every part the three screens offer, in order — the sheet's chips (one control, two places). */
export function paintParts(v2: Pick<ExteriorV2, "parts">): ExteriorPart[] {
  return (["p-house", "p-win", "p-ver"] as const).flatMap((id) => paintScreenParts(id, v2));
}
export const AROUND_EXTRAS: readonly ExteriorExtra[] = EXTERIOR_EXTRAS;

/**
 * Exterior on mobile v5, session 3 (plan §2 screen 6 "extras' rough sizes
 * (steppers)"): the extras that take a size, one stepper row each — the
 * desktop card's keys (`extraSizes.fence / deck / wall / pergola_l / pergola_w`)
 * with the prototype's defaults, written when the screen is entered so the
 * step's gate (`aboutMissing`: a pergola needs its top) is met.
 */
export type AboutScreenId = "a-walls" | "a-wallsUp" | "a-brick" | "a-timber" | "a-gable" | "a-win" | "a-garage" | "a-posts" | "a-extras" | "a-colours" | "a-access";
export type ExtraSizeRow = { key: string; label: string; unit: string; initial: number; step: number; min: number };
export function extraSizeRows(v2: Pick<ExteriorV2, "extras">): ExtraSizeRow[] {
  const rows: ExtraSizeRow[] = [];
  if (v2.extras.includes("paling_fence") || v2.extras.includes("picket_fence")) rows.push({ key: "fence", label: "Fence", unit: "m", initial: 20, step: 1, min: 1 });
  if (v2.extras.includes("deck")) rows.push({ key: "deck", label: "Deck", unit: "m²", initial: 20, step: 1, min: 1 });
  if (v2.extras.includes("wall")) rows.push({ key: "wall", label: "Boundary wall", unit: "m", initial: 10, step: 1, min: 1 });
  if (v2.extras.includes("pergola")) {
    rows.push({ key: "pergola_l", label: "Pergola length", unit: "m", initial: 4, step: 0.5, min: 0.5 });
    rows.push({ key: "pergola_w", label: "Pergola width", unit: "m", initial: 3, step: 0.5, min: 0.5 });
  }
  return rows;
}
/** The sizes with every missing one at its default — written on entering the screen. */
export function extraSizesWithDefaults(v2: Pick<ExteriorV2, "extras" | "extraSizes">): Record<string, number> | null {
  const next = { ...v2.extraSizes };
  let changed = false;
  for (const r of extraSizeRows(v2)) if (!(next[r.key] > 0)) { next[r.key] = r.initial; changed = true; }
  return changed ? next : null;
}

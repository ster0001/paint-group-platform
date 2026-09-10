/**
 * The paint-systems SCREEN — phase 4 of the estimator journey v2 plan (§3,
 * §4.2; prototype screen 8, "How we'll paint each surface").
 *
 * Phase 3 made the engine derive coats and preparation per surface group
 * instead of asking the customer to pick one number for the house
 * (lib/pricing/systems.ts). This module is the other half of that bargain,
 * and the reason the derivation is honest rather than merely hidden: it shows
 * the customer what we worked out, in the painter's own words, and gives them
 * one tap per line to correct it.
 *
 * Plan §2.2 is explicit that this is the bit most quotes hide. Deriving
 * silently would replace a question the customer could not answer with an
 * assumption they could not see — worse, not better. So:
 *
 *   - Every line says what the painter will actually DO, not a coat count.
 *   - Every line the customer can move carries its correction as a chip.
 *   - A line we are not sure about says so (`review`) rather than looking
 *     settled — ⚑5's "not sure" gloss answer is the common case.
 *
 * Three rules this module keeps:
 *
 *  1. The groups shown are read from the TREE, not from the wizard's tick
 *     list. By the time the customer reaches the editor they have already
 *     added and removed surfaces; a line about ceilings on a job whose
 *     ceilings were removed is a lie, and the tick list would still say yes.
 *  2. Interior only. `groupForSubstrate` has no opinion on exterior
 *     substrates (plan §4.4 — the per-elevation allowances spec does not
 *     exist), so an exterior-only job gets no systems card at all rather
 *     than a card full of numbers nobody has validated.
 *  3. Applying a correction re-derives the WHOLE tree, never one line.
 *     Colour intent is a job-wide answer: "same colour actually" on the
 *     walls card has to move the trims too, or the estimate quietly holds
 *     two different answers to the same question.
 */

import {
  DEFAULT_PAINT_SYSTEMS, SYSTEM_GROUPS, colourIntentFromTier,
  conditionBandFromDamageTier, deriveSystem, groupForSubstrate,
  type ColourIntent, type PaintSystems, type SystemAnswers, type SystemGroup,
} from "@/lib/pricing/systems";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import type { WizardState, WizardSurfaceKey } from "./state";

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; type?: string;
  surfaces?: Array<Record<string, unknown>>;
};

/**
 * The customer's answers, read off a wizard state.
 *
 * ONE reader, used by the merge (which stamps the coats), by this view
 * (which explains them) and by the editor's apply (which re-stamps them
 * after a correction). Three copies of this mapping would be three chances
 * for the screen to describe a system the tree does not actually carry.
 *
 * A partial state — the assistant's draft, an old snapshot — reads as the
 * defaults the wizard itself would have used, never as a throw.
 */
export function systemAnswersFromState(
  state: Pick<WizardState, "condition" | "details" | "paint">,
  darkToLight = false,
): SystemAnswers {
  return {
    colourIntent: colourIntentFromTier(state.condition?.tier ?? "change"),
    condition: conditionBandFromDamageTier(state.details?.damageTier ?? 1),
    // ⚑5: null (never asked) is "not sure", which prices as no and asks a
    // person to check — never a confident "no".
    glossTrims: state.paint?.trimsOilBased ?? "unsure",
    ceilingsMarked: state.condition?.ceilingsMarked ?? false,
    ceilingsChangingColour: state.condition?.ceilingsChangingColour ?? false,
    // Tom, 9 Sep: "the doors need 3 coats because they're stained, the rest 2".
    flags: (state.condition?.surfaceFlags ?? {}) as SystemAnswers["flags"],
    darkToLight,
  };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** One tap the customer can take on a line. `patch` is the route action's body. */
export type SystemChip = {
  label: string;
  /** True when this chip describes what we have already assumed. */
  on: boolean;
  /** What the customer is told after the tap — the editor's delta line. */
  said: string;
  patch:
    | { field: "colourIntent"; value: ColourIntent }
    | { field: "ceilingsMarked"; value: boolean }
    | { field: "ceilingsChangingColour"; value: boolean }
    | { field: "glossTrims"; value: "yes" | "no" | "unsure" }
    /** A per-group condition flag, on or off. `group` is which line it sits on. */
    | { field: "surfaceFlag"; group: SystemGroup; flag: string; value: boolean }
    /**
     * Which surfaces are going from a dark colour to a light one — job-wide,
     * and three coats each (Tom, 10 Sep: "immediately pick the areas which are
     * going dark to light… then assume that everything else is 2 coats").
     *
     * Job-wide and not per room ON PURPOSE, and that is Tom's ruling: prep
     * genuinely varies room to room, a colour change does not. If the doors are
     * going dark to light, it is all the doors.
     */
    | { field: "darkToLight"; key: WizardSurfaceKey; value: boolean }
    /**
     * CEILINGS, the one surface where "some" can be a real list.
     *
     * ⚑ Tom, 11 Sep: *"it isn't typical for a ceiling to go from dark to light —
     * so maybe it could be added to the dark to light as ceilings some rooms, or
     * all ceilings; if it's some rooms, then it adds an option to choose the
     * rooms in the room builder."* The rooms are already on the screen, so
     * unlike "some walls" this does not need an estimator to resolve it.
     */
    | { field: "darkToLightCeilings"; value: "all" | "some" | null }
    | { field: "darkToLightCeilingRoom"; areaId: number; value: boolean };
};

export type PaintSystemLine = {
  group: SystemGroup;
  /** The heading a customer reads — "Skirtings, architraves and door frames". */
  title: string;
  /** The painter's sentence: what we will actually do. */
  sentence: string;
  coats: number;
  undercoat: boolean;
  /** Set when a person has to settle something before this price is sent. */
  review: boolean;
  /** Why the coats differ from the plain table cell, when they do. */
  reason: string;
  /** The note that rides to the work order, when there is one. */
  crewNote: string;
  chips: SystemChip[];
  /**
   * The condition flags this line offers, each already knowing whether it is
   * on. Kept apart from `chips` because they are a different kind of answer:
   * `chips` are one-of (the colour intent, the gloss answer), flags are
   * many-of and each toggles.
   */
  flagChips: SystemChip[];
  /** How many surfaces in the tree this line governs — "6 doors so far". */
  surfaceCount: number;
};

const TITLE: Record<SystemGroup, string> = {
  walls: "Walls",
  ceilings: "Ceilings and cornices",
  trims: "Skirtings, architraves and door frames",
  doors: "Doors",
  windows: "Windows",
  exterior: "Outside",
};

/** Interior surface rows only — an exterior block never reaches the table. */
function isInteriorArea(b: LooseBlock): boolean {
  return b.kind === "area" && b.type !== "Exterior";
}

/**
 * The card stays INTERIOR-ONLY even now that exterior systems are derived.
 *
 * The exterior editor is the sides builder, not this card, and a customer
 * shaping a house's outside has never seen this screen. Deriving exterior
 * coats (which now happens) and showing them here are separate decisions —
 * the second one belongs with the exterior quick look, not smuggled in.
 */
const CARD_GROUPS: ReadonlySet<SystemGroup> = new Set(["walls", "ceilings", "trims", "doors", "windows"]);

/**
 * Which groups this estimate actually contains, and how many rows each holds.
 * Read from the tree (rule 1 above), so removing every ceiling removes the
 * ceilings line.
 */
export function groupsInTree(blocks: readonly LooseBlock[]): Map<SystemGroup, number> {
  const counts = new Map<SystemGroup, number>();
  for (const b of blocks) {
    if (!isInteriorArea(b)) continue;
    for (const s of b.surfaces ?? []) {
      const group = groupForSubstrate(substrateKeyForRateCode(String(s.code ?? "")));
      if (group == null) continue;
      counts.set(group, (counts.get(group) ?? 0) + Number(s.count ?? 1));
    }
  }
  return counts;
}

const wallsChips = (intent: ColourIntent): SystemChip[] => [
  { label: "That's right", on: intent === "new", said: "Walls stay at new colours", patch: { field: "colourIntent", value: "new" } },
  { label: "Going much lighter", on: intent === "bold", said: "Walls now take an undercoat and two coats", patch: { field: "colourIntent", value: "bold" } },
  { label: "Same colour actually", on: intent === "same", said: "Walls now one coat, same colour", patch: { field: "colourIntent", value: "same" } },
];

const ceilingChips = (a: SystemAnswers): SystemChip[] => [
  {
    label: "That's right", on: !a.ceilingsMarked && !a.ceilingsChangingColour,
    said: "Ceilings stay at one coat of white",
    patch: { field: "ceilingsMarked", value: false },
  },
  {
    label: "They're marked — two coats", on: a.ceilingsMarked === true,
    said: "Ceilings now two coats, with the marks blocked first",
    patch: { field: "ceilingsMarked", value: true },
  },
  {
    label: "They're getting a colour", on: a.ceilingsChangingColour === true,
    said: "Ceilings now a colour, two coats",
    patch: { field: "ceilingsChangingColour", value: true },
  },
];

/** ⚑5 — the one preparation question worth asking a homeowner (plan §4.2). */
const glossChips = (a: SystemAnswers): SystemChip[] => [
  { label: "Yes, shiny", on: a.glossTrims === "yes", said: "A bonding primer added to the trims", patch: { field: "glossTrims", value: "yes" } },
  { label: "No", on: a.glossTrims === "no", said: "No bonding primer needed", patch: { field: "glossTrims", value: "no" } },
  { label: "Not sure", on: a.glossTrims === "unsure" || a.glossTrims == null, said: "We'll check the trims ourselves", patch: { field: "glossTrims", value: "unsure" } },
];

/**
 * The card body: one line per group the estimate actually has, in the order
 * a painter works — broad surfaces before joinery.
 */
export function paintSystemsView(
  state: Pick<WizardState, "condition" | "details" | "paint">,
  blocks: readonly LooseBlock[],
  systems: PaintSystems = DEFAULT_PAINT_SYSTEMS,
): PaintSystemLine[] {
  const answers = systemAnswersFromState(state);
  const counts = groupsInTree(blocks);
  const lines: PaintSystemLine[] = [];

  for (const group of SYSTEM_GROUPS) {
    if (!CARD_GROUPS.has(group)) continue;
    const surfaceCount = counts.get(group);
    if (surfaceCount == null) continue;
    const s = deriveSystem(group, answers, systems);
    const on = new Set(answers.flags?.[group] ?? []);
    const flagChips: SystemChip[] = systems.surfaceFlags
      // ⚑3's marked ceiling has its own dedicated chip in `chips` above — it
      // is the one flag with a stored field of its own, and offering it twice
      // would let the two disagree.
      .filter((f) => f.groups.includes(group) && f.key !== "marked")
      .map((f) => ({
        label: f.label,
        on: on.has(f.key),
        said: on.has(f.key) ? `${f.label} — removed` : f.reason !== "" ? `Noted: ${f.reason}` : f.label,
        patch: { field: "surfaceFlag", group, flag: f.key, value: !on.has(f.key) },
      }));
    lines.push({
      flagChips,
      group,
      title: TITLE[group],
      sentence: s.sentence,
      coats: s.coats,
      undercoat: s.undercoat,
      review: s.review,
      reason: s.reason,
      crewNote: s.crewNote,
      surfaceCount,
      chips:
        group === "walls" ? wallsChips(answers.colourIntent)
        : group === "ceilings" ? ceilingChips(answers)
        // ⚑5 belongs to the trims and the doors that follow them. Windows
        // carry no correction here — their STYLE is the details card's
        // question, and asking it twice invites two answers.
        : group === "trims" || group === "doors" ? glossChips(answers)
        : [],
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Applying a correction
// ---------------------------------------------------------------------------

export type SystemPatch = SystemChip["patch"];

/**
 * The wizard snapshot after a chip is tapped. Returns a NEW condition/paint
 * pair rather than mutating, so the caller decides what to persist.
 *
 * "That's right" on the ceilings clears BOTH ceiling flags: the chip means
 * "white again, one coat", and leaving `ceilingsChangingColour` set while
 * clearing `ceilingsMarked` would keep the line at two coats and make the
 * screen argue with itself.
 */
export function applySystemPatch(
  state: Pick<WizardState, "condition" | "details" | "paint">,
  patch: SystemPatch,
): { condition: WizardState["condition"]; paint: WizardState["paint"] } {
  const condition = { ...state.condition };
  const paint = { ...state.paint };

  switch (patch.field) {
    case "colourIntent":
      condition.tier = patch.value === "same" ? "fresh" : patch.value === "bold" ? "dark_to_light" : "change";
      // The per-surface dark-to-light list belongs to the OLD question. A
      // job-wide answer supersedes it; leaving it would lift surfaces the
      // customer has just said are staying the same.
      if (patch.value !== "bold") condition.darkToLightSurfaces = [];
      break;
    case "ceilingsMarked":
      condition.ceilingsMarked = patch.value;
      if (!patch.value) condition.ceilingsChangingColour = false;
      break;
    case "ceilingsChangingColour":
      condition.ceilingsChangingColour = patch.value;
      if (patch.value) condition.ceilingsMarked = false;
      break;
    case "glossTrims":
      paint.trimsOilBased = patch.value;
      break;
    case "darkToLight": {
      const on = new Set(condition.darkToLightSurfaces ?? []);
      if (patch.value) on.add(patch.key); else on.delete(patch.key);
      condition.darkToLightSurfaces = [...on];
      break;
    }
    case "darkToLightCeilings":
      condition.darkToLightCeilings = patch.value;
      // Going back to "all" or to nothing makes the room list meaningless —
      // leaving it would have a stale set of rooms waiting to surprise somebody
      // who picks "some rooms" again a week later.
      if (patch.value !== "some") condition.darkToLightCeilingRooms = [];
      break;
    case "darkToLightCeilingRoom": {
      const rooms = new Set(condition.darkToLightCeilingRooms ?? []);
      if (patch.value) rooms.add(patch.areaId); else rooms.delete(patch.areaId);
      condition.darkToLightCeilingRooms = [...rooms].sort((a, b) => a - b);
      // Naming a room IS choosing "some rooms" — a tap in the room builder must
      // not depend on the card above still being in the right mode.
      if (condition.darkToLightCeilingRooms.length > 0) condition.darkToLightCeilings = "some";
      break;
    }
    case "surfaceFlag": {
      const all = { ...(condition.surfaceFlags ?? {}) } as Record<string, string[]>;
      const current = new Set(all[patch.group] ?? []);
      if (patch.value) current.add(patch.flag); else current.delete(patch.flag);
      // An empty list is deleted rather than stored as [] — the state is read
      // by the CRM and the work order, and an empty array reads as "asked and
      // answered none" where absence reads as "not asked".
      if (current.size === 0) delete all[patch.group];
      else all[patch.group] = [...current];
      condition.surfaceFlags = all;
      break;
    }
  }
  return { condition, paint };
}

/**
 * Re-derive every interior surface's coats in the tree (rule 3 above).
 *
 * Exterior rows and any code no substrate claims are returned untouched —
 * they were never derived here, and rewriting them from an interior table
 * would be the exterior guess plan §4.4 rules out.
 *
 * The crew note is REPLACED rather than appended: this runs on every
 * correction, and appending would grow "check the trims | check the trims |
 * …" on a customer who taps twice. Notes from anywhere else are preserved by
 * stripping only the ones this module wrote.
 */
export function applyPaintSystems(
  blocks: readonly LooseBlock[],
  state: Pick<WizardState, "condition" | "details" | "paint">,
  systems: PaintSystems = DEFAULT_PAINT_SYSTEMS,
): LooseBlock[] {
  const bold = state.condition?.tier === "dark_to_light";
  const d2l = new Set(bold ? (state.condition?.darkToLightSurfaces ?? []) : []);
  /**
   * ⚑ Tom, 11 Sep — ceilings are answered per ROOM, not per job.
   *
   * "All ceilings" behaves like any other ticked surface. "Some rooms" is a
   * list of area ids, and this is the only place in the derivation that looks at
   * which room it is in — which is why it can be per-room at all without
   * re-deriving anything twice: the blocks walk past here already.
   *
   * An empty list under "some" means no ceiling is dark to light. That is the
   * honest reading of "some rooms" with no room named, and it is the safe one:
   * it quotes the standard rather than a third coat nobody asked for.
   */
  /**
   * ⚑ BACK COMPAT, and it matters: the ASSISTANT path maps "the whole job is
   * going dark to light" onto the surface LIST — ceilings included — and so do
   * snapshots taken before this field existed. Reading only the new field would
   * have silently dropped a coat those jobs were already quoted for. A ticked
   * "ceilings" in the old list therefore means "all", unless the new answer says
   * otherwise. Same rule the assistant's own comment states: told three coats,
   * they meant the lot.
   */
  const ceilingScope = bold
    ? (state.condition?.darkToLightCeilings ?? (d2l.has("ceilings") ? "all" : null))
    : null;
  const ceilingRooms = new Set(
    ceilingScope === "some" ? (state.condition?.darkToLightCeilingRooms ?? []) : [],
  );
  return blocks.map((b) => {
    if (!isInteriorArea(b)) return b;
    const areaId = Number(b.id);
    const surfaces = (b.surfaces ?? []).map((s) => {
      const key = substrateKeyForRateCode(String(s.code ?? ""));
      const group = groupForSubstrate(key);
      if (group == null) return s;
      const darkHere = group === "ceilings"
        ? ceilingScope === "all" || (ceilingScope === "some" && ceilingRooms.has(areaId))
        : key != null && d2l.has(key);
      const answers = systemAnswersFromState(state, darkHere);
      /**
       * A ceiling going from dark to light IS a colour change, whatever ⚑3's
       * white-over-white question was answered. Saying otherwise would let the
       * coverage guard read a three-coat ceiling as "white again".
       */
      if (darkHere && group === "ceilings") answers.ceilingsChangingColour = true;
      const sys = deriveSystem(group, answers, systems);
      const kept = stripSystemNotes(String(s.crewNote ?? ""));
      const crewNote = [kept, sys.crewNote].filter(Boolean).join(" | ");
      return { ...s, coats: sys.coats, crewNote };
    });
    return { ...b, surfaces };
  });
}

/** The notes lib/pricing/systems.ts writes, so a re-run replaces rather than stacks. */
const SYSTEM_NOTE_MARKERS = ["bonding primer", "stain-block", "oil-based"];

function stripSystemNotes(note: string): string {
  return note
    .split(" | ")
    .filter((part) => {
      const p = part.toLowerCase();
      return part !== "" && !SYSTEM_NOTE_MARKERS.some((m) => p.includes(m));
    })
    .join(" | ");
}

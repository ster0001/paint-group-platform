import {
  DEFAULT_SURFACES, defaultExterior, defaultWizardState,
  type WizardState, type WizardSurfaceKey,
} from "./state";

/**
 * The QUICK LOOK — estimator journey v2 §3, phase 2 of the build sequence.
 *
 * The plan's first target: *"under a minute, under ten taps from landing to a
 * number. Today it's 25-30 answers."* This module is the eight answers that
 * replace them, and the mapping from those eight onto the full wizard state
 * the engine has always priced.
 *
 * The rule that shapes everything here: **the customer answers what they can
 * see, and we derive the rest.** They know how many bedrooms they have and
 * whether the place looks tired. They do not know how many coats a trim needs,
 * what a bonding primer is, or what their ceiling height is to the nearest
 * 300 mm. So the quick look asks the first kind of question and NEVER the
 * second — everything else is an honest default, shown back to them on the
 * reveal screen as an assumption they can tap and change.
 *
 * Nothing in here computes money. It produces answers; `lib/pricing` prices
 * them, exactly as it does for a job that came from a floorplan.
 */

/** The eight answers. Every one of them is a tap. */
export type QuickLook = {
  /** Screen 1 — with the address. */
  jobType: "interior" | "exterior" | "both";
  /** Screen 2 — the place. */
  propertyKind: "house" | "townhouse" | "unit_apartment" | "commercial";
  bedrooms: number;
  storeys: "single" | "double";
  /** Screen 3 — the job. */
  scope: ScopePreset;
  colour: ColourIntent;
  /** Screen 4 — condition. */
  condition: ConditionBand;
  occupied: "yes" | "no";
};

export type ScopePreset = "whole" | "some_rooms" | "walls_ceilings" | "trims_doors";
export type ColourIntent = "same" | "new" | "bold";
export type ConditionBand = "good" | "wear" | "needs_work";

/**
 * The defaults a customer never has to touch.
 *
 * Three bedrooms, single storey, whole interior, new colours, some wear is
 * the median Australian repaint — so someone who taps nothing but "Continue"
 * four times still gets a defensible number. That is what "nine taps on
 * defaults" in §3 means: the taps are for people who differ from the median,
 * not a toll everyone pays.
 */
export const DEFAULT_QUICK_LOOK: QuickLook = {
  jobType: "interior",
  propertyKind: "house",
  bedrooms: 3,
  storeys: "single",
  scope: "whole",
  colour: "new",
  condition: "wear",
  occupied: "no",
};

export type Choice<T> = { value: T; label: string; hint?: string };

export const JOB_TYPES: Choice<QuickLook["jobType"]>[] = [
  { value: "interior", label: "Inside" },
  { value: "exterior", label: "Outside" },
  { value: "both", label: "Both" },
];

export const PROPERTY_KINDS: Choice<QuickLook["propertyKind"]>[] = [
  { value: "house", label: "House" },
  { value: "townhouse", label: "Townhouse" },
  { value: "unit_apartment", label: "Unit or apartment" },
  { value: "commercial", label: "Commercial", hint: "Office, shop, strata, industrial" },
];

export const STOREYS: Choice<QuickLook["storeys"]>[] = [
  { value: "single", label: "Single storey" },
  { value: "double", label: "Two storeys", hint: "Adds the stairwell and upper hall" },
];

export const SCOPE_PRESETS: Choice<ScopePreset>[] = [
  { value: "whole", label: "The whole interior", hint: "Walls, ceilings, skirtings, doors and frames — the usual full repaint" },
  { value: "some_rooms", label: "Some rooms", hint: "You'll pick which ones next" },
  { value: "walls_ceilings", label: "Walls and ceilings only" },
  { value: "trims_doors", label: "Doors, skirtings and trims only" },
];

export const COLOUR_INTENTS: Choice<ColourIntent>[] = [
  { value: "same", label: "The same colours again", hint: "Colour-matched — a freshen up" },
  { value: "new", label: "New colours", hint: "Two coats, standard preparation" },
  { value: "bold", label: "Going much lighter, or a bold colour", hint: "An undercoat first, then two coats" },
];

export const CONDITION_BANDS: Choice<ConditionBand>[] = [
  { value: "good", label: "Good — just tired", hint: "Sound surfaces, a light sand and it's ready" },
  { value: "wear", label: "Some wear", hint: "Scuffs, marks, the odd hairline crack or nail hole" },
  { value: "needs_work", label: "Needs work", hint: "Flaking, cracked plaster, water marks, damage" },
];

export const OCCUPIED: Choice<QuickLook["occupied"]>[] = [
  { value: "no", label: "No, it'll be empty" },
  { value: "yes", label: "Yes, we'll be there", hint: "We work room by room and pack down each day" },
];

/** The surfaces each preset ticks. */
const SCOPE_SURFACES: Record<ScopePreset, WizardSurfaceKey[]> = {
  whole: DEFAULT_SURFACES,
  // "Some rooms" narrows the ROOMS, not the surfaces — which rooms is the
  // first thing the tighten stage asks. Ticking fewer surfaces here would
  // quietly answer a different question than the one they were asked.
  some_rooms: DEFAULT_SURFACES,
  walls_ceilings: ["walls", "ceilings", "cornices"],
  trims_doors: ["doors", "architraves", "skirting"],
};

/**
 * Condition band → the engine's damage tier.
 *
 * The engine has four tiers (0 none · 1 minor · 2 a few areas of concern · 3
 * desperate); the customer is offered three, because a homeowner cannot tell
 * 2 from 3 by eye and asking them to is how you get a wrong answer confidently
 * given.
 *
 * ⚑ "Needs work" maps to 2, NOT 3. At quick-look resolution "flaking, cracked
 * plaster, water marks" is a job with real preparation in it, not a
 * restoration — and the guide range must not overstate. Tier 3 stays reachable
 * where it is actually earned: the per-room spots in the tighten stage, where
 * the customer points at the damage and a photo settles it. Tom's call if he
 * wants the guide to lead with the higher number instead.
 */
const CONDITION_DAMAGE_TIER: Record<ConditionBand, number> = {
  good: 0,
  wear: 1,
  needs_work: 2,
};

/** Colour intent → the stored `condition.tier` (whose name predates it). */
const COLOUR_TIER: Record<ColourIntent, WizardState["condition"]["tier"]> = {
  same: "fresh",
  new: "change",
  bold: "dark_to_light",
};

/**
 * The quick look, as a state the engine can price.
 *
 * `base` is the state already in flight — a resumed draft, a member's prefill,
 * a saved spec — so this REPLACES only what the quick look asked and leaves
 * everything else exactly as it was. Overwriting the whole object here would
 * throw away a typed address or a prefilled email, which is the bug every
 * previous seed-shaped function in this codebase has had at least once.
 */
export function quickLookToState(q: QuickLook, base?: WizardState): WizardState {
  const s = base ?? defaultWizardState();
  const interior = q.jobType !== "exterior";

  return {
    ...s,
    jobType: q.jobType,
    // The answers as tapped, so autosave and resume can put them back — the
    // derived state below cannot be read backwards into eight chips.
    quickLook: q,
    // The no-plan path: the starter list builds the room tree from these.
    noPlan: true,
    basics: {
      bedrooms: Math.max(1, Math.min(8, Math.round(q.bedrooms))),
      storeys: q.storeys,
      // Not asked. "Unsure" is the honest answer and it is what the starter
      // list already treats as "size it from the room types".
      sizeBand: "unsure",
      // Not asked, and deliberately FALSE: living + separate kitchen is the
      // smaller of the two layouts, and the starter list's own rule is that
      // under-scoping is a conversation in the editor while over-scoping is a
      // wrong quote. The tighten stage's room list is where this gets fixed,
      // with the room in front of them.
      openPlanKitchenLiving: false,
    },
    customer: {
      ...(s.customer ?? {
        email: "", suburb: "", postcode: "",
        commercialGates: {},
        heritageListed: "unsure" as const,
        bodyCorporate: "unsure" as const,
        builtPre1970: "unsure" as const,
        asbestosSuspected: "unsure" as const,
        propertyKind: q.propertyKind,
      }),
      propertyKind: q.propertyKind,
      /**
       * The four questions the quick look does NOT ask, left at "unsure".
       *
       * This is safe by design, not by luck: the policy ladder treats
       * `asbestos_unsure` and `heritage_unsure` as SOFT (Tom, 7 Sep — "not
       * sure about asbestos is a flag for the visit, never an online accept,
       * not a dead end"), and it no longer asks the build year at all because
       * the office looks it up. So the range still shows, the job still
       * flags, and nobody self-accepts on an unanswered hazard question.
       *
       * A definite "yes" — from staff, the assistant, or the detailed pages —
       * still hard-stops exactly as it always did. We are declining to guess,
       * not declining to check.
       */
      heritageListed: s.customer?.heritageListed ?? "unsure",
      bodyCorporate: s.customer?.bodyCorporate ?? "unsure",
      builtPre1970: s.customer?.builtPre1970 ?? "unsure",
      asbestosSuspected: s.customer?.asbestosSuspected ?? "unsure",
    },
    /**
     * A job with an outside to it needs an `exterior` block or the sides never
     * get built from answers — the same thing `entryPatch` did for the old
     * "answer a few questions" route. `noPhotos` is what says "size it from
     * what they told us" rather than from an elevation read.
     *
     * ⚑ It does NOT name the sides. Which sides are being painted is the
     * exterior question set's job, and a job that never answered it prices all
     * four — the fault behind "I asked for front, left and back and it gave me
     * the right side too". A `both` job therefore still has to walk the
     * exterior pages; the quick look only settles the inside.
     */
    exterior: q.jobType === "interior"
      ? s.exterior
      : { ...(s.exterior ?? defaultExterior()), noPhotos: true },
    surfaces: interior ? SCOPE_SURFACES[q.scope] : s.surfaces,
    condition: {
      ...s.condition,
      tier: COLOUR_TIER[q.colour],
      // Colour intent is job-wide here; the per-surface corrections live on
      // the paint-systems screen, which is a tighten rung.
      darkToLightSurfaces: [],
    },
    details: {
      ...s.details,
      damageTier: CONDITION_DAMAGE_TIER[q.condition],
      occupied: q.occupied,
      /**
       * Door style, window style and ceiling height stay "unsure".
       *
       * These are the three questions §2 complains about most: a customer
       * cannot answer them reliably, and each one asked badly costs a tap and
       * buys a wrong number. "Unsure" is a real value the engine already
       * handles — it prices the honest middle and flags the assumption — and
       * all three are on the assume list under the range, one tap away for
       * anyone who does know.
       */
      doorStyle: s.details.doorStyle,
      windowStyle: s.details.windowStyle,
      ceilingHeight: s.details.ceilingHeight,
    },
  };
}

/**
 * The restatement under the range: *"Based on a 3-bedroom, single-storey
 * house, the whole interior, new colours, some wear. If that's about right,
 * this is about right."*
 *
 * It exists because a range with no premise is a number the customer cannot
 * check. Reading their own answers back is the cheapest possible way to catch
 * a mis-tap before it becomes a complaint about the price.
 */
export function restatement(q: QuickLook): string {
  const kind = q.propertyKind === "unit_apartment" ? "unit"
    : q.propertyKind === "commercial" ? "commercial place"
    : q.propertyKind;
  const storeys = q.storeys === "double" ? "two-storey" : "single-storey";
  const scope = q.jobType === "exterior" ? "the outside"
    : q.scope === "whole" ? "the whole interior"
    : q.scope === "some_rooms" ? "some of the rooms"
    : q.scope === "walls_ceilings" ? "walls and ceilings"
    : "doors and trims";
  const colour = q.colour === "same" ? "the same colours"
    : q.colour === "new" ? "new colours"
    : "a much lighter or bolder colour";
  const cond = q.condition === "good" ? "good condition"
    : q.condition === "wear" ? "some wear"
    : "needing some work";
  return `Based on a ${q.bedrooms}-bedroom, ${storeys} ${kind}, ${scope}, ${colour}, ${cond}. If that's about right, this is about right.`;
}

/**
 * "What we've assumed · TAP TO CHANGE".
 *
 * Every line is something we decided FOR them. Showing it is the whole
 * argument for being allowed to decide it: a hidden assumption is a trap, a
 * listed one is a shortcut they can take back. `step` is the quick-look
 * screen a line jumps to; `rung` is the tighten rung, for the things that
 * cannot be answered until there is a room list to answer them against.
 */
export type Assumption = { key: string; what: string; why: string; step?: number; rung?: string };

export function assumedList(q: QuickLook): Assumption[] {
  const rooms: Assumption = {
    key: "rooms",
    what: `A typical ${q.bedrooms}-bedroom ${q.storeys === "double" ? "two-storey " : ""}layout`,
    why: "Room sizes from our averages for a place this size — the biggest single thing you can tighten.",
    rung: "rooms",
  };
  const out: Assumption[] = [rooms];

  if (q.jobType !== "exterior") {
    out.push({
      key: "systems",
      what: "The coats and preparation for each surface",
      why: "Worked out from your colours and condition answers, not guessed — check it and change any line.",
      rung: "systems",
    });
    out.push({
      key: "height",
      what: "Standard ceiling height",
      why: "We've assumed the usual 2.4 m. Raked or high ceilings change the access and the paint.",
      rung: "rooms",
    });
    out.push({
      key: "openings",
      what: "Typical doors and windows",
      why: "Counted from the room list at average numbers, in the usual styles.",
      rung: "rooms",
    });
  }

  out.push({
    key: "access",
    what: "Straightforward access and setup",
    why: "Parking at the door, no lift booking, nothing to work around. Tell us if that's not it.",
    rung: "access",
  });
  out.push({
    key: "hazards",
    what: "No asbestos or lead to deal with",
    why: "We haven't asked yet — a person checks this before any price is fixed.",
  });
  out.push({
    key: "excluded",
    what: "No scaffolding or structural repairs",
    why: "Access equipment and anything structural are quoted separately if they turn out to be needed.",
  });
  return out;
}

/** Every quick-look screen, in order. */
export const QUICK_LOOK_STEPS = ["start", "place", "job", "condition", "outside"] as const;
export type QuickLookStep = (typeof QUICK_LOOK_STEPS)[number];

/**
 * Which screens a job type actually walks.
 *
 * An OUTSIDE-ONLY job skips the interior scope preset and the colour question —
 * it has no rooms — and takes the exterior quick look (`s-ext-job`) instead.
 * A BOTH job walks all five: the inside is answered, then the outside.
 *
 * ⚑ This is what replaced the hand-off to the old five-page exterior question
 * set. It was "for now" while the per-elevation allowances (§8) did not exist;
 * they do now, so the reason is gone.
 */
export function stepsFor(jobType: QuickLook["jobType"]): QuickLookStep[] {
  if (jobType === "exterior") return ["start", "place", "outside"];
  if (jobType === "both") return [...QUICK_LOOK_STEPS];
  return ["start", "place", "job", "condition"];
}

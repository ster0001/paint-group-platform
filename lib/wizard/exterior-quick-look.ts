import { defaultExterior, type WizardState } from "./state";
import type { Choice } from "./quick-look";

/**
 * THE EXTERIOR QUICK LOOK — prototype screen `s-ext-job`, "About the house".
 *
 * §3's exterior branch: *"Exterior gets its own five-answer quick look, then
 * the sides builder with a photo per side."* It was the last thing in the plan
 * still taking the old five-page question set, and it was blocked on the
 * per-elevation allowances (§8) until those landed.
 *
 * FIVE ANSWERS ON ONE SCREEN, because an exterior job has no rooms to seed and
 * these five are the whole basis of the number:
 *
 *   storeys      how high, which is the access allowance
 *   materials    what the walls are, which is the rate
 *   painting     the house, and/or the fence, deck, shed
 *   condition    good / weathered / peeling — the preparation
 *   access       steep, tight, double-height, needs a lift
 *
 * ⚑ IT DOES NOT ASK WHICH SIDES, and that is the prototype's own answer rather
 * than an omission. `s-ext-sides` — "walk around the house", amber for assumed,
 * dashed for not painting — is a TIGHTEN rung, and the sides editor already
 * builds it. Four sides start assumed; a side the customer says no to becomes
 * an explicit exclusion there, which is exactly where that decision is visible
 * to them.
 *
 * Pure. The screen collects; `applyExteriorQuickLook` maps onto the state the
 * engine has always priced.
 */

export type ExteriorQuickLook = {
  storeys: "single" | "double";
  /** Multi-select; a mix is several ticked. */
  substrates: ExteriorSubstrate[];
  /** The house, and/or the freestanding things. */
  targets: ExteriorTarget[];
  condition: "good" | "weathered" | "peeling";
  /** Multi-select, including the two that are never priced here. */
  access: ExteriorAccessAnswer[];
};

export type ExteriorSubstrate = "weatherboards" | "render" | "brick" | "cement_sheet" | "colorbond" | "other";
export type ExteriorTarget = "house" | "fence" | "deck" | "shed";
/** `lift` is equipment, not a wall condition — it never prices, it excludes. */
export type ExteriorAccessAnswer = "steep" | "tight" | "high" | "lift" | "none";

export const DEFAULT_EXTERIOR_QUICK_LOOK: ExteriorQuickLook = {
  storeys: "single",
  substrates: ["weatherboards"],
  targets: ["house"],
  condition: "good",
  access: [],
};

export const EXT_STOREYS: Choice<ExteriorQuickLook["storeys"]>[] = [
  { value: "single", label: "Single", hint: "Up to about 4 m" },
  { value: "double", label: "Double", hint: "Over 4 m — ladders and platforms" },
];

export const EXT_SUBSTRATES: Choice<ExteriorSubstrate>[] = [
  { value: "weatherboards", label: "Weatherboard" },
  { value: "render", label: "Render" },
  { value: "brick", label: "Brick" },
  { value: "cement_sheet", label: "Cement sheet" },
  { value: "colorbond", label: "Colorbond" },
  { value: "other", label: "Other" },
];

export const EXT_TARGETS: Choice<ExteriorTarget>[] = [
  { value: "house", label: "The house", hint: "Walls, eaves, fascias, gutters, windows, doors" },
  { value: "fence", label: "Fence" },
  { value: "deck", label: "Deck or floor" },
  { value: "shed", label: "Garage or shed" },
];

export const EXT_CONDITIONS: Choice<ExteriorQuickLook["condition"]>[] = [
  { value: "good", label: "Good" },
  { value: "weathered", label: "Weathered" },
  { value: "peeling", label: "Peeling" },
];

export const EXT_ACCESS: Choice<ExteriorAccessAnswer>[] = [
  { value: "steep", label: "Steep block" },
  { value: "tight", label: "Tight side access" },
  { value: "high", label: "Double-height entry" },
  { value: "lift", label: "Needs a lift or scaffold" },
  { value: "none", label: "Nothing tricky" },
];

/**
 * Toggle one multi-select answer.
 *
 * "Nothing tricky" is exclusive both ways — picking it clears the others, and
 * picking another clears it. A list that says both "steep block" and "nothing
 * tricky" is not an answer, and silently keeping both is how an estimator ends
 * up trusting neither.
 */
export function toggleAccess(current: ExteriorAccessAnswer[], value: ExteriorAccessAnswer): ExteriorAccessAnswer[] {
  if (value === "none") return current.includes("none") ? [] : ["none"];
  const without = current.filter((a) => a !== "none" && a !== value);
  return current.includes(value) ? without : [...without, value];
}

/** Toggle a material or a target, never emptying the list past its floor. */
export function toggleKeeping<T extends string>(current: T[], value: T, floor: T): T[] {
  const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
  return next.length > 0 ? next : [floor];
}

/**
 * The five answers, as the state the engine prices.
 *
 * `noPhotos: true` is what says "size the elevations from these answers" — the
 * path Tom asked for on 31 Aug (exterior from scratch, no listing, no photos).
 * A customer who wants to upload a listing or facade photos takes the upload
 * route from the first screen instead, and that path is untouched.
 */
export function applyExteriorQuickLook(q: ExteriorQuickLook, base: WizardState): WizardState {
  const ext = base.exterior ?? defaultExterior();
  const house = q.targets.includes("house");

  return {
    ...base,
    exterior: {
      ...ext,
      storeys: q.storeys,
      substrates: q.substrates,
      targets: q.targets,
      condition: q.condition,
      // The ground and height conditions that carry an hours allowance
      // (lib/wizard/exterior-allowances.ts). "Nothing tricky" and the
      // equipment answer are deliberately not among them.
      access: q.access.filter((a): a is "steep" | "tight" | "high" => a === "steep" || a === "tight" || a === "high"),
      /**
       * Scaffolding and lifts are EXCLUDED, never priced — always a separate
       * variation, with no threshold at which we absorb them. The allowances
       * module words the exclusion; this just records that they said so.
       */
      accessEquipment: q.access.includes("lift") ? ["scaffold"] : [],
      // The freestanding things ride the extras block the engine already reads.
      extras: {
        ...ext.extras,
        fence: q.targets.includes("fence"),
        deck: q.targets.includes("deck"),
      },
      // A house with no body to paint is a job about a fence, not a house.
      painting: { ...ext.painting, body: house },
      noPhotos: true,
    },
  };
}

/**
 * What the customer is told before they see an exterior number.
 *
 * Every exterior price is confirmed by a person — that is the prototype's own
 * line on this screen, and it is the honest one: §4.4 flags that the
 * per-elevation allowances are new and ⚑15 says show the range with the
 * equipment exclusion stated plainly rather than hide it.
 */
export const EXTERIOR_PROMISE =
  "Three answers seed the sides. Every outside price is confirmed by your estimator "
  + "before it's fixed — but you'll see a guide range in a moment.";

import { defaultExterior, exteriorElements, exteriorSurfaceKeys, type WizardExterior, type WizardState } from "./state";
import { isExteriorSubstrateKey } from "@/lib/estimate/substrates";
import type { Choice } from "./quick-look";

/**
 * THE EXTERIOR QUICK LOOK — prototype screen `s-ext-job` at v2.6, "What are
 * we painting?" (C8b, `docs/briefs/claude-code-brief-c8b-exterior-quick-look.md`).
 *
 * Rebuilt 11 Sep to Tom's structure — ELEMENTS FIRST. The earlier version
 * (v1 and the v2.5 prototype) asked what the house is *made of* before
 * establishing whether the walls were being painted at all, and pre-ticked
 * weatherboard. Both wrong: plenty of jobs are trims and roofline only, and
 * brick or render is often left bare on purpose.
 *
 * The order is the specification:
 *   1. On the house — body, windows, doors, fascias, gutters, eaves. Nothing
 *      pre-ticked.
 *   2. Standing on its own — fence, deck, garage or shed, wall. Nothing pre-ticked.
 *   3. Only if the body is ticked — what the walls are made of. Nothing pre-ticked.
 *   4. Only if windows are ticked — the type, mostly, and how many all up.
 *   5. Only if doors are ticked — how many.
 *   6. Colours — the same three-way shape as the interior, feeding the same
 *      derivation (⚑51).
 *   7. Condition.  8. Storeys, asked ONCE, here and nowhere else.  9. Access.
 *
 * No bedrooms anywhere on this path, and `basics` is never written on an
 * exterior session (`quickLookToState`). Pure: the screen collects, and
 * `applyExteriorQuickLook` maps onto the state the engine has always priced;
 * `exteriorQuickLookFromState` reads it back for resume.
 */

export type ExteriorElement = "body" | "windows" | "doors" | "fascias" | "gutters" | "eaves";
/** Tom, 15 Sep (item 6a): "any other areas being painted?" — each seeds its own rate row. */
export type ExteriorStandalone = "garage_door" | "paling_fence" | "picket_fence" | "deck" | "shed" | "wall";
export type ExteriorMaterial = "weatherboards" | "brick" | "render" | "stucco" | "cement_sheet" | "panelling" | "unsure";
export type ExteriorWindowType = "casement" | "sash" | "colonial" | "winder" | "alu" | "unsure";
export type ExteriorColour = "same" | "new" | "bold";
/** `lift` is equipment, not a wall condition — it never prices, it excludes. */
export type ExteriorAccessAnswer = "steep" | "tight" | "high" | "lift" | "none";

export type ExteriorQuickLook = {
  elements: ExteriorElement[];
  standalone: ExteriorStandalone[];
  /** Only meaningful when the body is ticked. Empty = not told. */
  materials: ExteriorMaterial[];
  windowType: ExteriorWindowType;
  windowCount: number;
  doorCount: number;
  colour: ExteriorColour;
  /**
   * Tom, 15 Sep (late): condition is NOT asked before the gate any more. The
   * guide range prices it good-to-peeling (lib/wizard/envelope.ts) and the
   * tighten screen asks it first. Null = not yet answered.
   */
  condition: "good" | "weathered" | "peeling" | null;
  storeys: "single" | "double";
  access: ExteriorAccessAnswer[];
  /**
   * Tom, 15 Sep (late): "Which sides?" — its own screen just before the gate.
   * Null = the screen has not been reached; an array is the answer (all four
   * = the full exterior). A side left off is not scaffolded at all.
   */
  sides: ExteriorSide[] | null;
};

export type ExteriorSide = "front" | "left" | "back" | "right";
export const EXT_SIDES: Choice<ExteriorSide>[] = [
  { value: "front", label: "Front", hint: "The street side" },
  { value: "left", label: "Left side", hint: "Looking from the street" },
  { value: "back", label: "Back" },
  { value: "right", label: "Right side", hint: "Looking from the street" },
];
export const ALL_SIDES: ExteriorSide[] = ["front", "left", "back", "right"];

/** The prototype's defaults: nothing ticked on the elements or the materials. */
export const DEFAULT_EXTERIOR_QUICK_LOOK: ExteriorQuickLook = {
  elements: [],
  standalone: [],
  materials: [],
  windowType: "unsure",
  windowCount: 8,
  doorCount: 2,
  colour: "new",
  condition: null,
  storeys: "single",
  access: ["none"],
  sides: null,
};

export const EXT_ELEMENTS: Choice<ExteriorElement>[] = [
  { value: "body", label: "The body of the house", hint: "The walls themselves" },
  { value: "windows", label: "Windows", hint: "Frames and sashes" },
  { value: "doors", label: "Doors", hint: "And their frames" },
  { value: "fascias", label: "Fascias", hint: "The board behind the gutter" },
  { value: "gutters", label: "Gutters & downpipes" },
  { value: "eaves", label: "Eaves", hint: "The underside of the overhang" },
];

export const EXT_STANDALONE: Choice<ExteriorStandalone>[] = [
  { value: "garage_door", label: "Garage door" },
  { value: "paling_fence", label: "Paling fence" },
  { value: "picket_fence", label: "Picket fence" },
  { value: "deck", label: "Deck" },
  { value: "shed", label: "Shed / garage", hint: "The building itself" },
  { value: "wall", label: "Wall", hint: "Boundary or retaining" },
];

export const EXT_MATERIALS: Choice<ExteriorMaterial>[] = [
  { value: "weatherboards", label: "Weatherboard" },
  { value: "brick", label: "Brick" },
  { value: "render", label: "Render" },
  { value: "stucco", label: "Stucco" },
  { value: "cement_sheet", label: "Cement sheet" },
  { value: "panelling", label: "Cladding or panelling", hint: "Priced as Colorbond cladding" },
  { value: "unsure", label: "Not sure" },
];

export const EXT_WINDOW_TYPES: Choice<ExteriorWindowType>[] = [
  { value: "casement", label: "Casement", hint: "Hinged, opens out" },
  { value: "sash", label: "Sash", hint: "Slides up and down" },
  { value: "colonial", label: "Colonial", hint: "Small panes, lots of bars" },
  { value: "winder", label: "Winder", hint: "Louvres on a crank" },
  { value: "alu", label: "Aluminium", hint: "Usually not painted" },
  { value: "unsure", label: "Not sure" },
];

export const EXT_COLOURS: Choice<ExteriorColour>[] = [
  { value: "same", label: "The same colours again", hint: "Colour-matched — a freshen up" },
  { value: "new", label: "New colours", hint: "Two coats, standard preparation" },
  { value: "bold", label: "Going much lighter", hint: "An undercoat first, then two coats" },
];

export const EXT_CONDITIONS: Choice<"good" | "weathered" | "peeling">[] = [
  { value: "good", label: "Good", hint: "Sound, just tired" },
  { value: "weathered", label: "Weathered", hint: "Faded, chalky" },
  { value: "peeling", label: "Peeling", hint: "Flaking, bare patches" },
];

export const EXT_STOREYS: Choice<ExteriorQuickLook["storeys"]>[] = [
  { value: "single", label: "Single", hint: "Up to about 4 m" },
  { value: "double", label: "Double", hint: "Over 4 m — additional access equipment required" },
];

export const EXT_ACCESS: Choice<ExteriorAccessAnswer>[] = [
  { value: "steep", label: "Steep block" },
  { value: "tight", label: "Tight side access" },
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

/** Toggle a value in a list — no floor: nothing is ticked for anyone (C8b). */
export function toggleIn<T extends string>(current: T[], value: T): T[] {
  return current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
}

/** "Not sure" on the materials is exclusive: it means "I can't tell you", not "and also". */
export function toggleMaterial(current: ExteriorMaterial[], value: ExteriorMaterial): ExteriorMaterial[] {
  if (value === "unsure") return current.includes("unsure") ? [] : ["unsure"];
  return toggleIn(current.filter((m) => m !== "unsure"), value);
}

/** Is anything at all being painted? The Continue gate. */
export function paintsSomething(q: Pick<ExteriorQuickLook, "elements" | "standalone">): boolean {
  return q.elements.length > 0 || q.standalone.length > 0;
}

// ---------------------------------------------------------------------------
// To and from the state
// ---------------------------------------------------------------------------

/** The prototype's material → the state's substrate. Panelling and "not sure" have no rate row: `other` scaffolds a placeholder the estimator swaps. */
const MATERIAL_TO_SUBSTRATE: Record<ExteriorMaterial, WizardExterior["substrates"][number]> = {
  weatherboards: "weatherboards", brick: "brick", render: "render", stucco: "stucco", cement_sheet: "cement_sheet",
  panelling: "colorbond", unsure: "other",
};

const COLOUR_TIER: Record<ExteriorColour, WizardState["condition"]["tier"]> = {
  same: "fresh", new: "change", bold: "dark_to_light",
};

/**
 * The answers, as the state the engine prices.
 *
 * `noPhotos: true` is what says "size the elevations from these answers" — the
 * path Tom asked for on 31 Aug (exterior from scratch, no listing, no photos).
 * The elements ride `exterior.elements` and `painting` (both, so every reader
 * agrees); the materials ride `substrates`; the type and counts are new fields
 * the seed reads (`starterExteriorNodes`). Colour writes `condition.tier` on
 * an exterior-only job so the exterior systems derive from it (⚑51) — on a
 * "both" job the interior's own colour answer keeps the field.
 */
export function applyExteriorQuickLook(q: ExteriorQuickLook, base: WizardState): WizardState {
  const ext = base.exterior ?? defaultExterior();
  const on = new Set(q.elements);
  const house = q.elements.length > 0;
  const targets: WizardExterior["targets"] = [
    ...(house ? ["house" as const] : []),
    ...(q.standalone.includes("paling_fence") || q.standalone.includes("picket_fence") ? ["fence" as const] : []),
    ...(q.standalone.includes("deck") ? ["deck" as const] : []),
    ...(q.standalone.includes("shed") ? ["shed" as const] : []),
    ...(q.standalone.includes("wall") ? ["wall" as const] : []),
  ];
  const fenceOn = q.standalone.includes("paling_fence") || q.standalone.includes("picket_fence");
  const substrates = [...new Set(q.materials.map((m) => MATERIAL_TO_SUBSTRATE[m]))];

  const nextExt: WizardExterior = {
      ...ext,
      storeys: q.storeys,
      substrates,
      targets,
      elements: {
        windows: on.has("windows"), doors: on.has("doors"),
        eaves: on.has("eaves"), fascias: on.has("fascias"), gutters: on.has("gutters"),
        garage: q.standalone.includes("garage_door"),
      },
      painting: {
        ...ext.painting,
        body: on.has("body"),
        windowsDoors: on.has("windows") || on.has("doors"),
        roofline: on.has("eaves") || on.has("fascias") || on.has("gutters"),
        garage: q.standalone.includes("garage_door"),
      },
      windowType: on.has("windows") ? q.windowType : null,
      windowCount: on.has("windows") ? Math.max(0, Math.min(200, Math.round(q.windowCount))) : null,
      doorCount: on.has("doors") ? Math.max(0, Math.min(60, Math.round(q.doorCount))) : null,
      colour: q.colour,
      condition: q.condition,
      // Tom, 15 Sep (late): the sides screen. Fewer than four = those sides;
      // all four (or unanswered) = the full exterior, which `sides` leaves unset.
      sides: q.sides && q.sides.length > 0 && q.sides.length < 4
        ? (["front", "left", "right", "back"] as const).filter((k) => q.sides!.includes(k))
        : undefined,
      sidesAnswered: q.sides != null && q.sides.length > 0,
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
      shed: q.standalone.includes("shed") ? (ext.shed ?? { substrate: "colorbond" }) : null,
      wall: q.standalone.includes("wall") ? (ext.wall ?? { substrate: "brick", metres: null }) : null,
      extras: {
        ...ext.extras,
        fence: fenceOn,
        // Tom, 15 Sep: the tick names the fence — paling, or picket (brushed).
        fenceType: q.standalone.includes("picket_fence") ? "picket_hand" : q.standalone.includes("paling_fence") ? "paling" : ext.extras.fenceType,
        deck: q.standalone.includes("deck"),
      },
      noPhotos: true,
  };

  /**
   * ⚑ THE TICKS. `state.surfaces` is the one list the merge's tick filter and
   * the sides seed read (`exteriorSurfaceKeys` is the shared mapping). The
   * quick look never wrote it, so an outside job carried the INTERIOR default
   * ticks and the seed dropped every window, door and trim — walls only,
   * since C8. An exterior job's ticks are exactly the elements; a "both" job
   * keeps its interior ticks and swaps in the exterior ones.
   */
  const exteriorKeys = exteriorSurfaceKeys(nextExt);
  const surfaces = base.jobType === "exterior"
    ? exteriorKeys
    : [...new Set([...base.surfaces.filter((k) => !isExteriorSubstrateKey(k)), ...exteriorKeys])];

  return {
    ...base,
    exterior: nextExt,
    surfaces: surfaces as WizardState["surfaces"],
    condition: base.jobType === "exterior"
      ? { ...base.condition, tier: COLOUR_TIER[q.colour], darkToLightSurfaces: [] }
      : base.condition,
  };
}

/** The answers as the screen shows them, read back from a stored state (resume). */
export function exteriorQuickLookFromState(ext: WizardExterior | null | undefined): ExteriorQuickLook {
  if (!ext) return { ...DEFAULT_EXTERIOR_QUICK_LOOK };
  const el = exteriorElements(ext);
  const house = ext.targets.includes("house");
  const elements: ExteriorElement[] = [];
  if (house && ext.painting.body) elements.push("body");
  if (house && el.windows) elements.push("windows");
  if (house && el.doors) elements.push("doors");
  if (house && el.fascias) elements.push("fascias");
  if (house && el.gutters) elements.push("gutters");
  if (house && el.eaves) elements.push("eaves");
  const standalone: ExteriorStandalone[] = [];
  if (el.garage) standalone.push("garage_door");
  if (ext.extras.fence || ext.targets.includes("fence")) standalone.push(ext.extras.fenceType === "picket_hand" || ext.extras.fenceType === "picket_spray" ? "picket_fence" : "paling_fence");
  if (ext.extras.deck || ext.targets.includes("deck")) standalone.push("deck");
  if (ext.targets.includes("shed")) standalone.push("shed");
  if (ext.targets.includes("wall")) standalone.push("wall");
  const materials = ext.substrates
    .map((s): ExteriorMaterial | null =>
      s === "weatherboards" || s === "brick" || s === "render" || s === "stucco" || s === "cement_sheet" ? s
        : s === "colorbond" ? "panelling" // Tom, 15 Sep: cladding or panelling prices as Colorbond
        : s === "other" ? "unsure" : null)
    .filter((m): m is ExteriorMaterial => m != null);
  const access: ExteriorAccessAnswer[] = [
    ...ext.access,
    ...((ext.accessEquipment ?? []).length > 0 ? ["lift" as const] : []),
  ];
  return {
    elements,
    standalone,
    materials: [...new Set(materials)],
    windowType: ext.windowType ?? "unsure",
    windowCount: ext.windowCount ?? DEFAULT_EXTERIOR_QUICK_LOOK.windowCount,
    doorCount: ext.doorCount ?? DEFAULT_EXTERIOR_QUICK_LOOK.doorCount,
    colour: ext.colour ?? "new",
    condition: ext.condition ?? null,
    storeys: ext.storeys,
    access: access.length ? access : ["none"],
    sides: ext.sidesAnswered ? (ext.sides && ext.sides.length > 0 ? [...ext.sides] : [...ALL_SIDES]) : null,
  };
}

// ---------------------------------------------------------------------------
// The reveal's words — no bedrooms anywhere on this path
// ---------------------------------------------------------------------------

const label = <T extends string>(choices: Choice<T>[], v: T) => choices.find((c) => c.value === v)?.label ?? v;
const joinList = (parts: string[]) => parts.join(", ").replace(/, ([^,]*)$/, " and $1");

export function exteriorRestatement(q: ExteriorQuickLook): string {
  const onHouse = q.elements.map((e) => label(EXT_ELEMENTS, e).toLowerCase().replace("the body of the house", "the walls"));
  const own = q.standalone.map((s) => label(EXT_STANDALONE, s).toLowerCase());
  const what = joinList([...onHouse, ...own]) || "the outside";
  const mats = q.elements.includes("body") && q.materials.length && !q.materials.includes("unsure")
    ? ` (${joinList(q.materials.map((m) => label(EXT_MATERIALS, m).toLowerCase()))})` : "";
  const windows = q.elements.includes("windows")
    ? `, ${q.windowCount} ${q.windowType === "unsure" ? "" : `${label(EXT_WINDOW_TYPES, q.windowType).toLowerCase()} `}windows` : "";
  const doors = q.elements.includes("doors") ? `, ${q.doorCount} door${q.doorCount === 1 ? "" : "s"}` : "";
  const colour = q.colour === "same" ? "the same colours" : q.colour === "bold" ? "going much lighter" : "new colours";
  const cond = q.condition === "good" ? "paintwork in good shape" : q.condition === "weathered" ? "weathered paintwork"
    : q.condition === "peeling" ? "peeling paintwork" : "the paintwork priced from good to peeling";
  const storeys = q.storeys === "double" ? "double storey" : "single storey";
  const sides = q.sides && q.sides.length > 0 && q.sides.length < 4
    ? `, the ${joinList(q.sides.map((k) => label(EXT_SIDES, k).toLowerCase()))}` : "";
  return `Based on ${what}${mats}${windows}${doors}${sides}, ${colour}, ${cond}, ${storeys}. If that's about right, this is about right.`;
}

export type ExteriorAssumption = { key: string; what: string; why: string; rung?: string };

export function exteriorAssumedList(q: ExteriorQuickLook): ExteriorAssumption[] {
  const out: ExteriorAssumption[] = [];
  const chosen = q.sides && q.sides.length > 0 && q.sides.length < 4 ? q.sides : null;
  out.push({
    key: "sides",
    what: chosen ? `The ${joinList(chosen.map((k) => label(EXT_SIDES, k).toLowerCase()))}, at typical sizes` : "All four sides, at typical sizes",
    why: "Each side is sized from our averages until you confirm it — the sides editor is where you put the real numbers in.",
    rung: "sides",
  });
  if (q.condition == null) {
    // Tom, 15 Sep (late): condition is the FIRST tighten question, not a
    // quick-look one — so the range says what it spans instead of assuming.
    out.push({
      key: "condition",
      what: "The paintwork — priced from good to peeling",
      why: "The low end of your range is sound paintwork, the high end is peeling and flaking. Tell us how it's holding up on the next screen and the range closes in.",
      rung: "sides",
    });
  }
  if (q.elements.includes("body") && (q.materials.length === 0 || q.materials.includes("unsure"))) {
    out.push({
      key: "material",
      what: "The wall material — to confirm",
      why: "You didn't say, so the walls are priced at a placeholder rate and your estimator confirms the material.",
      rung: "sides",
    });
  }
  if (q.elements.includes("windows")) {
    out.push({
      key: "windows",
      what: q.windowType === "alu"
        ? `${q.windowCount} aluminium windows — usually not painted`
        : `About ${q.windowCount} windows${q.windowType === "unsure" ? ", type to confirm" : ` at the ${label(EXT_WINDOW_TYPES, q.windowType).toLowerCase()} rate`}`,
      // 14 Sep: the count is a stepper the customer may never have touched
      // (it starts at 8) — say it is ours to change, not theirs already said.
      why: q.windowType === "alu"
        ? "Priced at nothing, with a note — your estimator checks whether any are painted."
        : q.windowType === "winder"
          ? "A winder is a crank-operated casement — priced at the casement rate and flagged for your estimator. Change the count on the outside screen if it's off."
          : "Our typical count unless you changed it on the outside screen — spread over the sides and checked side by side in the sides editor.",
      rung: "sides",
    });
  }
  if (q.elements.includes("doors")) {
    out.push({ key: "doors", what: `${q.doorCount} doors, one of them the front door`, why: "Spread over the sides; checked side by side.", rung: "sides" });
  }
  out.push({
    key: "systems",
    what: "The coats and preparation for each surface",
    why: "Worked out from your colour and condition answers, not guessed — check it and change any line.",
  });
  out.push({
    key: "excluded",
    what: "No scaffolding, lifts or rotten timber replacement",
    why: "Access equipment and repairs are quoted separately if they turn out to be needed — nothing for them is in this range.",
  });
  return out;
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
  "Tick everything. We only ask about the bits you've ticked — and every outside price is confirmed by your estimator before it's fixed.";

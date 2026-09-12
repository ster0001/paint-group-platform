import { z } from "zod";
import { SUBSTRATE_KEYS, type SubstrateKey } from "@/lib/estimate/substrates";

/**
 * W1: the wizard's state — ONE typed object, shared by the client pages and
 * the submit route, zod-validated server-side on submit (phase plan W1).
 *
 * Everything here is an ANSWER, never a price, an hour or a quantity: the
 * server rebuilds the draft tree from stored extraction runs + these answers,
 * so a client cannot post geometry or money of its own choosing — the same
 * boundary rule as the plan reader's apply route and capture's rooms route.
 */

/** Page-2 surface ticks — the substrate registry's keys (A2: one source of
 * truth; interior AND exterior, the offered subset depends on the job type
 * and the loaded rate card). Keys, not labels — labels live in the registry. */
export const WIZARD_SURFACE_KEYS = SUBSTRATE_KEYS;
export type WizardSurfaceKey = SubstrateKey;

/** The usual interior full repaint — the pre-ticked set before the rate card
 * loads. Pages with rate data use defaultSurfacesFor() instead. */
export const DEFAULT_SURFACES: WizardSurfaceKey[] = [
  "walls", "ceilings", "cornices", "doors", "architraves", "skirting",
];

export const surfaceKeySchema = z.enum(WIZARD_SURFACE_KEYS);

const basicsSchema = z.object({
  bedrooms: z.number().int().min(1).max(8),
  storeys: z.enum(["single", "double"]),
  sizeBand: z.enum(["lt120", "s120_200", "gt200", "unsure"]),
  /**
   * Business inputs §1: open-plan kitchen/living (36 m²) and living + separate
   * kitchen are very different scopes, so the basics form asks which.
   */
  openPlanKitchenLiving: z.boolean(),
  /**
   * Phase 3 (6 Sep plan): the rooms the conservative starter list used to
   * assume away — and the Proving window showed were the missing money.
   * Optional so every stored state still parses; absent = the old list.
   */
  bathrooms: z.number().int().min(1).max(4).optional(),
  separateToilet: z.boolean().optional(),
  garage: z.boolean().optional(),
  study: z.boolean().optional(),
});

/** Step 8: the customer's property answers — the guardrails' raw material. */
const customerSchema = z.object({
  email: z.string().email().max(200).or(z.literal("")).default(""),
  suburb: z.string().max(80, "The suburb looks too long — just the suburb name, please.").default(""),
  // The zod default read "Too big: expected string to have <=10 characters"
  // on the wizard page with no hint WHICH field (Tom, 28 Aug) — name it.
  postcode: z.string().max(10, "The postcode looks too long — just the 4 digits, e.g. 3167.").default(""),
  propertyKind: z.enum(["house", "townhouse", "unit_apartment", "commercial"]),
  /** Tom, 8 Sep 2026: what SORT of commercial job. A few rooms or offices
   * is priced by the wizard like any interior; a large space or a strata /
   * body-corporate building is seen by a person first. Optional so every
   * stored state still parses; a commercial job with no answer hands off. */
  commercialKind: z.enum(["small_interior", "large_interior", "strata"]).optional(),
  /**
   * Phase 7 (commercial pricing strategy): the SEGMENT question. One answer
   * that selects the sector band, the substrate set and which gates to ask.
   * Optional so every stored state still parses; absent = a person, which is
   * where a commercial enquiry has always gone.
   */
  /** C12: a KEY from `commercial_segments` (or phase 7a's six, resolved
   * through the legacy map) — the table owns the list, so the schema does
   * not enumerate it. */
  commercialSegment: z.string().max(40).optional(),
  /**
   * The routing gates, `{ height: "yes" | "no" }`. Any one "yes" sends the job
   * to an appointment — no scoring, no override (the brief's rule). An
   * UNANSWERED gate is not a "no": a blank is the least bounded answer there
   * is, and the whole point of the gate is refusing to guess.
   */
  commercialGates: z.record(z.string().max(30), z.enum(["yes", "no"])).default({}),
  heritageListed: z.enum(["yes", "no", "unsure"]),
  bodyCorporate: z.enum(["yes", "no", "unsure"]),
  builtPre1970: z.enum(["yes", "no", "unsure"]),
  asbestosSuspected: z.enum(["yes", "no", "unsure"]),
});

/** The SHAPE of a wizard state — every field, no cross-field rules. Seeds
 * (a showcase job's scope, lib/wizard/showcaseSeed) validate against this;
 * a state on its way to submit validates against wizardStateSchema below. */
export const wizardStateShapeSchema = z.object({
  /** internal = staff from the estimates list · customer = Step 8's public
   * wizard (guardrails + range bands + email gate apply). */
  mode: z.enum(["internal", "customer"]),
  customer: customerSchema.nullable().default(null),
  jobType: z.enum(["interior", "exterior", "both"]),
  /** Internal mode: the job's name/address for the estimates list. */
  title: z.string().max(200).default(""),
  /** A1: the structured address when a Places suggestion was picked —
   * flows to builder_state.jobAddress at submit. Plain typing leaves it null. */
  address: z.object({
    street: z.string().max(120, "That street address looks too long."),
    suburb: z.string().max(80, "That suburb looks too long."),
    // 28 Aug: a pre-radius-cap UK Places pick ("East Riding of Yorkshire")
    // stored a 24-char state and every later submit failed with raw
    // zod-speak. Producers clamp via clampAddress(); the messages here
    // name the field for anything that still slips through.
    state: z.string().max(10, "The state looks too long — the short form, e.g. VIC."),
    postcode: z.string().max(10, "The postcode looks too long — just the 4 digits, e.g. 3167."),
    formatted: z.string().max(250, "That address looks too long."),
  }).nullable().default(null),
  listingUrl: z.string().max(500).default(""),
  /** Extraction runs already started from page-1 uploads (one per page). */
  planRunIds: z.array(z.string().uuid()).max(40).default([]),
  /** Elevation/facade photo runs — stored for the envelope pipeline (E2). */
  facadeRunIds: z.array(z.string().uuid()).max(12).default([]),
  /** R5: the customer's OWN condition photos, kept without a plan run
   * (/api/extract/photos). They are already stored; these ids let submit
   * claim them for the estimate, so they show on the editor and cascade with
   * it on delete. Before this they were written with estimate_id = null and
   * nothing ever set it. */
  conditionSourceIds: z.array(z.string().uuid()).max(12).default([]),
  noPlan: z.boolean().default(false),

  /**
   * The QUICK LOOK's eight answers (estimator journey v2 §3, phase 2).
   *
   * They live on the state, not in the component, for one reason: **autosave
   * and resume only know about the state.** Held in React alone, a reload lost
   * all eight and dropped the customer back on screen 1 with nothing — and the
   * drop-out funnel had nothing to chase either, because the draft it stored
   * carried the DERIVED state without any record of what was actually tapped.
   *
   * Optional, so every stored state written before this still parses; absent
   * means the walk came through the old pages, the describe route or upload.
   */
  quickLook: z.object({
    jobType: z.enum(["interior", "exterior", "both"]),
    propertyKind: z.enum(["house", "townhouse", "unit_apartment", "commercial"]),
    bedrooms: z.number().int().min(1).max(8),
    storeys: z.enum(["single", "double"]),
    scope: z.enum(["whole", "some_rooms", "walls_ceilings", "trims_doors"]),
    colour: z.enum(["same", "new", "bold"]),
    /**
     * C9 (v2.3) — "What's changing colour?": the three tiles, the bold
     * question and "still choosing". `colour` above is now DERIVED from these
     * (lib/wizard/quick-look.ts `colourFromChanges`) and kept for everything
     * that already reads it. Defaults keep every stored snapshot parsing.
     */
    changing: z.object({ walls: z.boolean(), ceilings: z.boolean(), trims: z.boolean() }).default({ walls: true, ceilings: false, trims: false }),
    bold: z.boolean().default(false),
    undecided: z.boolean().default(false),
    condition: z.enum(["good", "wear", "needs_work"]),
    occupied: z.enum(["yes", "no"]),
  }).nullable().default(null),
  basics: basicsSchema.nullable().default(null),
  /**
   * C12 — the COMMERCIAL answers (addendum S6a): what the segment's two
   * screens asked, as tapped. Everything the segment's configuration
   * renders is keyed by the row's own strings — count keys, also-area labels,
   * surface labels, hours and occupied values — so this stores strings and
   * the table gives them meaning. Null on every residential job.
   */
  commercial: z.object({
    segment: z.string().max(40),
    /** health: aged / clinic / hospital. Null where the row asks no kind. */
    kind: z.string().max(40).nullable().default(null),
    counts: z.record(z.string().max(40), z.number().int().min(0).max(500)).default({}),
    openSize: z.enum(["50", "150", "400", "800"]).default("150"),
    /** Height mode only (halls): the wall-height bracket. */
    openHeight: z.enum(["4", "6", "9"]).nullable().default(null),
    ceiling: z.enum(["tiles", "plaster", "exposed"]).default("tiles"),
    also: z.array(z.string().max(60)).max(20).default([]),
    surfaces: z.array(z.string().max(60)).max(20).default([]),
    hours: z.string().max(30).default(""),
    occ: z.string().max(30).nullable().default(null),
  }).nullable().default(null),

  surfaces: z.array(surfaceKeySchema).min(1),

  condition: z.object({
    /**
     * COLOUR INTENT, despite the field's name (estimator journey v2 §4.2).
     * fresh = the same colours again · change = new colours · dark_to_light =
     * going much lighter or bold. It used to set one coat count for the whole
     * job (1 / 2 / 3); coats are now derived PER SURFACE GROUP from this plus
     * the condition band — lib/pricing/systems.ts. The stored values are
     * unchanged so every snapshot, seed and replay fixture still parses;
     * `colourIntentFromTier` maps them across.
     */
    tier: z.enum(["fresh", "change", "dark_to_light"]),
    /** W1 rule: the dark-to-light follow-up is limited to ticked surfaces. */
    darkToLightSurfaces: z.array(surfaceKeySchema).default([]),
    /**
     * CEILINGS, which are not like the other surfaces on that list.
     *
     * ⚑ Tom, 11 Sep: *"it isn't typical for a ceiling to go from dark to light —
     * so maybe it could be added to the dark to light as ceilings some rooms, or
     * all ceilings; if it's some rooms, then it adds an option to choose the
     * rooms in the room builder."*
     *
     * Every other surface on the list is answered once for the whole job,
     * because we cannot know WHICH walls or WHICH doors (that is why "some
     * walls" is a note for the estimator and not a quantity). Ceilings are the
     * exception: the rooms are already on the screen, so "some" can be an actual
     * list and earn an actual price instead of a flag.
     *
     * `null` — the usual answer, and the default: no ceiling is going dark to
     * light, so they follow ⚑3's white-over-white rule as before.
     */
    darkToLightCeilings: z.enum(["all", "some"]).nullable().default(null),
    /**
     * The rooms whose ceilings are, when the answer is "some" — area ids.
     *
     * "some" with an EMPTY list prices every ceiling at the standard. Nobody has
     * named a room yet, so no ceiling has earned a third coat, and the card says
     * exactly that rather than guessing in either direction.
     */
    darkToLightCeilingRooms: z.array(z.number().int()).default([]),
    /**
     * ⚑3 (Tom, 9 Sep): ceilings are one coat of white over white by default;
     * "they're marked" is the two-coat tap. Asked on the paint-systems screen,
     * so both default false — an old snapshot reads as a sound white ceiling,
     * which is what the one-coat default always meant.
     */
    ceilingsMarked: z.boolean().default(false),
    /** The ceilings are getting a NEW colour rather than white again. Kept
     * apart from `tier` because white-on-white is not a colour change, and
     * that distinction is what lets ⚑3's single coat past the coverage rule. */
    ceilingsChangingColour: z.boolean().default(false),
    /**
     * Per-surface condition flags (Tom, 9 Sep: "what if the doors need 3
     * coats because they're all stained, but the rest are 2?").
     *
     * `{ doors: ["stained"], walls: ["new_plaster"] }` — the customer says
     * what is THERE, per surface group, and the engine derives the coats
     * (lib/pricing/systems.ts). Deliberately not a coat count per group: the
     * customer never picks coats, a picked "1" over a colour change is a
     * warranty claim, and a number tells the painter nothing that "they're
     * stained" doesn't tell them better.
     *
     * Keys are validated against the Settings catalogue at derivation time,
     * not here — Tom can add a flag without a migration, and a key that no
     * longer exists simply stops applying.
     */
    surfaceFlags: z.record(z.string().max(40), z.array(z.string().max(40)).max(8)).default({}),
    /**
     * C9 — the per-group colour answers the derivation reads
     * (lib/wizard/systems-view.ts `systemAnswersFromState`). `colourAnswered`
     * is the switch: false on every estimate made before the question
     * existed, so those keep the job-wide `tier` derivation exactly as it was.
     */
    colourAnswered: z.boolean().default(false),
    changingGroups: z.object({ walls: z.boolean(), ceilings: z.boolean(), trims: z.boolean() }).default({ walls: false, ceilings: false, trims: false }),
    boldColour: z.boolean().default(false),
    coloursUndecided: z.boolean().default(false),
  }),

  details: z.object({
    /** "Mostly" answers. unsure = nothing generated (Tom's rule, scope.ts).
     * na (1 Sep): auto-set when the surface wasn't ticked on page 2 — the
     * question answers itself "Not applicable". Prices like unsure if the
     * surface is later added. */
    doorStyle: z.enum(["panel", "flat", "unsure", "na"]),
    /** What comes with each door — leaf only, leaf + frame, or leaf + frame
     * + architrave (lib/extract/scope.DoorScope). Defaulted, not required:
     * every estimate written before 21 Aug 2026 means "frame", which is what
     * the old code always generated. */
    doorScope: z.enum(["door", "frame", "architrave"]).default("frame"),
    windowStyle: z.enum(["casement", "sash", "colonial", "winder", "unsure", "na"]),
    ceilingHeight: z.enum(["2.4", "2.7", "3.0", "unsure"]),
    /** 0 none · 1 minor · 2 a few areas of concern · 3 desperate need. */
    damageTier: z.number().int().min(0).max(3),
    damageNote: z.string().max(2000).default(""),
    /** Photos went to the extraction photos route; only the count rides here. */
    damagePhotoCount: z.number().int().min(0).max(24).default(0),
    /** Tom, 7 Sep 2026: a lived-in home is priced with daily set-up and
     * pack-down (the Staging modifier). Interior jobs; optional so every
     * stored state still parses. */
    occupied: z.enum(["yes", "no"]).optional(),
    /**
     * Site and access (plan §4.4) — the things that set our setup time, and
     * which the flow never asked at all (§2.4): furniture, floors, stairwells
     * and voids, parking, the lift booking in a unit, and pets.
     *
     * Every field optional: an unanswered screen costs nothing and flags
     * nothing. Pricing is by MODIFIER (lib/wizard/site-access.ts) so the
     * numbers stay Tom's in Settings → Pricing → Modifiers, and none of them
     * are written here or in that module.
     */
    /** §4.5 — the "anything we haven't listed" sentence. Recorded and flagged,
     *  never priced; the amber note is raised by the route. */
    extraNote: z.string().max(400).default(""),
    siteAccess: z.object({
      cleared: z.enum(["yes", "some", "no"]).optional(),
      floors: z.enum(["carpet", "hard", "mixed"]).optional(),
      stairwell: z.enum(["yes", "no"]).optional(),
      parking: z.enum(["drive", "street", "hard"]).optional(),
      lift: z.enum(["yes", "no"]).optional(),
      pets: z.enum(["yes", "no"]).optional(),
    }).default({}),
  }),

  /**
   * The STAFF path's contact details (Tom, 29 Aug: "always ask for name, phone
   * and email").
   *
   * The gap this closes: the internal wizard captured no way to reach anyone,
   * so 15 of 25 live estimates were addresses with prices and no person —
   * unreachable by the CRM, uncampaignable, and unlinkable to an account.
   * Customer mode keeps using `customer`, which already has an email.
   */
  contact: z.object({
    name: z.string().trim().max(120).default(""),
    email: z.string().trim().max(160).default(""),
    phone: z.string().trim().max(40).default(""),
  }).default({ name: "", email: "", phone: "" }),

  paint: z.object({
    /** 1 Sep: Porters + Wattyl added, and "unsure" is its own tile (kept as a
     * member of the same array so every stored snapshot still parses). */
    brands: z.array(z.enum(["dulux", "haymes", "taubmans", "porters", "wattyl", "unsure"])).default([]),
    /** After a brand is picked: do they know the colours, or want advice?
     * null = not answered (the follow-up hasn't been shown / touched).
     * advice → flagged in the CRM for a colour-advice follow-up (1 Sep). */
    colourHelp: z.enum(["known", "advice"]).nullable().default(null),
    waterBasedOnly: z.boolean().default(false),
    /** Follow-up only when waterBasedOnly is ticked. */
    trimsOilBased: z.enum(["yes", "no", "unsure"]).nullable().default(null),
    /** 1 Sep: "water based or oil based?" — the UI keeps waterBasedOnly in
     * step (water → true) so the merge deferrals stay exactly as built. */
    base: z.enum(["water", "oil", "unsure"]).nullable().default(null),
  }),

  /**
   * R2: the exterior question set (recovery plan §2 / one-page instruction).
   * Only meaningful when jobType includes exterior; null on interior jobs.
   * There is deliberately NO "how far around" — side selection in the
   * confirm-loop editor replaces extent (rebuild addendum §0).
   */
  exterior: z.object({
    storeys: z.enum(["single", "double"]).default("single"),
    /** Phase 3 (6 Sep plan): the footprint band scales the typical side
     * lengths (12 m / 14 m) the no-photo path starts from. Optional. */
    sizeBand: z.enum(["lt120", "s120_200", "gt200", "unsure"]).optional(),
    /** "What's the building made of?" — multi; a mix = several ticked. SEEDS
     * the editor's wall tiles (only these substrates render per side).
     * `concrete` (tilt slab / precast panel) prices as a clone of render —
     * see lib/estimate/substrates.ts and migration 20261204. */
    // C8b: no floor — nothing is pre-ticked on the exterior quick look, and an
    // empty list means "not told" (a placeholder wall, flagged), never weatherboard.
    substrates: z.array(z.enum(["weatherboards", "render", "concrete", "brick", "stucco", "cement_sheet", "colorbond", "other", "none"])).default(["weatherboards"]),
    /** Tom, 7 Sep: "What are we painting? tick all that apply" — the house,
     * and/or the freestanding things. Absent (older states) = the house. */
    targets: z.array(z.enum(["house", "fence", "floor", "deck", "shed", "wall"])).default(["house"]),
    /** Tom, 7 Sep: the house's trims, one tick each (windows / doors / eaves /
     * fascias / gutters / garage door). Absent (older states) = derived from
     * `painting` below, which stays the summary the scaffold reads. */
    elements: z.object({
      windows: z.boolean().default(true), doors: z.boolean().default(true),
      eaves: z.boolean().default(true), fascias: z.boolean().default(true), gutters: z.boolean().default(true),
      garage: z.boolean().default(false),
    }).optional(),
    /** Tom, 7 Sep: "Where are we painting?" — the sides being painted; absent
     * or all four = the full exterior. Unlisted sides arrive in the confirm
     * loop already answered "not painting". */
    sides: z.array(z.enum(["front", "left", "right", "back"])).optional(),
    /** C8b: window type (the rate row) and whole-job counts from the exterior
     * quick look; null = not asked (older sessions, the page set). The sides
     * seed spreads the counts; the sides editor reconciles them (⚑50). */
    windowType: z.enum(["casement", "sash", "colonial", "winder", "alu", "unsure"]).nullable().optional(),
    windowCount: z.number().int().min(0).max(200).nullable().optional(),
    doorCount: z.number().int().min(0).max(60).nullable().optional(),
    /** C8b: the exterior colour answer, the same three-way shape as the interior (⚑51). */
    colour: z.enum(["same", "new", "bold"]).optional(),
    /** A garage / workshop / shed being painted, and what it's made of. */
    shed: z.object({ substrate: z.enum(["weatherboards", "render", "concrete", "brick", "stucco", "cement_sheet", "colorbond", "other"]).default("colorbond") }).nullable().default(null),
    /** A freestanding wall (boundary / retaining) — material and rough length. */
    wall: z.object({
      substrate: z.enum(["brick", "render", "colorbond", "cement_sheet"]).default("brick"),
      metres: z.number().min(1).max(500).nullable().default(null),
    }).nullable().default(null),
    /** Floor coatings — rough area; priced by the estimator (no rate row). */
    floor: z.object({ m2: z.number().min(1).max(2000).nullable().default(null) }).nullable().default(null),
    /** What are we painting — roofline pre-ticked per the standard scope. */
    painting: z.object({
      body: z.boolean().default(true),
      windowsDoors: z.boolean().default(true),
      roofline: z.boolean().default(true),
      garage: z.boolean().default(false),
    }).default({ body: true, windowsDoors: true, roofline: true, garage: false }),
    /** peeling + pre-1970 = the lead hard stop (policy.ts). */
    condition: z.enum(["good", "weathered", "peeling"]).nullable().default(null),
    access: z.array(z.enum(["steep", "tight", "high"])).default([]),
    /** Tom, 29 Aug: special access equipment the job will need. NOTHING for
     * hire, delivery or setup of this gear is priced in the wizard — the
     * screen says so as soon as one is ticked, the estimator confirms it, and
     * a ticked item makes the job non-straightforward (requires_site_check). */
    accessEquipment: z.array(z.enum(["scissor_lift", "boom_lift", "scaffold"])).default([]),
    /** Tom, 31 Aug: exterior FROM SCRATCH — no listing, no photos. The
     * elevations size from the answers (storeys + typical lengths, tagged
     * assumed) and the confirm loop settles them side by side. */
    noPhotos: z.boolean().default(false),
    extras: z.object({
      deck: z.boolean().default(false),
      fence: z.boolean().default(false),
      /** metres; null with fence=true = "not sure" → measured on the day. */
      fenceMetres: z.number().min(1).max(500).nullable().default(null),
      /** Tom, 5 Sep 2026: paling vs picket — a 10× labour difference on the card.
       * 7 Sep: metal — no rate row yet, so it is flagged for the estimator, never $0. */
      fenceType: z.enum(["paling", "picket_hand", "picket_spray", "metal"]).default("paling"),
      pergola: z.boolean().default(false),
      balustrade: z.boolean().default(false),
    }).default({ deck: false, fence: false, fenceMetres: null, fenceType: "paling", pergola: false, balustrade: false }),
  }).nullable().default(null),
});

export const wizardStateSchema = wizardStateShapeSchema.superRefine((s, ctx) => {
  const wantsInterior = s.jobType === "interior" || s.jobType === "both";
  const wantsExterior = s.jobType === "exterior" || s.jobType === "both";

  // C12: a commercial job's rooms come from the segment's counts and
  // typicals (state.commercial), so it needs no home basics.
  if (s.noPlan && !s.basics && !s.commercial) {
    ctx.addIssue({ code: "custom", path: ["basics"], message: "The quick basics are needed when there is no floorplan." });
  }
  if (wantsInterior && !s.noPlan && s.planRunIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["planRunIds"], message: "Upload a floorplan, or choose the quick basics instead." });
  }
  if (s.condition.tier === "dark_to_light") {
    /**
     * ⚑ A BOLD JOB MAY SUBMIT WITH NONE PICKED YET, and that rule change fixed
     * a bug I shipped in phase 2: this used to REFUSE an empty list, the quick
     * look never asks (it has four screens and this is not one of them), and so
     * a customer who chose "going much lighter, or a bold colour" could not get
     * a price at all — the submit 400'd and dropped them back on the job screen
     * with a question that had no answer on it.
     *
     * The list is asked in the EDITOR now (Tom, 10 Sep — the one job-wide coat
     * question that survived the systems card), and until they answer it every
     * surface is two coats. That is Tom's own default: "assume that everything
     * else is 2 coats".
     */
    for (const k of s.condition.darkToLightSurfaces) {
      if (!s.surfaces.includes(k)) {
        ctx.addIssue({ code: "custom", path: ["condition", "darkToLightSurfaces"], message: "Dark-to-light only applies to surfaces being painted." });
      }
    }
  }
  // R2: a pure-exterior job answers the exterior question set instead of the
  // interior pages — condition is required, and the facade photos already
  // required on page 1 are its visual evidence (the interior damage-photo
  // rule below does not apply).
  if (s.jobType === "exterior") {
    if (!s.exterior) {
      ctx.addIssue({ code: "custom", path: ["exterior"], message: "The exterior questions first, please." });
    } else if (s.exterior.condition == null) {
      ctx.addIssue({ code: "custom", path: ["exterior", "condition"], message: "How's the paintwork holding up?" });
    } else if (s.exterior.targets.length === 0) {
      ctx.addIssue({ code: "custom", path: ["exterior", "targets"], message: "What are we painting? Tick at least one." });
    }
  }
  // Damage tiers 2–3 need evidence: photos, or (internal mode only) a written
  // note so the estimator can price the prep honestly. Customer mode (Step 8)
  // is photos only, per the brief — a note from a customer cannot be priced.
  if (s.jobType !== "exterior" && s.details.damageTier >= 2 && s.details.damagePhotoCount === 0) {
    if (s.mode === "customer") {
      ctx.addIssue({ code: "custom", path: ["details", "damageTier"], message: "Damage at this level needs photos — a quick phone shot of each area is perfect." });
    } else if (s.details.damageNote.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["details", "damageTier"], message: "Damage at this level needs photos, or a short description." });
    }
  }
  // Exterior without a listing URL wants 2–3 facade photos before quoting
  // (business inputs §3) — UNLESS the customer explicitly chose the
  // from-scratch path (Tom, 31 Aug: exterior.noPhotos sizes the elevations
  // from the answers; every exterior is estimator-signed-off anyway). Only a
  // REAL listing link or that explicit choice waives the photos — free text
  // ("don't have one") must not.
  const listingOk = isAllowedListingUrl(s.listingUrl);
  if (s.listingUrl.trim() !== "" && !listingOk) {
    ctx.addIssue({ code: "custom", path: ["listingUrl"], message: "That doesn't look like a realestate.com.au or domain.com.au link — paste the listing address, or add facade photos instead." });
  }
  if (wantsExterior && !listingOk && s.facadeRunIds.length < 2 && s.exterior?.noPhotos !== true) {
    ctx.addIssue({ code: "custom", path: ["facadeRunIds"], message: "Exterior needs the listing or two to three facade photos — or choose “No photos to hand” and we'll size it from your answers." });
  }
  if (s.paint.waterBasedOnly && s.paint.trimsOilBased == null) {
    ctx.addIssue({ code: "custom", path: ["paint", "trimsOilBased"], message: "Are the trims currently oil-based enamel?" });
  }
  /**
   * Customer mode demands the property answers — the guardrails run on them,
   * and a hazard question nobody answered must not read as "no".
   *
   * ⚑ THE EMAIL GATE IS GONE (estimator journey v2 ⚑1, phase 2). This rule
   * used to read "and the email gate before anything is revealed", and it was
   * the single biggest thing standing between a visitor and a number: §2.6
   * calls it "reasonable for retargeting; costly for conversion", and Tom's
   * ruling was "after, with a soft 'email me a copy' bar under the range".
   *
   * So a state can now be PRICED without an email. What still needs one is
   * KEEPING it — the reveal screen's "Keep this estimate" door, which is the
   * email capture wearing its honest purpose. Nothing downstream assumed a
   * non-empty address: the submit route already falls back to the contact
   * block and then to "", and the contact upsert only fires when a name or an
   * email is actually there.
   */
  if (s.mode === "customer" && !s.customer) {
    ctx.addIssue({ code: "custom", path: ["customer"], message: "A few details about the property first, please." });
  }
});

/** Clamp a structured address to the schema's caps. Every producer that
 * SEEDS the wizard from stored or third-party data (property prefill,
 * Places details) runs through this — a stored oddity must never make the
 * wizard unsubmittable (the East-Riding-of-Yorkshire lesson, 28 Aug). */
export function clampAddress<T extends {
  street: string; suburb: string; state: string; postcode: string; formatted: string;
}>(a: T): T {
  return {
    ...a,
    street: a.street.trim().slice(0, 120),
    suburb: a.suburb.trim().slice(0, 80),
    state: a.state.trim().slice(0, 10),
    postcode: a.postcode.trim().slice(0, 10),
    formatted: a.formatted.trim().slice(0, 250),
  };
}

export type WizardState = z.infer<typeof wizardStateSchema>;
export type WizardBasics = z.infer<typeof basicsSchema>;

export type WizardCustomer = z.infer<typeof customerSchema>;

export function defaultCustomer(): WizardCustomer {
  return {
    email: "", suburb: "", postcode: "",
    propertyKind: "house", commercialGates: {}, heritageListed: "unsure", bodyCorporate: "no",
    builtPre1970: "unsure", asbestosSuspected: "no",
  };
}

export function defaultWizardState(): WizardState {
  return {
    mode: "internal",
    customer: null,
    jobType: "interior",
    title: "",
    address: null,
    listingUrl: "",
    planRunIds: [],
    facadeRunIds: [],
    conditionSourceIds: [],
    noPlan: false,
    basics: null,
    commercial: null,
    quickLook: null,
    surfaces: [...DEFAULT_SURFACES],
    condition: { tier: "change", darkToLightSurfaces: [], ceilingsMarked: false, ceilingsChangingColour: false, darkToLightCeilings: null, darkToLightCeilingRooms: [], surfaceFlags: {}, colourAnswered: false, changingGroups: { walls: false, ceilings: false, trims: false }, boldColour: false, coloursUndecided: false },
    details: {
      doorStyle: "unsure",
      doorScope: "frame",
      windowStyle: "unsure",
      ceilingHeight: "unsure",
      damageTier: 1,
      damageNote: "",
      damagePhotoCount: 0, siteAccess: {}, extraNote: "",
    },
    contact: { name: "", email: "", phone: "" },
    paint: { brands: [], colourHelp: null, waterBasedOnly: false, trimsOilBased: null, base: null },
    exterior: null,
  };
}

export type WizardExterior = NonNullable<WizardState["exterior"]>;

export function defaultExterior(): WizardExterior {
  return {
    storeys: "single",
    substrates: ["weatherboards"],
    targets: ["house"],
    shed: null, wall: null, floor: null,
    painting: { body: true, windowsDoors: true, roofline: true, garage: false },
    condition: null,
    access: [],
    accessEquipment: [],
    noPhotos: false,
    extras: { deck: false, fence: false, fenceMetres: null, fenceType: "paling", pergola: false, balustrade: false },
  };
}

/**
 * R2: the exterior answers expressed as page-2 surface keys — the ONE
 * mapping the wizard pages, the merge and the starter scaffold all share.
 * (state.surfaces stays the single source the tick-filter reads.)
 */
export function exteriorSurfaceKeys(ext: WizardExterior): WizardSurfaceKey[] {
  const keys: WizardSurfaceKey[] = [];
  const house = ext.targets.includes("house");
  // "other" and "none" are answers, not substrates: "other" scaffolds a
  // placeholder wall the estimator swaps; "none" means no wall painting.
  const cladding = ext.substrates.filter((s): s is Exclude<typeof s, "other" | "none"> => s !== "other" && s !== "none");
  if (house && ext.painting.body) keys.push(...cladding);
  const el = exteriorElements(ext);
  if (house && el.windows) keys.push("exterior_windows");
  if (house && el.doors) keys.push("exterior_doors");
  if (house && el.fascias) keys.push("fascias");
  if (house && el.gutters) keys.push("gutters", "downpipes");
  if (house && el.eaves) keys.push("eaves");
  if (house && el.garage) keys.push("garage_doors");
  if (ext.extras.deck || ext.targets.includes("deck")) keys.push("deck");
  if ((ext.extras.fence || ext.targets.includes("fence")) && ext.extras.fenceType !== "metal") keys.push("fence");
  if (ext.extras.pergola) keys.push("pergola");
  if (ext.extras.balustrade) keys.push("balustrade");
  return [...new Set(keys)];
}

/** The house's trims, one flag each — from `elements` when the new page
 * answered them, else derived from the older `painting` summary. */
export function exteriorElements(ext: WizardExterior): NonNullable<WizardExterior["elements"]> {
  if (ext.elements) return ext.elements;
  return {
    windows: ext.painting.windowsDoors, doors: ext.painting.windowsDoors,
    eaves: ext.painting.roofline, fascias: ext.painting.roofline, gutters: ext.painting.roofline,
    garage: ext.painting.garage,
  };
}

/** Which sides are being painted — absent = all four (the full exterior). */
export function exteriorSides(ext: WizardExterior): Array<"front" | "left" | "right" | "back"> {
  return ext.sides && ext.sides.length > 0 ? ext.sides : ["front", "left", "right", "back"];
}

/** Coats for the condition tier; dark-to-light surfaces get 3, the rest 2. */
export function coatsFor(tier: WizardState["condition"]["tier"], isDarkToLight: boolean): number {
  if (tier === "fresh") return 1;
  if (tier === "dark_to_light") return isDarkToLight ? 3 : 2;
  return 2;
}

/**
 * The height the wizard answer states, and whether it is an assumption.
 * "unsure" assumes 2.4 m and leaves the editor's confirm chip to settle it —
 * production always confirms height (Step 6 finding: height, not plan
 * reading, is the walls error).
 */
export function ceilingHeightFrom(choice: WizardState["details"]["ceilingHeight"]): { heightM: number; assumed: boolean } {
  if (choice === "2.4") return { heightM: 2.4, assumed: false };
  if (choice === "2.7") return { heightM: 2.7, assumed: false };
  if (choice === "3.0") return { heightM: 3.0, assumed: false };
  return { heightM: 2.4, assumed: true };
}

/**
 * The label a line carries when the customer named the style (Tom, 21 Aug:
 * "I choose winder window, and it gave me awning casement window in the
 * builder").
 *
 * Four of the five answers have their own rate row, so their label is just
 * the row. A WINDER does not: it is a crank-operated awning/casement and
 * prices at that rate. Labelling it "Awning / Casement Window" answered a
 * question nobody asked — so the line now says what the customer said, and
 * names the rate family it rides in the same breath.
 */
export function windowStyleLabel(style: WizardState["details"]["windowStyle"]): string {
  switch (style) {
    case "casement": return "Awning / casement window";
    case "sash": return "Double hung sash window";
    case "colonial": return "Colonial / bay window";
    case "winder": return "Winder window (awning/casement rate)";
    // na exists for the unticked-surface auto-answer; if a window line is
    // somehow generated anyway, "to confirm" stays the honest label.
    default: return "Windows — style to confirm";
  }
}

/** Wizard window answers to the extraction schema's window styles. */
export function windowStyleToSchema(style: WizardState["details"]["windowStyle"]): string {
  switch (style) {
    case "casement": return "awning_casement";
    case "sash": return "double_hung_sash";
    case "colonial": return "colonial_bay";
    // A winder is a crank-operated awning/casement — same rate family.
    case "winder": return "awning_casement";
    default: return "unknown";
  }
}

/** Real-estate hosts whose links count as exterior evidence. Mirrors the
 * server-side fetch allowlist in lib/extract/listing.ts (which is server-only
 * and cannot be imported here) — keep the two in sync. */
const LISTING_HOSTS = ["realestate.com.au", "domain.com.au", "allhomes.com.au", "onthehouse.com.au"];

export function isAllowedListingUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.toLowerCase();
    return LISTING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Which page (1–6) a field error belongs to, for sending the user back.
 * The submit route validates { state: wizardStateSchema }, so issue paths
 * arrive prefixed with "state" — strip it before matching. */
export function pageForPath(path: Array<string | number>): number {
  const parts = String(path[0] ?? "") === "state" ? path.slice(1) : path;
  const head = String(parts[0] ?? "");
  if (["jobType", "title", "address", "listingUrl", "planRunIds", "facadeRunIds", "noPlan", "basics"].includes(head)) return 1;
  if (head === "surfaces") return 2;
  if (head === "condition") return 3;
  if (head === "details") return 4;
  if (head === "customer") return 6;
  return 5;
}

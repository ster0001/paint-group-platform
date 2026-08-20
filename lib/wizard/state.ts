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
});

/** Step 8: the customer's property answers — the guardrails' raw material. */
const customerSchema = z.object({
  email: z.string().email().max(200).or(z.literal("")).default(""),
  suburb: z.string().max(80).default(""),
  postcode: z.string().max(10).default(""),
  propertyKind: z.enum(["house", "townhouse", "unit_apartment", "commercial"]),
  heritageListed: z.enum(["yes", "no", "unsure"]),
  bodyCorporate: z.enum(["yes", "no", "unsure"]),
  builtPre1970: z.enum(["yes", "no", "unsure"]),
  asbestosSuspected: z.enum(["yes", "no", "unsure"]),
});

export const wizardStateSchema = z.object({
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
    street: z.string().max(120),
    suburb: z.string().max(80),
    state: z.string().max(10),
    postcode: z.string().max(10),
    formatted: z.string().max(250),
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
  basics: basicsSchema.nullable().default(null),

  surfaces: z.array(surfaceKeySchema).min(1),

  condition: z.object({
    /** Sets coats: freshen up = 1, change of colour = 2, dark to light = 3. */
    tier: z.enum(["fresh", "change", "dark_to_light"]),
    /** W1 rule: the dark-to-light follow-up is limited to ticked surfaces. */
    darkToLightSurfaces: z.array(surfaceKeySchema).default([]),
  }),

  details: z.object({
    /** "Mostly" answers. unsure = nothing generated (Tom's rule, scope.ts). */
    doorStyle: z.enum(["panel", "flat", "unsure"]),
    /** What comes with each door — leaf only, leaf + frame, or leaf + frame
     * + architrave (lib/extract/scope.DoorScope). Defaulted, not required:
     * every estimate written before 21 Aug 2026 means "frame", which is what
     * the old code always generated. */
    doorScope: z.enum(["door", "frame", "architrave"]).default("frame"),
    windowStyle: z.enum(["casement", "sash", "colonial", "winder", "unsure"]),
    ceilingHeight: z.enum(["2.4", "2.7", "3.0", "unsure"]),
    /** 0 none · 1 minor · 2 a few areas of concern · 3 desperate need. */
    damageTier: z.number().int().min(0).max(3),
    damageNote: z.string().max(2000).default(""),
    /** Photos went to the extraction photos route; only the count rides here. */
    damagePhotoCount: z.number().int().min(0).max(24).default(0),
  }),

  paint: z.object({
    brands: z.array(z.enum(["dulux", "haymes", "taubmans"])).default([]),
    /** After a brand is picked: do they know the colours, or want advice?
     * null = not answered (the follow-up hasn't been shown / touched). */
    colourHelp: z.enum(["known", "advice"]).nullable().default(null),
    waterBasedOnly: z.boolean().default(false),
    /** Follow-up only when waterBasedOnly is ticked. */
    trimsOilBased: z.enum(["yes", "no", "unsure"]).nullable().default(null),
  }),

  /**
   * R2: the exterior question set (recovery plan §2 / one-page instruction).
   * Only meaningful when jobType includes exterior; null on interior jobs.
   * There is deliberately NO "how far around" — side selection in the
   * confirm-loop editor replaces extent (rebuild addendum §0).
   */
  exterior: z.object({
    storeys: z.enum(["single", "double"]).default("single"),
    /** "What's the house made of?" — multi; a mix = several ticked. SEEDS
     * the editor's wall tiles (only these substrates render per side). */
    substrates: z.array(z.enum(["weatherboards", "render", "brick"])).min(1).default(["weatherboards"]),
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
    extras: z.object({
      deck: z.boolean().default(false),
      fence: z.boolean().default(false),
      /** metres; null with fence=true = "not sure" → measured on the day. */
      fenceMetres: z.number().min(1).max(500).nullable().default(null),
      pergola: z.boolean().default(false),
      balustrade: z.boolean().default(false),
    }).default({ deck: false, fence: false, fenceMetres: null, pergola: false, balustrade: false }),
  }).nullable().default(null),
}).superRefine((s, ctx) => {
  const wantsInterior = s.jobType === "interior" || s.jobType === "both";
  const wantsExterior = s.jobType === "exterior" || s.jobType === "both";

  if (s.noPlan && !s.basics) {
    ctx.addIssue({ code: "custom", path: ["basics"], message: "The quick basics are needed when there is no floorplan." });
  }
  if (wantsInterior && !s.noPlan && s.planRunIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["planRunIds"], message: "Upload a floorplan, or choose the quick basics instead." });
  }
  if (s.condition.tier === "dark_to_light") {
    if (s.condition.darkToLightSurfaces.length === 0) {
      ctx.addIssue({ code: "custom", path: ["condition", "darkToLightSurfaces"], message: "Which surfaces are going dark to light?" });
    }
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
  // Exterior without a listing URL requires 2–3 facade photos before quoting
  // (locked decision; business inputs §3). Only a REAL listing link waives the
  // photos — free text ("don't have one") must not.
  const listingOk = isAllowedListingUrl(s.listingUrl);
  if (s.listingUrl.trim() !== "" && !listingOk) {
    ctx.addIssue({ code: "custom", path: ["listingUrl"], message: "That doesn't look like a realestate.com.au or domain.com.au link — paste the listing address, or add facade photos instead." });
  }
  if (wantsExterior && !listingOk && s.facadeRunIds.length < 2) {
    ctx.addIssue({ code: "custom", path: ["facadeRunIds"], message: "Exterior needs the listing, or two to three facade photos — front and each visible side." });
  }
  if (s.paint.waterBasedOnly && s.paint.trimsOilBased == null) {
    ctx.addIssue({ code: "custom", path: ["paint", "trimsOilBased"], message: "Are the trims currently oil-based enamel?" });
  }
  // Step 8: customer mode demands the property answers (the guardrails run on
  // them) and the email gate before anything is revealed.
  if (s.mode === "customer") {
    if (!s.customer) {
      ctx.addIssue({ code: "custom", path: ["customer"], message: "A few details about the property first, please." });
    } else if (s.customer.email.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["customer", "email"], message: "Where should the estimate go?" });
    }
  }
});

export type WizardState = z.infer<typeof wizardStateSchema>;
export type WizardBasics = z.infer<typeof basicsSchema>;

export type WizardCustomer = z.infer<typeof customerSchema>;

export function defaultCustomer(): WizardCustomer {
  return {
    email: "", suburb: "", postcode: "",
    propertyKind: "house", heritageListed: "unsure", bodyCorporate: "no",
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
    surfaces: [...DEFAULT_SURFACES],
    condition: { tier: "change", darkToLightSurfaces: [] },
    details: {
      doorStyle: "unsure",
      doorScope: "frame",
      windowStyle: "unsure",
      ceilingHeight: "unsure",
      damageTier: 1,
      damageNote: "",
      damagePhotoCount: 0,
    },
    paint: { brands: [], colourHelp: null, waterBasedOnly: false, trimsOilBased: null },
    exterior: null,
  };
}

export type WizardExterior = NonNullable<WizardState["exterior"]>;

export function defaultExterior(): WizardExterior {
  return {
    storeys: "single",
    substrates: ["weatherboards"],
    painting: { body: true, windowsDoors: true, roofline: true, garage: false },
    condition: null,
    access: [],
    extras: { deck: false, fence: false, fenceMetres: null, pergola: false, balustrade: false },
  };
}

/**
 * R2: the exterior answers expressed as page-2 surface keys — the ONE
 * mapping the wizard pages, the merge and the starter scaffold all share.
 * (state.surfaces stays the single source the tick-filter reads.)
 */
export function exteriorSurfaceKeys(ext: WizardExterior): WizardSurfaceKey[] {
  const keys: WizardSurfaceKey[] = [];
  if (ext.painting.body) keys.push(...ext.substrates);
  if (ext.painting.windowsDoors) keys.push("exterior_windows", "exterior_doors");
  if (ext.painting.roofline) keys.push("fascias", "gutters", "eaves", "downpipes");
  if (ext.painting.garage) keys.push("garage_doors");
  if (ext.extras.deck) keys.push("deck");
  if (ext.extras.fence) keys.push("fence");
  if (ext.extras.pergola) keys.push("pergola");
  if (ext.extras.balustrade) keys.push("balustrade");
  return keys;
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

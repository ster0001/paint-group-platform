import { z } from "zod";

/**
 * W1: the wizard's state — ONE typed object, shared by the client pages and
 * the submit route, zod-validated server-side on submit (phase plan W1).
 *
 * Everything here is an ANSWER, never a price, an hour or a quantity: the
 * server rebuilds the draft tree from stored extraction runs + these answers,
 * so a client cannot post geometry or money of its own choosing — the same
 * boundary rule as the plan reader's apply route and capture's rooms route.
 */

/** Page-2 surface ticks. Keys, not labels — labels live with the UI. */
export const WIZARD_SURFACE_KEYS = [
  "walls", "ceilings", "cornices", "doors", "architraves", "skirting", "windows", "staircase",
] as const;
export type WizardSurfaceKey = (typeof WIZARD_SURFACE_KEYS)[number];

/** The usual full repaint, pre-ticked (mockup PRE set). */
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
  listingUrl: z.string().max(500).default(""),
  /** Extraction runs already started from page-1 uploads (one per page). */
  planRunIds: z.array(z.string().uuid()).max(40).default([]),
  /** Elevation/facade photo runs — stored for the envelope pipeline (E2). */
  facadeRunIds: z.array(z.string().uuid()).max(12).default([]),
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
    knowsColours: z.boolean().default(false),
    waterBasedOnly: z.boolean().default(false),
    /** Follow-up only when waterBasedOnly is ticked. */
    trimsOilBased: z.enum(["yes", "no", "unsure"]).nullable().default(null),
  }),
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
  // Damage tiers 2–3 need evidence: photos, or (internal mode) a written note
  // so the estimator can price the prep honestly. Customer mode (Step 8)
  // tightens this to photos only, per the brief.
  if (s.details.damageTier >= 2 && s.details.damagePhotoCount === 0 && s.details.damageNote.trim() === "") {
    ctx.addIssue({ code: "custom", path: ["details", "damageTier"], message: "Damage at this level needs photos, or a short description." });
  }
  // Exterior without a listing URL requires 2–3 facade photos before quoting
  // (locked decision; business inputs §3).
  if (wantsExterior && s.listingUrl.trim() === "" && s.facadeRunIds.length < 2) {
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
    listingUrl: "",
    planRunIds: [],
    facadeRunIds: [],
    noPlan: false,
    basics: null,
    surfaces: [...DEFAULT_SURFACES],
    condition: { tier: "change", darkToLightSurfaces: [] },
    details: {
      doorStyle: "unsure",
      windowStyle: "unsure",
      ceilingHeight: "unsure",
      damageTier: 1,
      damageNote: "",
      damagePhotoCount: 0,
    },
    paint: { brands: [], knowsColours: false, waterBasedOnly: false, trimsOilBased: null },
  };
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

/** Which page (1–5) a field error belongs to, for sending the user back. */
export function pageForPath(path: Array<string | number>): number {
  const head = String(path[0] ?? "");
  if (["jobType", "title", "listingUrl", "planRunIds", "facadeRunIds", "noPlan", "basics"].includes(head)) return 1;
  if (head === "surfaces") return 2;
  if (head === "condition") return 3;
  if (head === "details") return 4;
  return 5;
}

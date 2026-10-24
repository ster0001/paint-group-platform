import { JOB_TYPES, PROPERTY_KINDS, type Choice, type QuickLook } from "./quick-look";

/**
 * Paint Home brief §5 — the wizard's brand branch. ONE wizard, two doors
 * shut for Paint Home: no commercial property kind and no "both" (⚑ P6: two
 * estimates), and a PHONE-ONLY confirmation tier at the price step. Every
 * rule is a pure function here so the route test and the components read
 * the same thing; nothing in this file knows about React or Supabase.
 *
 * `brand` rides on the wizard STATE (lib/wizard/state.ts), set once from the
 * hand-off (`?brand=painthome`) or the Paint Home host, autosaved with the
 * draft and written to `wizard_drafts.brand` and `estimates.brand`; the
 * database carries it on to the work order and the invoice (migration
 * 20270300). Paint Group is the default everywhere and carries no tag.
 */
export const WIZARD_BRANDS = ["paintgroup", "painthome"] as const;
export type WizardBrand = (typeof WIZARD_BRANDS)[number];

export function isWizardBrand(v: unknown): v is WizardBrand {
  return v === "paintgroup" || v === "painthome";
}

/** The property kinds a brand offers: Paint Home is residential only — the commercial card is not rendered, not hidden. */
export function propertyKindsFor(brand: WizardBrand | null | undefined): Choice<QuickLook["propertyKind"]>[] {
  return brand === "painthome" ? PROPERTY_KINDS.filter((k) => k.value !== "commercial") : PROPERTY_KINDS;
}

/** The job types a brand offers: Paint Home has Inside and Outside, never Both (⚑ P6 — two separate estimates keep jobs small). */
export function jobTypesFor(brand: WizardBrand | null | undefined): Choice<QuickLook["jobType"]>[] {
  return brand === "painthome" ? JOB_TYPES.filter((j) => j.value !== "both") : JOB_TYPES;
}

/** A quick-look answer Paint Home never accepts, however it arrived (a seed, a resumed draft, a URL). */
export function allowedForBrand(brand: WizardBrand | null | undefined, patch: Partial<Pick<QuickLook, "propertyKind" | "jobType">>): Partial<Pick<QuickLook, "propertyKind" | "jobType">> {
  if (brand !== "painthome") return patch;
  const out = { ...patch };
  if (out.propertyKind === "commercial") out.propertyKind = "house";
  if (out.jobType === "both") out.jobType = "interior";
  return out;
}

/**
 * THE PHONE-CLOSE TIER (brief §5). Paint Home only takes jobs a person can
 * confirm on the phone: the top of the range at or under the phone-close
 * ceiling (Settings → wizard_policy.remoteConfirmCapCents, ⚑ P7 = Paint
 * Group's value), nothing the guardrails say must be seen, and nothing the
 * job itself needs a person on site for (`requires_site_check`). Anything
 * else is a VISIT — the polite hand-off to the Paint Group team, with every
 * answer kept.
 */
export type PaintHomeTier = { tier: "call" | "visit"; why: string | null };

const MUST_SEE = new Set(["over_self_serve_cap", "asbestos_unsure", "lead_paint_disturbance", "mixed_scope"]);

export function paintHomeTier(i: { hiCents: number | null | undefined; capCents: number; reasons: ReadonlyArray<string>; requiresSiteCheck: boolean }): PaintHomeTier {
  if (i.hiCents == null || !Number.isFinite(i.hiCents) || i.hiCents <= 0) return { tier: "visit", why: "no range" };
  if (i.hiCents > i.capCents) return { tier: "visit", why: "over the phone-close ceiling" };
  const seen = i.reasons.find((r) => MUST_SEE.has(r));
  if (seen) return { tier: "visit", why: seen };
  if (i.requiresSiteCheck) return { tier: "visit", why: "needs a person on site" };
  return { tier: "call", why: null };
}

/** Sarah's introduction on Paint Home (brief §5): plain, no company name. `null` when nobody is named. */
export function paintHomeEstimatorIntro(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${first}, who'll be checking your price.` : null;
}

/** The words of the price step on Paint Home — in one place, in the brand's register (brief §1a). */
export const PAINT_HOME_WORDS = {
  confirmDoor: { title: "Confirm my price. Book a call", body: "One short call to check the details. Your price is then set." },
  thenCall: "Your price is confirmed with you on one short call before it's fixed.",
  handoff: {
    kicker: "A bigger job",
    heading: "This one's bigger than we can price from your phone.",
    body: "We'll have someone come and look. Everything you've entered is kept, and nothing is asked twice.",
    team: "You'll hear from the Paint Group team, who look after our larger jobs.",
    button: "Book a site visit",
  },
} as const;

/**
 * THE visit-policy function (visit-booking brief §2 ruling 1): exactly one
 * of self_serve | phone_first | manual for an estimate + account + property,
 * and every surface calls it — the threshold CTA, the portal, the
 * assistant's visit_policy tool, the console. No surface rules on its own.
 *
 * Ruling 4 routes to phone_first: a lead flag, damage beyond minor,
 * tenanted / not authorised, commercial or multi-property, anything with an
 * amber custom line the office should read first. `manual` is a
 * staff-created visit. The four hard gates (service area, mobile OTP, price
 * acknowledged, authorised) are enforced by the booking module, not here.
 *
 * Zone map: RECORDED as open (V1) — one Melbourne-metro zone with AM/PM
 * windows is the placeholder the slot list uses.
 */

export type VisitTier = "self_serve" | "phone_first" | "manual";

export type VisitPolicyInput = {
  /** Who is asking: a customer self-serving, or staff creating a visit. */
  actor: "customer" | "staff";
  /** Guardrail reasons from evaluateGuardrails (lead_paint_disturbance, …). */
  guardrailReasons: string[];
  damageTier: number;
  propertyKind: "house" | "townhouse" | "unit_apartment" | "commercial" | null;
  bodyCorporate: "yes" | "no" | "unsure" | null;
  /** The booker is the decision-maker (null = not yet asked). */
  authorised: boolean | null;
  /** The account has more than one property on the books. */
  multiProperty: boolean;
  /** Amber items the office should read before anyone drives out. */
  customLines: number;
  requiresSiteCheck: boolean;
};

export type VisitPolicy = { tier: VisitTier; reasons: string[] };

export function visitPolicy(i: VisitPolicyInput): VisitPolicy {
  if (i.actor === "staff") return { tier: "manual", reasons: ["Staff-created visit."] };
  const reasons: string[] = [];
  if (i.guardrailReasons.some((r) => /lead_paint|asbestos/.test(r))) reasons.push("Older home with paint in poor condition — we check it in person first.");
  if (i.damageTier >= 2) reasons.push("Damage beyond minor — the prep needs to be seen before it's priced.");
  if (i.authorised === false) reasons.push("The booking needs the property's decision-maker.");
  if (i.bodyCorporate === "yes") reasons.push("Body corporate — we arrange access with you by phone.");
  if (i.propertyKind === "commercial") reasons.push("Commercial job — we scope these by phone first.");
  if (i.multiProperty) reasons.push("More than one property — we plan the visits together by phone.");
  if (i.customLines > 0) reasons.push(`${i.customLines} item${i.customLines === 1 ? "" : "s"} the office wants to read before the visit.`);
  if (reasons.length) return { tier: "phone_first", reasons };
  return { tier: "self_serve", reasons: [i.requiresSiteCheck ? "A short visit confirms the price — pick a time that suits." : "Book a time that suits."] };
}

/** The placeholder zone map (V1 open): one metro zone, AM / PM windows. */
export const PLACEHOLDER_ZONE = { key: "melbourne-metro", label: "Melbourne metro", windows: ["am", "pm"] as const };

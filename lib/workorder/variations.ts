/**
 * Variations — the two-sided flow, mirrored for the UI.
 *
 * The money here is computed by the database (`wo_price_variation` reads the
 * settings rate and multiplies), NOT by this module. `contractorDeltaCents`
 * exists so the office can SHOW what a figure will be before committing to it,
 * and so a test can pin the arithmetic. Nothing in the browser ever sends a
 * money value to the server.
 */

export const VARIATION_CATEGORIES = [
  { code: "rot", label: "Rot / substrate" },
  { code: "damage", label: "Damage" },
  { code: "extra_scope", label: "Extra scope" },
  { code: "customer_request", label: "Customer request" },
] as const;

export type VariationCategory = (typeof VARIATION_CATEGORIES)[number]["code"];

export const VARIATION_STATUSES = [
  "raised", "priced", "customer_approved", "contractor_accepted", "declined", "cancelled",
] as const;

export type VariationStatus = (typeof VARIATION_STATUSES)[number];

/** The mockup's five-step tracker: Raised → Priced → Customer → Contractor → Work. */
export const VARIATION_STEPS = ["Raised", "Priced", "Customer", "Contractor", "Work"] as const;

/**
 * Which step is lit. `declined` deliberately stops where it died rather than
 * showing as complete — a declined variation is kept and reported, not hidden.
 */
export function stepIndex(status: VariationStatus): number {
  switch (status) {
    case "raised": return 0;
    case "priced": return 1;
    case "customer_approved": return 2;
    case "contractor_accepted": return 4;
    case "declined":
    case "cancelled": return 1;
  }
}

export function isOpen(status: VariationStatus): boolean {
  return status === "raised" || status === "priced" || status === "customer_approved";
}

/** hours × the settings rate, in whole cents. Mirrors round(p_hours * v_rate). */
export function contractorDeltaCents(hours: number, rateCents: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (!Number.isInteger(rateCents) || rateCents < 0) return 0;
  return Math.round(hours * rateCents);
}

/** What blocks the job right now, in the words the console shows. */
export function blockedReason(open: { status: VariationStatus }[]): string | null {
  if (open.length === 0) return null;
  const waiting = open.filter((v) => isOpen(v.status));
  if (waiting.length === 0) return null;
  const n = waiting.length;
  return `${n} variation${n === 1 ? "" : "s"} still waiting on a decision`;
}

/** What one delivery attempt reported — the shape both send actions return. */
export type SendChannelOutcome = { status: string; message?: string };

/**
 * The office's one-line read of a customer send (signing link, confirmation),
 * in words a screen can show. Anything short of "sent" is said in full —
 * "not configured", the customer's own alert settings, the provider's error —
 * never "check the contact" when the contact was fine (17 Sep 2026).
 */
export function describeSendOutcome(r: { email?: SendChannelOutcome; sms?: SendChannelOutcome }): string {
  const bits: string[] = [];
  for (const [label, d] of [["Email", r.email], ["Text", r.sms]] as const) {
    if (!d) continue;
    if (d.status === "sent") bits.push(`${label} sent`);
    else if (d.status === "not_configured") bits.push(`${label} isn't configured on this server — the link was recorded, not sent`);
    else if (d.status === "suppressed") bits.push(`${label} suppressed: ${d.message ?? "the customer switched it off"}`);
    else bits.push(`${label} failed: ${d.message ?? "unknown error"}`);
  }
  return bits.length ? bits.join(". ") + "." : "Nothing went out.";
}

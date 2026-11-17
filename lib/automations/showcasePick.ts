/**
 * Which finished job to show a customer (L4, R5; 17 Nov 2026). PURE.
 *
 * "A real finished job near them, with its price": published, priced, and
 * the closest match we can name — the same suburb and job type, then the
 * same job type, then any. Showcase jobs carry a suburb, not a location, so
 * "near" is the suburb or nothing. A Paint Home customer only sees home jobs
 * whose top price is under the Paint Home ceiling (the rule the Paint Home
 * project cards use). No match → null, and the step is not sent.
 */
export type PickableShowcase = {
  slug: string; suburb: string; job_type: string; property_type: string; published: boolean;
  price_low_cents: number | null; price_high_cents: number | null; completed_on: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
/** A customer's job type to a showcase one: an interior estimate matches interior jobs, exterior exterior, both "both". */
const typeOf = (t: string | null | undefined) => (t === "interior" || t === "exterior" || t === "both" ? t : null);

export function pickShowcase<J extends PickableShowcase>(jobs: readonly J[], who: { suburb: string | null; jobType: string | null; brand: string; paintHomeCapCents: number }): J | null {
  const live = jobs.filter((j) => j.published && j.price_low_cents != null && j.price_high_cents != null
    && (who.brand !== "painthome" || (j.property_type === "home" && (j.price_high_cents ?? Infinity) <= who.paintHomeCapCents)));
  const newest = (a: J, b: J) => (b.completed_on ?? "").localeCompare(a.completed_on ?? "");
  const type = typeOf(who.jobType);
  const sameType = (j: J) => type != null && j.job_type === type;
  const sameSuburb = (j: J) => who.suburb != null && norm(j.suburb) === norm(who.suburb);
  return [...live].sort(newest).find((j) => sameSuburb(j) && sameType(j))
    ?? [...live].sort(newest).find(sameType)
    ?? [...live].sort(newest)[0]
    ?? null;
}

/** The suburb of an address line ("12 Acacia Street, Northcote VIC 3070" → "Northcote"). */
export function suburbOf(address: string | null | undefined): string | null {
  const part = (address ?? "").split(",")[1];
  if (!part) return null;
  const s = part.trim().replace(/\s+(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b.*$/i, "").trim();
  return s || null;
}

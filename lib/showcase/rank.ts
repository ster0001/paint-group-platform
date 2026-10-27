import type { Audience } from "@/lib/marketing/audience";

/**
 * Session 8 §4 — which three jobs are the homepage cards, per audience.
 * Home: property_type home, by featured_rank. Business: property_type
 * business, by featured_rank_business first, then newest; and it NEVER
 * fills with home jobs while three or more business jobs are published
 * (⚑ D4: a rank column per audience). Pure, unit-tested for 0/2/3/5.
 *
 * Paint Home (brief §4): property_type home AND the top of the price range
 * at or under the phone-close ceiling (`maxHighCents`, Settings →
 * wizard_policy.paintHomeCapCents), by featured_rank_painthome first,
 * then newest. Never a commercial job; a job with no price never qualifies
 * (the ceiling cannot be checked).
 */
export type RankableJob = {
  property_type: "home" | "business";
  featured_rank: number | null;
  featured_rank_business?: number | null;
  featured_rank_painthome?: number | null;
  price_high_cents?: number | null;
  completed_on: string | null;
  published: boolean;
};

export function rankShowcaseJobs<J extends RankableJob>(jobs: J[], audience: Audience, maxHighCents: number | null = null): J[] {
  const live = jobs.filter((j) => j.published);
  const newest = (a: J, b: J) => (b.completed_on ?? "").localeCompare(a.completed_on ?? "");
  if (audience === "home") {
    return live.filter((j) => j.property_type === "home" && j.featured_rank != null)
      .sort((a, b) => (a.featured_rank ?? 9) - (b.featured_rank ?? 9)).slice(0, 3);
  }
  if (audience === "painthome") {
    const fits = (j: J) => j.property_type === "home" && j.price_high_cents != null && (maxHighCents == null || j.price_high_cents <= maxHighCents);
    const homes = live.filter(fits);
    const ranked = homes.filter((j) => j.featured_rank_painthome != null).sort((a, b) => (a.featured_rank_painthome ?? 9) - (b.featured_rank_painthome ?? 9));
    const rest = homes.filter((j) => j.featured_rank_painthome == null).sort(newest);
    return [...ranked, ...rest].slice(0, 3);
  }
  const business = live.filter((j) => j.property_type === "business");
  const ranked = business.filter((j) => j.featured_rank_business != null).sort((a, b) => (a.featured_rank_business ?? 9) - (b.featured_rank_business ?? 9));
  const rest = business.filter((j) => j.featured_rank_business == null).sort(newest);
  const picked = [...ranked, ...rest].slice(0, 3);
  if (picked.length >= 3 || business.length >= 3) return picked;
  // Fewer than three business jobs published: pad with home cards so the
  // row is never empty, home ranks first.
  const homes = live.filter((j) => j.property_type === "home").sort((a, b) => ((a.featured_rank ?? 9) - (b.featured_rank ?? 9)) || newest(a, b));
  return [...picked, ...homes].slice(0, 3);
}

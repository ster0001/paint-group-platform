import type { Audience } from "./audience";

/**
 * Session 8 §5 — Google reviews tagged by audience. Google hands back at
 * most five reviews with no id, so a review is keyed on its publish time +
 * author. The import guesses from the text; only a CONFIRMED tag drives
 * the filter. Pure, unit-tested.
 */
export type ReviewLike = { author: string; publishedAt: string; text: string; rating: number };
export type ReviewTag = { review_key: string; audience: Audience | null; audience_suggested: Audience | null };

export function reviewKey(r: Pick<ReviewLike, "author" | "publishedAt">): string {
  return `${r.publishedAt}|${r.author}`.slice(0, 200);
}

const BUSINESS_WORDS = /\b(agency|agent|office|offices|shop|shopfront|store|tenant|tenants|strata|body corporate|owners corporation|warehouse|clinic|cafe|café|restaurant|school|church|hotel|factory|commercial|premises|vacate|PO\s?\d)/i;
const HOME_WORDS = /\b(our home|my home|our house|my house|bedroom|bedrooms|kitchen|lounge|living room|hallway|our place|family)/i;

export function suggestAudience(text: string): Audience | null {
  if (BUSINESS_WORDS.test(text)) return "business";
  if (HOME_WORDS.test(text)) return "home";
  return null;
}

export function pickReviews<R extends ReviewLike>(reviews: R[], tags: ReviewTag[], audience: Audience): { reviews: R[]; fallback: boolean } {
  const tagOf = new Map(tags.map((t) => [t.review_key, t.audience]));
  const confirmed = (r: R) => tagOf.get(reviewKey(r)) ?? null;
  if (audience === "home") {
    return { reviews: reviews.filter((r) => confirmed(r) !== "business"), fallback: false };
  }
  const business = reviews.filter((r) => confirmed(r) === "business");
  if (business.length >= 3) return { reviews: business, fallback: false };
  const untagged = reviews.filter((r) => confirmed(r) == null)
    .sort((a, b) => (b.rating - a.rating) || (a.publishedAt < b.publishedAt ? 1 : -1));
  const merged = [...business, ...untagged.filter((r) => !business.includes(r))].slice(0, Math.max(3, business.length));
  return { reviews: merged, fallback: true };
}

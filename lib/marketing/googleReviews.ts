import { z } from "zod";
import { GOOGLE_PLACE_ID } from "./site";

/**
 * Live Google reviews for the homepage (Tom, 5 Sep 2026: "a live google
 * feed showing reviews which are added in live"). Places API (New) Place
 * Details — the same key and API the address lookup uses; the legacy API
 * is not enabled on the project. Google returns up to five reviews per
 * listing; we show every one that has text, newest first, on a slider,
 * with the rating and total count live. Cached for an hour at the fetch layer, and the homepage
 * is ISR, so a new review shows within about an hour. Any failure renders
 * the placeholders — never a broken section.
 *
 * Attribution rules: reviewer name, star rating, time, and a link back to
 * Google. No edits to review text.
 */
const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  publishTime: z.string(),
  relativePublishTimeDescription: z.string().default(""),
  text: z.object({ text: z.string() }).nullable().optional(),
  authorAttribution: z.object({ displayName: z.string().default(""), uri: z.string().optional() }).optional(),
  googleMapsUri: z.string().optional(),
});
const placeSchema = z.object({
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  googleMapsUri: z.string().optional(),
  reviews: z.array(reviewSchema).default([]),
});

/** Long reviews are cut at a sentence end near this length and linked to the full text on Google (the words themselves are never changed). */
export const REVIEW_MAX_CHARS = 220; // ≈ 35 words: the best sentence or two, the Google link carries the rest (Tom, 5 Sep)

export function trimReview(text: string, max = REVIEW_MAX_CHARS): { text: string; trimmed: boolean } {
  const t = text.trim();
  if (t.length <= max) return { text: t, trimmed: false };
  const head = t.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  // A sentence end in the back half; otherwise the last whole word — never mid-word.
  const end = sentence > max * 0.5 ? sentence + 1 : Math.max(head.lastIndexOf(" "), Math.floor(max * 0.6));
  return { text: t.slice(0, end).trimEnd(), trimmed: true };
}

export type GoogleReview = { author: string; rating: number; text: string; when: string; publishedAt: string; url: string };
export type GoogleReviews = { rating: number; count: number; url: string; reviews: GoogleReview[] };

export async function getGoogleReviews(): Promise<GoogleReviews | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !GOOGLE_PLACE_ID) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${GOOGLE_PLACE_ID}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri,reviews" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const parsed = placeSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const p = parsed.data;
    const reviews = p.reviews
      .filter((r) => (r.text?.text ?? "").trim().length > 0)
      .sort((a, b) => (a.publishTime < b.publishTime ? 1 : -1))
      .map((r) => ({
        author: r.authorAttribution?.displayName || "A Google user",
        rating: r.rating,
        text: (r.text?.text ?? "").trim(),
        when: r.relativePublishTimeDescription,
        publishedAt: r.publishTime,
        url: r.googleMapsUri || p.googleMapsUri || "",
      }));
    return { rating: p.rating ?? 0, count: p.userRatingCount ?? 0, url: p.googleMapsUri ?? "", reviews };
  } catch {
    return null;
  }
}

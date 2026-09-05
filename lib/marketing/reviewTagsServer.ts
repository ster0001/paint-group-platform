import { createServiceClient } from "@/lib/supabase/service";
import { reviewKey, suggestAudience, type ReviewLike } from "./reviewTags";

// SERVER ONLY. Session 8 §5: note each fetched review (key, author, snippet)
// with the import's guess so Settings → Website → Reviews can list it for a
// one-tap confirmation. Never overwrites a confirmed tag; best-effort.
export async function syncReviewTags(reviews: ReviewLike[]): Promise<void> {
  const svc = createServiceClient();
  if (!svc || reviews.length === 0) return;
  const rows = reviews.map((r) => ({
    review_key: reviewKey(r), author: r.author.slice(0, 120), published_at: r.publishedAt || null,
    rating: Number.isFinite(r.rating) ? Math.round(r.rating) : null, snippet: r.text.slice(0, 400),
    audience_suggested: suggestAudience(r.text), seen_at: new Date().toISOString(),
  }));
  try {
    // upsert only the descriptive columns; `audience` (the confirmed tag) is never in the payload.
    await svc.from("review_tags").upsert(rows, { onConflict: "review_key", ignoreDuplicates: false });
  } catch { /* a tagging miss never breaks the page */ }
}

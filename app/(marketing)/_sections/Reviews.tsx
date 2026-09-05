import ReviewsSlider from "../_components/ReviewsSlider";
import { getGoogleReviews, trimReview } from "@/lib/marketing/googleReviews";

/**
 * §4.11 — LIVE from the Google listing "Paint Group" (Tom, 5 Sep: the
 * listing with the 93 reviews), on a slider, with the rating, the total
 * count and a link to all of them on Google. Google's API hands back at
 * most five reviews per listing; the link is how a visitor sees the rest.
 * If Google can't be reached the placeholders show instead.
 */
const PLACEHOLDERS = [
  "[Real review: one that mentions the price being what was quoted]",
  "[Real review: one that mentions the photo updates or the painter by name]",
  "[Real review: one that mentions the finish or the prep]",
];

export default async function Reviews() {
  const live = await getGoogleReviews();
  const cards = live && live.reviews.length > 0
    ? live.reviews.map((r) => { const t = trimReview(r.text); return { ...r, shown: t.text, trimmed: t.trimmed }; })
    : null;
  return (
    <section className="sec light" id="reviews">
      <div className="wrap">
        <div className="head">
          <div>
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }} data-testid="reviews-line">
              {live ? `${live.rating.toFixed(1)} from ${live.count} Google review${live.count === 1 ? "" : "s"}` : "Google reviews"}
            </div>
            <h2>What people say once the tape comes off.</h2>
          </div>
          {live?.url && <a href={live.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }} data-testid="reviews-all">All {live.count} reviews on Google →</a>}
        </div>
        <div data-testid="reviews" data-source={cards ? "google" : "placeholder"}>
          {cards
            ? <ReviewsSlider reviews={cards} />
            : (
              <div className="revs">
                {PLACEHOLDERS.map((p) => (
                  <div className="rev" key={p} data-todo="9.6">
                    <span className="stars" aria-label="Five stars">★★★★★</span><p>{p}</p><small>Name · suburb · job type</small>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </section>
  );
}

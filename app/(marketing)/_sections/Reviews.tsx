import { getGoogleReviews, trimReview } from "@/lib/marketing/googleReviews";

/**
 * §4.11 — three cards, five amber stars. LIVE from the Google listing
 * (Tom, 5 Sep): the newest three reviews with text, the rating and the
 * total count. If Google can't be reached the placeholders show instead.
 */
const PLACEHOLDERS = [
  "[Real review: one that mentions the price being what was quoted]",
  "[Real review: one that mentions the photo updates or the painter by name]",
  "[Real review: one that mentions the finish or the prep]",
];

export default async function Reviews() {
  const live = await getGoogleReviews();
  const cards = live && live.reviews.length > 0 ? live.reviews : null;
  return (
    <section className="sec light" id="reviews">
      <div className="wrap">
        <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }} data-testid="reviews-line">
          {live ? `${live.rating.toFixed(1)} from ${live.count} Google review${live.count === 1 ? "" : "s"}` : "Google reviews"}
        </div>
        <h2>What people say once the tape comes off.</h2>
        <div className="revs" data-testid="reviews" data-source={cards ? "google" : "placeholder"}>
          {cards
            ? cards.map((r) => {
              const t = trimReview(r.text);
              return (
              <div className="rev" key={r.publishedAt + r.author}>
                <span className="stars" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(Math.round(r.rating))}{"☆".repeat(5 - Math.round(r.rating))}</span>
                <p>{t.text}{t.trimmed && <> … {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>read on Google</a> : null}</>}</p>
                <small>{r.author} · {r.when} · {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">Google review</a> : "Google review"}</small>
              </div>
              );
            })
            : PLACEHOLDERS.map((p) => (
              <div className="rev" key={p} data-todo="9.6">
                <span className="stars" aria-label="Five stars">★★★★★</span><p>{p}</p><small>Name · suburb · job type</small>
              </div>
            ))}
        </div>
        {live?.url && <p style={{ marginTop: 20 }}><a href={live.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: "12px 18px", fontSize: 15 }}>All reviews on Google →</a></p>}
      </div>
    </section>
  );
}

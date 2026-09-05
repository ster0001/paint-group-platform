"use client";

import { useEffect, useRef, useState } from "react";
import type { GoogleReview } from "@/lib/marketing/googleReviews";

/**
 * Reviews on a slider (Tom, 5 Sep): the live Google reviews as a
 * scroll-snap carousel, one card per view on a phone and three on a
 * laptop, with previous/next buttons, dots, and keyboard arrows. No
 * autoplay. Google's API hands back at most five reviews per listing, so
 * the slider shows those and the link goes to the full list. Text is
 * trimmed on the server (plain data only crosses to this client component).
 */
export type SlideReview = GoogleReview & { shown: string; trimmed: boolean };

export default function ReviewsSlider({ reviews }: { reviews: SlideReview[] }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [perView, setPerView] = useState(1);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const card = el.querySelector<HTMLElement>(".rev");
      if (!card) return;
      setPerView(Math.max(1, Math.round(el.clientWidth / (card.offsetWidth + 20))));
    };
    measure();
    const onScroll = () => {
      const card = el.querySelector<HTMLElement>(".rev");
      if (!card) return;
      setIndex(Math.round(el.scrollLeft / (card.offsetWidth + 20)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => { el.removeEventListener("scroll", onScroll); window.removeEventListener("resize", measure); };
  }, [reviews.length]);

  const pages = Math.max(1, reviews.length - perView + 1);
  const go = (i: number) => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>(".rev");
    if (!el || !card) return;
    const next = Math.min(Math.max(0, i), reviews.length - 1);
    el.scrollTo({ left: next * (card.offsetWidth + 20), behavior: "smooth" });
    setIndex(next);
  };

  return (
    <div className="revslider" data-testid="reviews-slider">
      <div
        ref={track} className="revtrack" role="region" aria-roledescription="carousel" aria-label="Google reviews" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); } }}
      >
        {reviews.map((r, i) => {
          return (
            <div className="rev" key={r.publishedAt + r.author} role="group" aria-roledescription="slide" aria-label={`Review ${i + 1} of ${reviews.length}`}>
              <span className="stars" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(Math.round(r.rating))}{"☆".repeat(5 - Math.round(r.rating))}</span>
              <p>{r.shown}{r.trimmed && <> … {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>read on Google</a> : null}</>}</p>
              <small>{r.author} · {r.when} · {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">Google review</a> : "Google review"}</small>
            </div>
          );
        })}
      </div>
      {reviews.length > perView && (
        <div className="revnav">
          <button type="button" className="revbtn" aria-label="Previous reviews" onClick={() => go(index - 1)} disabled={index <= 0}>‹</button>
          <div className="revdots" aria-hidden="true">
            {Array.from({ length: pages }, (_, i) => <span key={i} className={`revdot${i === Math.min(index, pages - 1) ? " on" : ""}`} />)}
          </div>
          <button type="button" className="revbtn" aria-label="Next reviews" onClick={() => go(index + 1)} disabled={index >= reviews.length - perView}>›</button>
        </div>
      )}
    </div>
  );
}

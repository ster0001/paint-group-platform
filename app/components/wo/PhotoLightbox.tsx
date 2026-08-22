"use client";

import { useCallback, useEffect } from "react";

/**
 * Tap a site photo, see it big — without leaving the page.
 *
 * The grid used to wrap each thumbnail in `<a target="_blank">`, so a painter
 * checking their own work got dumped onto a bare image in a new tab with no way
 * back but the browser chrome, and lost their place in the tick list (Tom,
 * 22 Aug). On a phone, in a driveway, that is the difference between checking a
 * photo and not bothering.
 *
 * The URLs are short-lived signed links into a private bucket, so the image is
 * shown as-is and never handed to next/image, which would cache a signature
 * that expires.
 */
export type LightboxPhoto = { id: string; url: string; alt: string; caption: string };

export default function PhotoLightbox({
  photos, openAt, onClose, onNavigate,
}: {
  photos: readonly LightboxPhoto[];
  /** Index to show, or null for closed. */
  openAt: number | null;
  onClose: () => void;
  /** Move to another photo. The index lives in the parent — see below. */
  onNavigate: (index: number) => void;
}) {
  // FULLY CONTROLLED, with no index of its own. It used to hold its own `at`
  // and sync it from `openAt` in an effect, which is a setState inside an
  // effect: a cascading render, and lint rightly refuses it. The grid already
  // knows which photo was tapped, so it owns the index.
  const step = useCallback((by: number) => {
    if (openAt === null || photos.length === 0) return;
    onNavigate((openAt + by + photos.length) % photos.length);
  }, [openAt, photos.length, onNavigate]);

  // Escape closes, arrows walk the set — a keyboard is how the office looks at
  // these, even though the painter's phone never sees one.
  useEffect(() => {
    if (openAt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll under the overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openAt, onClose, step]);

  if (openAt === null || photos.length === 0) return null;
  const photo = photos[Math.min(openAt, photos.length - 1)];

  return (
    <div
      className="wolightbox"
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      data-testid="photo-lightbox"
      onClick={onClose}
    >
      <button type="button" className="wolb-close" onClick={onClose}
        aria-label="Close" data-testid="lightbox-close">×</button>

      {photos.length > 1 && (
        <>
          <button type="button" className="wolb-nav prev" data-testid="lightbox-prev"
            onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous photo">‹</button>
          <button type="button" className="wolb-nav next" data-testid="lightbox-next"
            onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next photo">›</button>
        </>
      )}

      {/* Stop the click on the image itself from closing — only the backdrop does. */}
      <figure onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.alt} data-testid="lightbox-image" />
        <figcaption>
          {photo.caption}
          {photos.length > 1 && <span className="count">{openAt + 1} / {photos.length}</span>}
        </figcaption>
      </figure>
    </div>
  );
}

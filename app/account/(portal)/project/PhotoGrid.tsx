"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GridPhoto = { id: string; thumbUrl: string; fullUrl: string; caption: string; area: string; media?: "image" | "video" };

/**
 * The timeline's photo grid: sized renditions in the feed (lazy — the feed is
 * long), a full-screen viewer on tap that swipes between the photos of that
 * entry with the area label and "2 of 4" (portal UX brief D4, 25 Oct 2026).
 * Still a rendition in the viewer — never the original.
 */
export default function PhotoGrid({ photos }: { photos: GridPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);
  const open = index == null ? null : photos[index] ?? null;

  const step = useCallback((by: number) => {
    setIndex((i) => (i == null ? i : (i + by + photos.length) % photos.length));
  }, [photos.length]);

  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, step]);

  if (photos.length === 0) return null;
  const label = (p: GridPhoto) => p.caption || p.area || "";
  const noun = photos.every((p) => p.media === "video") ? "video" : "photo";
  return (
    <>
      <div className="pcount" data-testid="photo-count">{photos.length} {noun}{photos.length === 1 ? "" : "s"} · tap to view</div>
      <div className="pgrid">
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="photo" data-media={p.media ?? "image"} onClick={() => setIndex(i)} aria-label={`Open ${p.media === "video" ? "video" : "photo"}${p.caption ? `: ${p.caption}` : ""}`}>
            {/* Signed rendition URLs are short-lived — next/image's optimizer would re-fetch and cache them; plain img is correct here. */}
            {p.media === "video" ? (
              <video src={p.thumbUrl} muted playsInline preload="metadata" aria-label={label(p) || "Site video"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumbUrl} alt={label(p) || "Site photo"} loading="lazy" decoding="async" />
            )}
            {p.media === "video" && <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 22, textShadow: "0 2px 10px rgba(0,0,0,.7)", pointerEvents: "none" }}>▶</span>}
            {label(p) && <span className="cap">{label(p)}</span>}
          </button>
        ))}
      </div>
      {open && index != null && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal
          aria-label={label(open) || "Photo"}
          data-testid="lightbox"
          onClick={() => setIndex(null)}
          onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => {
            const start = touchX.current; touchX.current = null;
            const end = e.changedTouches[0]?.clientX;
            if (start == null || end == null) return;
            const dx = end - start;
            if (Math.abs(dx) > 40) { e.stopPropagation(); step(dx < 0 ? 1 : -1); }
          }}
        >
          {open.media === "video" ? (
            <video src={open.fullUrl} controls autoPlay playsInline aria-label={label(open) || "Site video"} style={{ maxWidth: "96vw", maxHeight: "78vh", background: "#000" }} onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open.fullUrl} alt={label(open) || "Site photo"} onClick={(e) => e.stopPropagation()} />
          )}
          <div className="cap" data-testid="lightbox-caption">
            {label(open) ? <>{label(open)} · </> : null}
            <span data-testid="lightbox-position">{index + 1} of {photos.length}</span>
          </div>
          {photos.length > 1 && (
            <>
              <button type="button" className="lb-nav prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }}>‹</button>
              <button type="button" className="lb-nav next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }}>›</button>
            </>
          )}
          <button type="button" className="close" onClick={() => setIndex(null)}>Close</button>
        </div>
      )}
    </>
  );
}

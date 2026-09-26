"use client";

import { useEffect, useState } from "react";

export type GridPhoto = { id: string; thumbUrl: string; fullUrl: string; caption: string; area: string; media?: "image" | "video" };

/** The timeline's photo grid: sized renditions in the feed, a full-screen
 * viewer on tap (still a rendition — never the original). */
export default function PhotoGrid({ photos }: { photos: GridPhoto[] }) {
  const [open, setOpen] = useState<GridPhoto | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (photos.length === 0) return null;
  return (
    <>
      <div className="pgrid">
        {photos.map((p) => (
          <button key={p.id} type="button" className="photo" data-media={p.media ?? "image"} onClick={() => setOpen(p)} aria-label={`Open ${p.media === "video" ? "video" : "photo"}${p.caption ? `: ${p.caption}` : ""}`}>
            {/* Signed rendition URLs are short-lived — next/image's optimizer would re-fetch and cache them; plain img is correct here. */}
            {p.media === "video" ? (
              <video src={p.thumbUrl} muted playsInline preload="metadata" aria-label={p.caption || p.area || "Site video"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumbUrl} alt={p.caption || p.area || "Site photo"} loading="lazy" />
            )}
            {p.media === "video" && <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 22, textShadow: "0 2px 10px rgba(0,0,0,.7)", pointerEvents: "none" }}>▶</span>}
            {(p.caption || p.area) && <span className="cap">{p.caption || p.area}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal onClick={() => setOpen(null)}>
          {open.media === "video" ? (
            <video src={open.fullUrl} controls autoPlay playsInline aria-label={open.caption || open.area || "Site video"} style={{ maxWidth: "96vw", maxHeight: "82vh", background: "#000" }} onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open.fullUrl} alt={open.caption || open.area || "Site photo"} />
          )}
          {(open.caption || open.area) && <div className="cap">{open.caption || open.area}</div>}
          <button type="button" className="close" onClick={() => setOpen(null)}>Close</button>
        </div>
      )}
    </>
  );
}

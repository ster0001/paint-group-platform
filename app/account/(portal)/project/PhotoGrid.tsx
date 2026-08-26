"use client";

import { useEffect, useState } from "react";

export type GridPhoto = { id: string; thumbUrl: string; fullUrl: string; caption: string; area: string };

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
          <button key={p.id} type="button" className="photo" onClick={() => setOpen(p)} aria-label={`Open photo${p.caption ? `: ${p.caption}` : ""}`}>
            {/* Signed rendition URLs are short-lived — next/image's optimizer would re-fetch and cache them; plain img is correct here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumbUrl} alt={p.caption || p.area || "Site photo"} loading="lazy" />
            {(p.caption || p.area) && <span className="cap">{p.caption || p.area}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal onClick={() => setOpen(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.fullUrl} alt={open.caption || open.area || "Site photo"} />
          {(open.caption || open.area) && <div className="cap">{open.caption || open.area}</div>}
          <button type="button" className="close" onClick={() => setOpen(null)}>Close</button>
        </div>
      )}
    </>
  );
}

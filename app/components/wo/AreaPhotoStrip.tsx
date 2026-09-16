"use client";

import { useState } from "react";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";
import "./photogrid.css";

/**
 * The scope photos pinned to one area of a work order, tappable.
 *
 * These were bare 72px `<img>`s: a painter reading a job on their phone could
 * see that a photo existed but not what was in it (Tom, 16 Sep). Each one is
 * now a button into the shared lightbox, so it enlarges in place and the set
 * swipes left and right, exactly like the site-photo grid.
 */
export default function AreaPhotoStrip({ area, photos }: { area: string; photos: readonly string[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (photos.length === 0) return null;

  const full: LightboxPhoto[] = photos.map((url, i) => ({
    id: `${area}-${i}`,
    url,
    alt: `${area} photo ${i + 1}`,
    caption: area,
  }));

  return (
    <div className="area-photos" data-testid="area-photos">
      {photos.map((src, i) => (
        <button key={i} type="button" className="area-photo" onClick={() => setOpenAt(i)}
          aria-label={`Enlarge ${area} photo ${i + 1}`} data-testid="area-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" />
        </button>
      ))}
      <PhotoLightbox photos={full} openAt={openAt} onClose={() => setOpenAt(null)} onNavigate={setOpenAt} />
    </div>
  );
}

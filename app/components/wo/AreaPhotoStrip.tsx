"use client";

import { useState } from "react";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";
import { isVideoUrl } from "@/lib/media/video";
import "./photogrid.css";

/**
 * The scope photos pinned to one area of a work order, tappable.
 *
 * These were bare 72px `<img>`s: a painter reading a job on their phone could
 * see that a photo existed but not what was in it (Tom, 16 Sep). Each one is
 * now a button into the shared lightbox, so it enlarges in place and the set
 * swipes left and right, exactly like the site-photo grid.
 *
 * A clip the customer sent (Tom, 19 Oct 2026) rides the same list — the URL
 * carries a video extension — and shows as a poster frame with a play badge
 * that the lightbox plays.
 */
export default function AreaPhotoStrip({ area, photos }: { area: string; photos: readonly string[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (photos.length === 0) return null;

  const full: LightboxPhoto[] = photos.map((url, i) => ({
    id: `${area}-${i}`,
    url,
    media: isVideoUrl(url) ? "video" : "image",
    alt: `${area} ${isVideoUrl(url) ? "video" : "photo"} ${i + 1}`,
    caption: area,
  }));

  return (
    <div className="area-photos" data-testid="area-photos">
      {photos.map((src, i) => (
        <button key={i} type="button" className="area-photo" onClick={() => setOpenAt(i)}
          aria-label={isVideoUrl(src) ? `Play ${area} video ${i + 1}` : `Enlarge ${area} photo ${i + 1}`}
          data-testid="area-photo" data-media={isVideoUrl(src) ? "video" : "image"}>
          {isVideoUrl(src) ? (
            <>
              <video src={src} muted playsInline preload="metadata" aria-hidden="true" />
              <span className="play" aria-hidden="true">▶</span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" />
          )}
        </button>
      ))}
      <PhotoLightbox photos={full} openAt={openAt} onClose={() => setOpenAt(null)} onNavigate={setOpenAt} />
    </div>
  );
}

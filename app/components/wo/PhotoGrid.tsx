"use client";

import { useState } from "react";
import { WO_PHOTO_KIND_LABEL, photoCaption, photoWhen, type WOPhoto } from "@/lib/workorder/photos";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";
import "./photogrid.css";

/**
 * The photos the painter sent in, as a grid of thumbnails that open full size.
 *
 * ONE component for every surface — the console, the dashboard, the builder and
 * the contractor's own work order — so a change lands everywhere at once. It is
 * a client component: tapping a thumbnail opens a lightbox rather than throwing
 * the viewer into a new tab (Tom, 22 Aug). Its props are plain data, so it
 * still renders happily inside a Server Component.
 *
 * `next/image` is deliberately not used: these are signed, short-lived URLs into
 * a private bucket, which the image optimiser cannot cache or re-fetch once the
 * signature expires.
 */
export default function PhotoGrid({
  photos,
  tight = false,
  showKind = true,
  empty,
}: {
  photos: readonly WOPhoto[];
  /** Denser tiles — for the sidebar of a card rather than a full section. */
  tight?: boolean;
  showKind?: boolean;
  /** Said out loud when there are none, so an empty grid isn't a mystery. */
  empty?: string;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (photos.length === 0) {
    return empty ? <p className="wophotos-empty">{empty}</p> : null;
  }

  const full: LightboxPhoto[] = photos.map((p) => ({
    id: p.id,
    url: p.url,
    alt: photoCaption(p) || "Site photo",
    caption: [p.area, p.caption, WO_PHOTO_KIND_LABEL[p.kind], photoWhen(p)].filter(Boolean).join(" · "),
  }));

  return (
    <div className={`wophotos${tight ? " tight" : ""}`} data-testid="wo-photos">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="wophoto"
          onClick={() => setOpenAt(i)}
          data-testid="wo-photo"
          data-kind={p.kind}
        >
          <figure>
            <span className="shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={photoCaption(p) || "Site photo"} loading="lazy" />
              {showKind && <span className="kind">{WO_PHOTO_KIND_LABEL[p.kind]}</span>}
            </span>
            <figcaption>
              {p.area && <span className="where">{p.area}</span>}
              {[p.caption, photoWhen(p)].filter(Boolean).join(" · ")}
            </figcaption>
          </figure>
        </button>
      ))}

      <PhotoLightbox photos={full} openAt={openAt} onClose={() => setOpenAt(null)} onNavigate={setOpenAt} />
    </div>
  );
}

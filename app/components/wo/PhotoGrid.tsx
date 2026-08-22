import { WO_PHOTO_KIND_LABEL, photoCaption, photoWhen, type WOPhoto } from "@/lib/workorder/photos";
import "./photogrid.css";

/**
 * The photos the painter sent in, as a grid of thumbnails that open full size.
 *
 * No hooks and no handlers, so the same component renders inside a Server
 * Component (the console, the dashboard) and inside the builder's client tree
 * without forking into two copies — the shared-component rule.
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
  if (photos.length === 0) {
    return empty ? <p className="wophotos-empty">{empty}</p> : null;
  }

  return (
    <div className={`wophotos${tight ? " tight" : ""}`} data-testid="wo-photos">
      {photos.map((p) => (
        <a
          key={p.id}
          className="wophoto"
          href={p.url}
          target="_blank"
          rel="noreferrer"
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
        </a>
      ))}
    </div>
  );
}

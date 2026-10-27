import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { isVideoPath } from "@/lib/workorder/photos";

/**
 * 3a-4 · Portal photo serving, per the volume laws (§10.3): the timeline
 * serves sized renditions via signed URLs — a phone feed never downloads an
 * original. Verified live: a 200px render of a real site photo is ~14% of
 * the original's bytes. Full-screen tap gets a 1600px rendition, still not
 * the original.
 *
 * 27 Oct 2026 (Chris, Rose Street: "I can't see the photos in my portal"):
 * the page no longer signs thumbnails up front. It used to sign at most 12
 * per page, so on a job with more than three days of photos every older
 * day drew a "Photos from the site" card with nothing in it. Now every
 * photo's `<img>` points at /account/photo/[id]?size=thumb and the browser
 * fetches only what scrolls into view; each request re-proves ownership and
 * mints one signed rendition. The page itself makes no storage calls.
 */

export type PortalPhoto = {
  id: string;
  kind: string;
  area: string;
  caption: string;
  thumbUrl: string;
  fullUrl: string;
  /** A video (Tom, 26 Sep 2026) is signed as-is — the image transform has nothing to resize. */
  media: "image" | "video";
};

export type PortalPhotoRow = {
  id: string;
  kind: string;
  area: string;
  caption: string;
  storage_path: string;
};

export type PhotoSize = "thumb" | "full";

export const THUMB_WIDTH = 640;
export const FULL_WIDTH = 1600;
const TTL_SECONDS = 3600;

/** The on-demand route for one photo at one size — the only URL a portal
 * page puts in an `<img>` or `<video>`. */
export function portalPhotoHref(id: string, size: PhotoSize): string {
  return size === "thumb" ? `/account/photo/${id}?size=thumb` : `/account/photo/${id}`;
}

/** Every row as a renderable photo, with NO storage call: both URLs are the
 * on-demand route, so the count of photos on a page costs nothing up front. */
export function portalPhotoRefs(rows: readonly PortalPhotoRow[]): Map<string, PortalPhoto> {
  const out = new Map<string, PortalPhoto>();
  for (const r of rows) {
    if (!r.storage_path) continue;
    out.set(r.id, {
      id: r.id, kind: r.kind, area: r.area, caption: r.caption,
      thumbUrl: portalPhotoHref(r.id, "thumb"),
      fullUrl: portalPhotoHref(r.id, "full"),
      media: isVideoPath(r.storage_path) ? "video" : "image",
    });
  }
  return out;
}

/** One signed rendition for the on-demand route — 640px for a thumbnail,
 * 1600px full-screen, never the original. A video is signed as-is. */
export async function signPhotoRendition(svc: SupabaseClient, storagePath: string, size: PhotoSize): Promise<string | null> {
  const bucket = svc.storage.from("wo-photos");
  const { data, error } = isVideoPath(storagePath)
    ? await bucket.createSignedUrl(storagePath, TTL_SECONDS)
    : await bucket.createSignedUrl(storagePath, TTL_SECONDS, { transform: { width: size === "thumb" ? THUMB_WIDTH : FULL_WIDTH } });
  if (error) reportError(error, { where: "portal.photos.sign", bestEffort: true, extra: { size } });
  return data?.signedUrl ?? null;
}

/** Sign THUMBS up front — kept for callers that render a handful of photos
 * outside the account (nothing in the signed-in portal uses it any more). */
export async function signPortalPhotos(
  svc: SupabaseClient,
  rows: readonly PortalPhotoRow[],
): Promise<Map<string, PortalPhoto>> {
  const out = new Map<string, PortalPhoto>();
  await Promise.all(
    rows.filter((r) => r.storage_path).map(async (r) => {
      try {
        const thumbUrl = await signPhotoRendition(svc, r.storage_path, "thumb");
        if (!thumbUrl) return;
        out.set(r.id, {
          id: r.id, kind: r.kind, area: r.area, caption: r.caption,
          thumbUrl,
          fullUrl: portalPhotoHref(r.id, "full"),
          media: isVideoPath(r.storage_path) ? "video" : "image",
        });
      } catch (err) {
        reportError(err, { where: "portal.photos.sign", bestEffort: true });
      }
    }),
  );
  return out;
}

/** The large rendition for the on-demand route. */
export async function signFullPhoto(svc: SupabaseClient, storagePath: string): Promise<string | null> {
  return signPhotoRendition(svc, storagePath, "full");
}

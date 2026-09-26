import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { isVideoPath } from "@/lib/workorder/photos";

/**
 * 3a-4 · Portal photo serving, per the volume laws (§10.3): the timeline
 * serves sized renditions via signed URLs — a phone feed never downloads an
 * original. Verified live: a 200px render of a real site photo is ~14% of
 * the original's bytes. Full-screen tap gets a 1600px rendition, still not
 * the original.
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

const THUMB_WIDTH = 640;
const FULL_WIDTH = 1600;
const TTL_SECONDS = 3600;

/** Sign THUMBS only — one storage call per photo, not two (the volume
 * gate's finding). Full-screen goes through /account/photo/[id], which
 * re-checks ownership and mints the large rendition on demand. */
export async function signPortalPhotos(
  svc: SupabaseClient,
  rows: readonly PortalPhotoRow[],
): Promise<Map<string, PortalPhoto>> {
  const out = new Map<string, PortalPhoto>();
  const bucket = svc.storage.from("wo-photos");
  await Promise.all(
    rows.filter((r) => r.storage_path).map(async (r) => {
      try {
        const video = isVideoPath(r.storage_path);
        const thumb = video
          ? await bucket.createSignedUrl(r.storage_path, TTL_SECONDS)
          : await bucket.createSignedUrl(r.storage_path, TTL_SECONDS, { transform: { width: THUMB_WIDTH } });
        const thumbUrl = thumb.data?.signedUrl;
        if (!thumbUrl) return;
        out.set(r.id, {
          id: r.id, kind: r.kind, area: r.area, caption: r.caption,
          thumbUrl,
          fullUrl: `/account/photo/${r.id}`,
          media: video ? "video" : "image",
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
  const { data } = isVideoPath(storagePath)
    ? await svc.storage.from("wo-photos").createSignedUrl(storagePath, TTL_SECONDS)
    : await svc.storage.from("wo-photos").createSignedUrl(storagePath, TTL_SECONDS, { transform: { width: FULL_WIDTH } });
  return data?.signedUrl ?? null;
}

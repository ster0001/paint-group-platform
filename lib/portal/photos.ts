import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

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

export async function signPortalPhotos(
  svc: SupabaseClient,
  rows: readonly PortalPhotoRow[],
): Promise<Map<string, PortalPhoto>> {
  const out = new Map<string, PortalPhoto>();
  const bucket = svc.storage.from("wo-photos");
  await Promise.all(
    rows.filter((r) => r.storage_path).map(async (r) => {
      try {
        const [thumb, full] = await Promise.all([
          bucket.createSignedUrl(r.storage_path, TTL_SECONDS, { transform: { width: THUMB_WIDTH } }),
          bucket.createSignedUrl(r.storage_path, TTL_SECONDS, { transform: { width: FULL_WIDTH } }),
        ]);
        const thumbUrl = thumb.data?.signedUrl;
        const fullUrl = full.data?.signedUrl ?? thumbUrl;
        if (!thumbUrl) return;
        out.set(r.id, {
          id: r.id, kind: r.kind, area: r.area, caption: r.caption,
          thumbUrl, fullUrl: fullUrl!,
        });
      } catch (err) {
        reportError(err, { where: "portal.photos.sign", bestEffort: true });
      }
    }),
  );
  return out;
}

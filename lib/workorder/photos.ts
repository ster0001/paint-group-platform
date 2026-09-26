/**
 * Site photos — the record the painter builds while the job runs.
 *
 * The bytes live in the PRIVATE `wo-photos` bucket, so nothing here ever
 * produces a public URL: reads go through short-lived signed URLs, the same
 * convention as contractor documents. `wo_photos.storage_path` is a path, and
 * the row is what says who may see it — RLS scopes the SELECT to staff, the
 * assigned contractor, and the job's own customer, and the bucket policy asks
 * the same question of the object.
 *
 * The photos were being written from day one and read by nobody: the loop only
 * ever asked "does a before-photo exist for this elevation?". This module is
 * the read side — one place that signs and shapes them, so the console, the job
 * sheet and the dashboard cannot drift into three different opinions about what
 * a photo is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const WO_PHOTO_KINDS = ["reference", "before", "progress", "qa", "completion", "variation"] as const;
export type WOPhotoKind = (typeof WO_PHOTO_KINDS)[number];

/** Display order — the job's own order, not the enum's. */
export const WO_PHOTO_KIND_ORDER: readonly WOPhotoKind[] = [
  "reference", "before", "progress", "variation", "qa", "completion",
];

export const WO_PHOTO_KIND_LABEL: Record<WOPhotoKind, string> = {
  reference: "From the office",
  before: "Before",
  progress: "Progress",
  variation: "Variation",
  qa: "Quality check",
  completion: "Completion",
};

export const PHOTO_URL_TTL_SECONDS = 3600;

/** The row as the database holds it. */
export type WOPhotoRow = {
  id: string;
  work_order_id?: string | null;
  kind: string;
  area: string | null;
  caption: string | null;
  storage_path: string;
  created_at: string;
  variation_id?: string | null;
};

export type WOMedia = "image" | "video";

/**
 * A video is told apart by its storage path's extension (Tom, 26 Sep 2026):
 * the sign step names a video object `.mp4` / `.mov` / `.webm` and the ingest
 * refuses bytes that disagree, so the path is the record. Photo paths carry no
 * extension at all, which is what every row before this date has.
 */
export function isVideoPath(storagePath: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(storagePath);
}

/** The row as a screen wants it: a URL it can put in an `img` — or a `video`. */
export type WOPhoto = {
  id: string;
  workOrderId: string;
  url: string;
  media: WOMedia;
  kind: WOPhotoKind;
  /** The elevation/room the photo is of — "" when it is of the job generally. */
  area: string;
  caption: string;
  takenAt: string;
  variationId: string | null;
};

const isKind = (k: string): k is WOPhotoKind =>
  (WO_PHOTO_KINDS as readonly string[]).includes(k);

/**
 * Sign a batch of photo rows in one round trip.
 *
 * A row whose object has gone missing signs to nothing and is dropped rather
 * than rendered as a broken tile — this loop has already paid once for orphaned
 * photo rows, and a grid of broken images reads as "the feature is broken".
 */
export async function signPhotos(
  db: SupabaseClient,
  rows: readonly WOPhotoRow[],
  ttlSeconds: number = PHOTO_URL_TTL_SECONDS,
): Promise<WOPhoto[]> {
  const usable = rows.filter((r) => !!r.storage_path);
  if (usable.length === 0) return [];

  const { data: signed } = await db.storage
    .from("wo-photos")
    .createSignedUrls(usable.map((r) => r.storage_path), ttlSeconds);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));

  const out: WOPhoto[] = [];
  for (const r of usable) {
    const url = urlByPath.get(r.storage_path);
    if (!url) continue;
    out.push({
      id: r.id,
      workOrderId: r.work_order_id ?? "",
      url,
      media: isVideoPath(r.storage_path) ? "video" : "image",
      kind: isKind(r.kind) ? r.kind : "progress",
      area: r.area ?? "",
      caption: r.caption ?? "",
      takenAt: r.created_at,
      variationId: r.variation_id ?? null,
    });
  }
  return out;
}

/** Grouped for display, in WO_PHOTO_KIND_ORDER, empty kinds omitted. */
export function groupByKind(photos: readonly WOPhoto[]): { kind: WOPhotoKind; photos: WOPhoto[] }[] {
  return WO_PHOTO_KIND_ORDER
    .map((kind) => ({ kind, photos: photos.filter((p) => p.kind === kind) }))
    .filter((g) => g.photos.length > 0);
}

/**
 * The photos the OFFICE attached for the painter — and only those.
 *
 * Every contractor-facing surface feeds its office-photos section through this,
 * never through a raw wo_photos read: the same table holds the painter's own
 * before/progress/qa/completion record, and a widened select is how that record
 * would end up rendered back at them as though the office had sent it.
 */
export function officePhotos(photos: readonly WOPhoto[]): WOPhoto[] {
  return photos.filter((p) => p.kind === "reference");
}

/** Office photos for one area, plus the ones pinned to the job generally. */
export function officePhotosForArea(photos: readonly WOPhoto[], area: string): WOPhoto[] {
  return officePhotos(photos).filter((p) => p.area === area || p.area === "");
}

/** The photos attached to one variation, newest first. */
export function forVariation(photos: readonly WOPhoto[], variationId: string): WOPhoto[] {
  return photos.filter((p) => p.variationId === variationId);
}

/** "22 Aug, 9:14 am" — Melbourne, always. Never the browser's guess. */
export function photoWhen(photo: WOPhoto): string {
  return new Date(photo.takenAt).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}

/** "Front elevation · second coat · 22 Aug, 9:14 am" — the whole label, for alt text. */
export function photoCaption(photo: WOPhoto): string {
  return [photo.area, photo.caption, photoWhen(photo)].filter(Boolean).join(" · ");
}

/**
 * Showcase photo uploads — browser side. Reuses the platform's existing
 * Settings upload path (the same direct `storage.upload` the product photos
 * use, behind the bucket's staff-only insert policy) and the same
 * plain-English pre-check (lib/uploads/validate). The one addition: the
 * photo is downscaled in the browser (lib/uploads/downscale) to 1600 px on its long edge before it
 * goes up, so no original ever lands in the public bucket at 10 MB and the
 * page budget (§6: ≤ 180 KB at 1200 wide) is met by construction;
 * next/image derives the 800 px and smaller variants on request.
 */
import { checkUpload } from "@/lib/uploads/validate";
import { downscale as downscaleShared } from "@/lib/uploads/downscale";
import { SHOWCASE_BUCKET } from "./format";

export const MAX_EDGE = 1600;

export type UploadClient = {
  storage: { from(bucket: string): { upload(path: string, body: Blob, opts?: { contentType?: string; upsert?: boolean }): Promise<{ error: { message: string } | null }> } };
};

/** `jobs/<key>/<stamp>-<safe-name>.jpg` — one folder per job, flat inside. */
export function showcasePathFor(jobKey: string, originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "photo";
  return `jobs/${jobKey}/${Date.now()}-${base}.jpg`;
}

/** Downscale to MAX_EDGE and re-encode as JPEG. Returns null when the browser can't decode it (HEIC on Chrome). */
export async function downscale(file: File, maxEdge = MAX_EDGE): Promise<Blob | null> {
  return downscaleShared(file, maxEdge, 0.86);
}

export type UploadOutcome = { path: string } | { error: string };

export async function uploadShowcasePhoto(client: UploadClient, jobKey: string, file: File): Promise<UploadOutcome> {
  const bad = checkUpload(file, "image");
  if (bad) return { error: bad };
  const blob = await downscale(file);
  if (!blob) return { error: "That photo can't be read by this browser — please use a JPG or PNG." };
  const path = showcasePathFor(jobKey, file.name);
  const { error } = await client.storage.from(SHOWCASE_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) return { error: error.message };
  return { path };
}

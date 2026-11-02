import { browserClient } from "@/lib/supabase/lazyClient";
import type { SuggestedSpot } from "@/lib/wizard/photo-defects";

/**
 * The customer's photo of a room or a spot — ONE upload path (quote stage
 * v10 S0 map, "Photos (D-Q5)"; lifted out of `RoomSpots.tsx`, which now
 * calls it): stage a signed URL, put the file in `estimate-sources`, claim
 * it for the estimate (without `estimateId` the row is orphaned — the bug
 * that left 92 rows unreachable), and read it when asked so the customer
 * confirms a suggestion rather than types one.
 */
export const SPOT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** D-Q5: three per room. A UI limit over the adapter, not the adapter's. */
export const SPOT_PHOTOS_PER_ROOM = 3;

export async function uploadSpotPhoto(file: File, o: { estimateId: string; label: string; analyse: boolean }): Promise<{ sourceId: string | null; suggestion: SuggestedSpot | null }> {
  const supabase = await browserClient();
  const prep = await fetch("/api/extract/upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ name: file.name, size: file.size }] }),
  });
  const prepJson = await prep.json().catch(() => ({}));
  if (!prep.ok) throw new Error(prepJson.error ?? "That photo couldn't be uploaded.");
  const slot = (prepJson.uploads ?? [])[0] as { path: string; token: string } | undefined;
  if (!slot) throw new Error("That photo couldn't be uploaded.");
  const { error: upErr } = await supabase.storage.from("estimate-sources").uploadToSignedUrl(slot.path, slot.token, file);
  if (upErr) throw new Error("That photo couldn't be uploaded — try a smaller one.");
  const res = await fetch("/api/extract/photos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploads: [{ path: slot.path, name: `${o.label} — ${file.name}`.slice(0, 200) }], estimateId: o.estimateId, analyse: o.analyse }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "That photo couldn't be saved.");
  const ids: string[] = Array.isArray(j.sourceIds) ? j.sourceIds : [];
  const per = Array.isArray(j.perPhoto) ? j.perPhoto : [];
  return { sourceId: ids[0] ?? null, suggestion: per[0]?.suggestion ?? null };
}

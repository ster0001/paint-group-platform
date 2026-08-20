import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * R5: the documents a customer already gave us, put back in front of them.
 *
 * The scope editor asks people to confirm room sizes and surfaces from
 * memory while the floorplan they uploaded sixty seconds earlier is nowhere
 * on the page (Tom, 20 Aug: "add floorplan to screen view again as it's not
 * showing"). This reads the estimate's own `estimate_sources` rows and signs
 * short-lived URLs for them — the bucket is private, so a signed URL is the
 * only way a browser can see one.
 *
 * THE CUSTOMER'S OWN DOCUMENTS ONLY. Tom's ruling, 20 Aug: agency photos
 * scraped from a real-estate listing are not ours to put on file — only what
 * the customer uploaded themselves. Nothing here reads a listing.
 *
 * Ordering is deliberate: the floorplan a customer recognises is the plan
 * page, not the site plan, and never a photo. Condition photos follow in
 * upload order so the strip reads like their camera roll.
 */

/** How long a signed URL lives. Long enough to work a whole estimate
 * through without a refresh, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 3;

const PLAN_KINDS = ["floorplan", "site_plan"] as const;
const PHOTO_KINDS = ["defect_photo", "elevation"] as const;

export type EstimateDocument = { url: string; label: string; kind: string };
export type EstimateDocuments = {
  /** The pinned plan — a floorplan when there is one, else the first facade
   * elevation, so an exterior job still gets a picture of the house. */
  plan: EstimateDocument | null;
  /** Everything else on file: condition photos, extra elevations. */
  photos: EstimateDocument[];
};

const EMPTY: EstimateDocuments = { plan: null, photos: [] };

type SourceRow = {
  id: string; kind: string | null; storage_path: string | null;
  page_no: number | null; page_class: string | null;
};

function labelFor(row: SourceRow, index: number): string {
  switch (row.kind) {
    case "floorplan": return row.page_no && row.page_no > 1 ? `Floorplan · page ${row.page_no}` : "Your floorplan";
    case "site_plan": return "Site plan";
    case "elevation": return "Photo of the house";
    default: return `Photo ${index + 1}`;
  }
}

/**
 * Every document on file for one estimate, with signed URLs.
 *
 * Best-effort by design: a missing file or an expired bucket grant must
 * never take the scope editor down with it — the customer loses a picture,
 * not their estimate.
 */
export async function estimateDocuments(
  db: SupabaseClient,
  estimateId: string,
): Promise<EstimateDocuments> {
  try {
    const { data, error } = await db
      .from("estimate_sources")
      .select("id, kind, storage_path, page_no, page_class")
      .eq("estimate_id", estimateId)
      .order("page_no", { ascending: true, nullsFirst: false })
      .limit(40);
    if (error || !data?.length) return EMPTY;

    const rows = (data as SourceRow[]).filter((r) => !!r.storage_path);
    const plans = rows.filter((r) => PLAN_KINDS.includes(r.kind as typeof PLAN_KINDS[number]));
    const photos = rows.filter((r) => PHOTO_KINDS.includes(r.kind as typeof PHOTO_KINDS[number]));

    // An exterior job has no floorplan at all — the first facade photo is
    // the picture of the house, exactly as the submit route pins it.
    const planRow = plans[0] ?? photos.find((r) => r.kind === "elevation") ?? null;
    const stripRows = photos.filter((r) => r.id !== planRow?.id);

    const paths = [...(planRow ? [planRow] : []), ...stripRows].map((r) => r.storage_path as string);
    if (!paths.length) return EMPTY;

    const { data: signed } = await db.storage
      .from("estimate-sources")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
    const doc = (row: SourceRow, i: number): EstimateDocument | null => {
      const url = urlByPath.get(row.storage_path as string);
      return url ? { url, label: labelFor(row, i), kind: row.kind ?? "photo" } : null;
    };

    return {
      plan: planRow ? doc(planRow, 0) : null,
      photos: stripRows.map(doc).filter((d): d is EstimateDocument => d !== null),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Duplicating an estimate (Tom, 16 Sep 2026).
 *
 * A copy is a NEW DRAFT that starts with everything the builder owns —
 * blocks, modifiers, materials, colours, inclusions, discounts, the wizard's
 * answers — and none of what belonged to the original job:
 *
 *   - a new estimate number. The number on screen is the first eight
 *     characters of the row id, so a fresh row IS a fresh number; the share
 *     token (the customer's link and the "EST-…" reference) is minted by the
 *     builder on its first save, never copied.
 *   - the address reads "… (copy)" — on the row (the list shows
 *     `builder_state.jobAddress`) and in the title — so nobody sends the copy
 *     to the old address by mistake before Tom has typed the new one.
 *   - NO PHOTOS. The uploaded plan and photos (`estimate_sources`) stay with
 *     the original and are not linked to the copy, and every reference the
 *     builder state keeps to them (the photo sign-off, the plan-read run ids,
 *     the condition-photo ids, the signed plan preview) is cleared, so the
 *     copy cannot show, count or sign off pictures of the other house.
 *   - nothing the customer did carries over: not sent, not viewed, not
 *     accepted, no customer/property/account link, no snapshot. The contact
 *     details stay in the builder state as text so they can be kept or
 *     replaced — the account link is re-made on the first save if the email
 *     is kept (`linkEstimateAccountAction`).
 *
 * This module is pure: it turns the source row into the insert payload. The
 * server action in app/(app)/estimates/actions.ts does the reading, the
 * staff check and the insert.
 */

export const COPY_SUFFIX = " (copy)";

/** The columns the copy reads from the source row — the ones the builder writes. */
export const DUPLICATE_SELECT =
  "title, builder_state, rate_card_id, rate_card_version, level_of_finish, size_band, "
  + "subtotal_cents, total_cents, presentation_id, job_kind, storey_heights, requires_site_check, source";

export type DuplicateSource = {
  title: string | null;
  builder_state: unknown;
  rate_card_id: string | null;
  rate_card_version: number | null;
  level_of_finish: number | null;
  size_band: string | null;
  subtotal_cents: number | null;
  total_cents: number | null;
  presentation_id: string | null;
  job_kind: string | null;
  storey_heights: unknown;
  requires_site_check: boolean | null;
  source: string | null;
};

export type DuplicateInsert = {
  title: string;
  status: "draft";
  builder_state: Record<string, unknown>;
  rate_card_id: string | null;
  rate_card_version: number | null;
  level_of_finish: number | null;
  size_band: string | null;
  subtotal_cents: number;
  total_cents: number;
  presentation_id: string | null;
  job_kind: string;
  storey_heights: unknown;
  requires_site_check: boolean;
  source: string;
  created_by: string | null;
  share_token: null;
  sent_snapshot: null;
  sent_at: null;
  valid_until: null;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "12 Smith St" → "12 Smith St (copy)"; already a copy → "12 Smith St (copy 2)", then 3… */
export function copyName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? "").trim() || fallback;
  const m = base.match(/^(.*) \(copy(?: (\d+))?\)$/);
  if (!m) return base + COPY_SUFFIX;
  const n = m[2] ? Number(m[2]) + 1 : 2;
  return `${m[1]} (copy ${n})`;
}

/**
 * Every reference to a picture that rides `builder_state`, cleared. The
 * counts (`damagePhotoCount`, the snapshot's photo tally) are left alone:
 * they are answers the price was built on, not pictures, and zeroing one
 * would fail the wizard's "tier 2–3 needs evidence" parse on the copy.
 */
export function stripPhotoReferences(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  delete out.photoReview;
  if (isObject(out.wizard)) {
    const wizard: Record<string, unknown> = { ...out.wizard };
    if (isObject(wizard.state)) {
      const s: Record<string, unknown> = { ...wizard.state };
      if ("planRunIds" in s) s.planRunIds = [];
      if ("facadeRunIds" in s) s.facadeRunIds = [];
      if ("conditionSourceIds" in s) s.conditionSourceIds = [];
      if ("planPreviewUrl" in s) s.planPreviewUrl = null;
      wizard.state = s;
    }
    out.wizard = wizard;
  }
  return out;
}

export function buildDuplicate(src: DuplicateSource, opts: { createdBy: string | null }): DuplicateInsert {
  const loaded = isObject(src.builder_state) ? structuredClone(src.builder_state) : {};
  const state = stripPhotoReferences(loaded);

  // The address, as the list and the builder show it.
  const job = isObject(state.jobAddress) ? { ...state.jobAddress } : null;
  if (job && typeof job.address === "string" && job.address.trim()) {
    job.address = copyName(job.address, "");
    state.jobAddress = job;
  }

  return {
    title: copyName(src.title, "Untitled quote"),
    status: "draft",
    builder_state: state,
    rate_card_id: src.rate_card_id,
    rate_card_version: src.rate_card_version,
    level_of_finish: src.level_of_finish,
    size_band: src.size_band,
    subtotal_cents: src.subtotal_cents ?? 0,
    total_cents: src.total_cents ?? 0,
    presentation_id: src.presentation_id,
    job_kind: src.job_kind ?? "residential",
    storey_heights: src.storey_heights ?? null,
    requires_site_check: src.requires_site_check ?? false,
    source: src.source ?? "manual",
    created_by: opts.createdBy,
    share_token: null,
    sent_snapshot: null,
    sent_at: null,
    valid_until: null,
  };
}

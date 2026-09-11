import {
  estimateAction, estimatePill, estimateValue,
  type EstimateLoopView, type EstimatePill, type EstimateRequestView, type RowAction, type RowValue, type WizardJourney,
} from "@/lib/wizard/journey";
import { rangeBandPct, rangeFromTotal, type BandSettings } from "@/lib/wizard/policy";
import { isPhotoKind } from "@/lib/wizard/documents";

/**
 * C7b — one estimates-list row, assembled on the server from the records
 * that already exist. Pure: the page fetches, this decides, the table
 * renders. Nothing here is stored and nothing here prices.
 */

/** What the page's select returns for one estimate (embeds included). */
export type RawListRow = {
  id: string;
  title: string | null;
  status: string;
  total_cents: number | null;
  created_at: string;
  viewed_at: string | null;
  accepted_at: string | null;
  valid_until: string | null;
  source: string | null;
  account_id: string | null;
  /** `builder_state->wizard->state->>jobType` — present only on a wizard estimate. */
  wizard_job: string | null;
  /** `builder_state->wizard->snapshot` — the submit-time baseline (proving). */
  snapshot: { accuracyPct?: number } | null;
  requests: Array<{ kind: string; status: string; requested_at: string; suggested_action: string | null; fixed_price_cents: number | null }> | null;
  views: Array<{ updated_at: string }> | null;
  work_orders: Array<{ id: string }> | { id: string } | null;
  sources: Array<{ kind: string | null }> | null;
};

export type ListRow = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  viewed_at: string | null;
  source: string | null;
  /** The Pack tab exists for this row (same test the quote shell applies). */
  hasWizard: boolean;
  pill: EstimatePill;
  action: RowAction | null;
  value: RowValue;
  /** Kept for the journey drawer, which is unchanged. */
  wizard: WizardJourney | null;
};

/**
 * "Has wizard data" is the test the quote shell uses for the Pack tab —
 * `builder_state.wizard.state` being an object. The list reads one scalar
 * inside it rather than the whole object, because the state is large and the
 * list is long; a state with no `jobType` would hide the link here while the
 * shell still showed the tab, which is the safe direction to be wrong in.
 */
export function hasWizardData(raw: Pick<RawListRow, "wizard_job">): boolean {
  return typeof raw.wizard_job === "string" && raw.wizard_job.length > 0;
}

function latestRequest(raw: RawListRow): EstimateRequestView | null {
  const rows = raw.requests ?? [];
  if (rows.length === 0) return null;
  const r = [...rows].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  return {
    kind: r.kind as EstimateRequestView["kind"],
    status: r.status as EstimateRequestView["status"],
    requestedAt: r.requested_at,
    suggestedAction: (r.suggested_action as EstimateRequestView["suggestedAction"]) ?? null,
    fixedPriceCents: r.fixed_price_cents ?? null,
  };
}

export function buildListRow(
  raw: RawListRow,
  deps: {
    wizard: WizardJourney | null;
    /** From the blocks, when the page read them for this row; else null. */
    loop: EstimateLoopView | null;
    bands: BandSettings;
    now: Date;
  },
): ListRow {
  const hasWizard = hasWizardData(raw);
  const request = latestRequest(raw);
  const views = raw.views ?? [];
  const lastAt = views.reduce<string | null>((m, v) => (m == null || v.updated_at > m ? v.updated_at : m), null);
  const wo = Array.isArray(raw.work_orders) ? raw.work_orders[0] ?? null : raw.work_orders;
  const photos = (raw.sources ?? []).filter((s) => isPhotoKind(s.kind)).length;
  const acc = raw.snapshot?.accuracyPct;
  // The submit-time band: the list does not price, so it cannot know the
  // live one. The strip on the estimate does, and says so.
  const bandPct = hasWizard && typeof acc === "number" ? rangeBandPct(acc, deps.bands) : null;

  const pill = estimatePill({
    status: raw.status,
    acceptedAt: raw.accepted_at,
    viewedAt: raw.viewed_at,
    views: { count: views.length, lastAt },
    validUntil: raw.valid_until,
    hasWorkOrder: wo != null,
    request,
    wizard: deps.wizard,
    loop: deps.loop,
    photos,
    bandPct,
    brief: false, // C14
    now: deps.now,
  });
  const action = estimateAction({ pill: pill.state, request, estimateId: raw.id, accountId: raw.account_id, workOrderId: wo?.id ?? null });
  const value = estimateValue({ totalCents: raw.total_cents, status: raw.status, hasWizard, bandPct, request, range: rangeFromTotal });
  return {
    id: raw.id, title: raw.title, status: raw.status, created_at: raw.created_at, viewed_at: raw.viewed_at, source: raw.source,
    hasWizard, pill, action, value, wizard: deps.wizard,
  };
}

/**
 * The select string behind the list. In one place so the row type above and
 * the query cannot drift. The embeds ride the existing foreign keys; the two
 * JSON paths read one scalar and one small object out of `builder_state`
 * rather than the whole tree.
 */
export const LIST_SELECT =
  "id, title, status, total_cents, created_at, viewed_at, accepted_at, valid_until, source, account_id, "
  + "wizard_job:builder_state->wizard->state->>jobType, snapshot:builder_state->wizard->snapshot, "
  + "requests:confirmation_requests(kind, status, requested_at, suggested_action, fixed_price_cents), "
  + "views:estimate_views(updated_at), work_orders(id), sources:estimate_sources(kind)";

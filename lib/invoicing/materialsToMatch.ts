/**
 * "A materials invoice that still needs matching to a job" — ONE predicate,
 * read by the /invoicing Payables tile and the home dashboard tile so the two
 * can never disagree (Tom, 20 Sep 2026: "number of invoices to match only").
 *
 * The evidence: `material_costs.work_order_id` is null until a person (or the
 * intake's auto-match) assigns the job — `material_cost_assign` refuses with
 * `already_matched` once it is set (20261122000000_cost_intake.sql), the
 * partial index `material_costs_unmatched_idx … where work_order_id is null`
 * (20261112000000_invoicing_core.sql) names the same state, and the Payables
 * "Materials without a job" card reads `.is("work_order_id", null)`
 * (app/invoicing/data.ts). `matched_at` is bookkeeping about HOW it was
 * matched, not whether — a row imported from Airtable with a job carries no
 * `matched_at` and needs nothing.
 */
export type MaterialToMatch = {
  id: string;
  work_order_id: string | null;
  supplier: string;
  amount_cents: number;
  invoice_date: string | null;
  order_ref: string;
  address_text: string;
  created_at: string;
  /** Payments merge Step 6 (20270259): a person said "not for a job" — overhead, nothing to match. */
  overhead?: boolean | null;
};

export function needsMatching(row: Pick<MaterialToMatch, "work_order_id" | "overhead">): boolean {
  return row.work_order_id == null && row.overhead !== true;
}

/** The rows that still need a job, newest received first. */
export function materialsToMatch<T extends Pick<MaterialToMatch, "work_order_id" | "created_at" | "overhead">>(rows: readonly T[]): T[] {
  return rows.filter(needsMatching).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Where the home tile sends a click: Payments → Materials, at the "No job yet" list (8c). */
export const MATERIALS_TO_MATCH_HREF = "/invoicing?tab=mat#no-job";

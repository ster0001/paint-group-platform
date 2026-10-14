import type { SupabaseClient } from "@supabase/supabase-js";
import { jobCode } from "@/lib/costs/intake";
import { COST_DOCS_BUCKET } from "@/lib/costs/store";
import type { ExpenseItem, ExpenseQueues } from "@/lib/invoicing/expenses";
import type { ReadFailure } from "@/lib/invoicing/loadFailure";
import { reportError } from "@/lib/monitoring/report";
import { loadExpenseQueues } from "../data";

/**
 * The expense queues for the Contractors tab (Payments merge 8b), from the same
 * loader the old Payables tab read (`loadExpenseQueues`). Receipt links are
 * signed for ten minutes, and only when the tab is open.
 */
export async function loadExpenses(supabase: SupabaseClient, withReceipts: boolean): Promise<{ queues: ExpenseQueues; failure: ReadFailure | null }> {
  const q = await loadExpenseQueues(supabase);
  const urls = new Map<string, string>();
  const paths = [...new Set(q.expenses.map((e) => e.receipt_path).filter((p): p is string => !!p))];
  if (withReceipts && paths.length) {
    const { data, error } = await supabase.storage.from(COST_DOCS_BUCKET).createSignedUrls(paths, 600);
    if (error) reportError(error, { where: "loadExpenses.receipts", bestEffort: true });
    for (const s of data ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
  }
  const where = (category: string | null, wo: { job_no: number | null; job_address: string | null } | null) =>
    [category ? category.replaceAll("_", " ") : null, jobCode(wo?.job_no ?? null) || null, wo?.job_address ?? null].filter(Boolean).join(" · ");
  const base = { note: null, overThreshold: false, receiptUrl: null, description: null } satisfies Partial<ExpenseItem>;
  return {
    failure: q.loadError,
    queues: {
      claims: q.expenses.map((e) => ({
        ...base, id: e.id, who: e.contractors?.company_name || "Contractor", ref: where(e.category, e.work_orders),
        estimateId: e.work_orders?.estimate_id ?? null, amountCents: e.amount_cents, note: e.note || null,
        overThreshold: !!e.over_threshold_unapproved, receiptUrl: e.receipt_path ? urls.get(e.receipt_path) ?? null : null,
      })),
      asks: q.preapprovals.map((p) => ({
        ...base, id: p.id, who: p.contractors?.company_name || "Contractor", ref: where(null, p.work_orders),
        estimateId: p.work_orders?.estimate_id ?? null, amountCents: p.est_cents, description: p.description || null,
      })),
      paybacks: q.reimbursements.map((r) => ({
        ...base, id: r.id, who: r.contractors?.profiles?.name || r.contractors?.company_name || "An employee", ref: where(r.category, r.work_orders),
        estimateId: r.work_orders?.estimate_id ?? null, amountCents: r.amount_cents, note: r.note || null,
      })),
    },
  };
}

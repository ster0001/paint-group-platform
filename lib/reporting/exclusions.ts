/**
 * Estimates left out of the dashboard (migration 20270184, Tom 20 Sep 2026):
 * test jobs, and the Airtable history rows that duplicate a PaintScout booked
 * job. ONE read, applied to every slice the loaders fill, so a marked job is
 * gone from Sales, the target, P&L, PC Command, Contractors, Invoicing and the
 * funnel together — never from some tiles and not others. SERVER ONLY.
 *
 * A failed read is a load failure the page shows, never an empty set that
 * quietly counts everything (the 16 Sep invoicing lesson).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { inSlices } from "@/lib/supabase/inSlices";

export type ReportingExclusions = {
  estimateIds: ReadonlySet<string>;
  workOrderIds: ReadonlySet<string>;
  woRefs: ReadonlySet<string>;
  invoiceIds: ReadonlySet<string>;
};

export const NO_EXCLUSIONS: ReportingExclusions = { estimateIds: new Set(), workOrderIds: new Set(), woRefs: new Set(), invoiceIds: new Set() };

export async function loadReportingExclusions(supabase: SupabaseClient): Promise<{ exclusions: ReportingExclusions; error: { message: string } | null }> {
  const ests = await supabase.from("estimates").select("id").not("reporting_excluded_at", "is", null).limit(5000);
  if (ests.error) return { exclusions: NO_EXCLUSIONS, error: ests.error };
  const estimateIds = new Set(((ests.data ?? []) as { id: string }[]).map((e) => e.id));
  if (estimateIds.size === 0) return { exclusions: NO_EXCLUSIONS, error: null };
  const ids = [...estimateIds];
  const [wos, invs] = await Promise.all([
    inSlices(ids, (s) => supabase.from("work_orders").select("id, wo_ref").in("estimate_id", s)),
    inSlices(ids, (s) => supabase.from("invoices").select("id").in("estimate_id", s)),
  ]);
  if (wos.error) return { exclusions: NO_EXCLUSIONS, error: { message: wos.error.message ?? "work orders behind excluded estimates" } };
  if (invs.error) return { exclusions: NO_EXCLUSIONS, error: { message: invs.error.message ?? "invoices behind excluded estimates" } };
  const woRows = (wos.rows ?? []) as { id: string; wo_ref: string }[];
  return {
    exclusions: {
      estimateIds,
      workOrderIds: new Set(woRows.map((w) => w.id)),
      woRefs: new Set(woRows.map((w) => w.wo_ref)),
      invoiceIds: new Set(((invs.rows ?? []) as { id: string }[]).map((i) => i.id)),
    },
    error: null,
  };
}

/** The rows of `xs` whose `key` is not in the set — the one filter every slice uses. */
export function without<T>(xs: readonly T[] | undefined | null, key: (x: T) => string | null | undefined, set: ReadonlySet<string>): T[] {
  if (!xs) return [];
  if (set.size === 0) return [...xs];
  return xs.filter((x) => { const k = key(x); return !k || !set.has(k); });
}

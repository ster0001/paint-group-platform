import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshStaleFacts } from "./facts";

// SERVER ONLY.
/**
 * CRM v2 P1 — the daily CRM sweep (vercel.json `/api/cron/crm-sweep`).
 *
 * Two jobs, in this order:
 *   1. Lapse: sent estimates past their valid_until become `expired`
 *      (crm_lapse_estimates). The lifecycle trigger writes `estimate_lapsed`,
 *      which is a Today item that asks a person — decision 8.11, lapsed ≠ lost.
 *   2. Refresh: every stale crm_account_facts row gets recomputed, in batches,
 *      inside a time budget. Whatever is left is picked up next run or by the
 *      opportunistic refresh on CRM reads.
 *
 * Hobby plan: once a day. Pro (decision 8.9): every 30 minutes, same code.
 */
export type CrmSweepResult = { lapsed: number; refreshed: number; remaining: number; batches: number; ms: number };

export async function runCrmSweep(db: SupabaseClient, opts: { budgetMs?: number; batch?: number; now?: Date } = {}): Promise<CrmSweepResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const now = opts.now ?? new Date();

  const { data: lapsedCount, error } = await db.rpc("crm_lapse_estimates");
  if (error) throw new Error(`lapse failed: ${error.message}`);
  const lapsed = typeof lapsedCount === "number" ? lapsedCount : 0;

  let refreshed = 0, remaining = 0, batches = 0;
  do {
    const r = await refreshStaleFacts(db, opts.batch ?? 300, now);
    refreshed += r.refreshed;
    remaining = r.remaining;
    batches += 1;
    if (r.refreshed === 0) break;
  } while (remaining > 0 && Date.now() - started < budget);

  return { lapsed, refreshed, remaining, batches, ms: Date.now() - started };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import type { WorkerSummary } from "@/app/portal/WorkersCard";

/**
 * A contractor's crew, for their screens (RLS: the owner reads their own
 * contractor_users rows and the shares on their own jobs). Removed workers are
 * left out; with a job id each worker carries whether that job is shared.
 */
export async function loadWorkers(supabase: SupabaseClient, contractorId: string, workOrderId?: string | null): Promise<{ workers: WorkerSummary[]; error: string | null }> {
  const { data, error } = await supabase.from("contractor_users")
    .select("id, name, mobile, inducted_at, last_link_sent_at")
    .eq("contractor_id", contractorId).eq("role", "worker").is("removed_at", null).order("created_at");
  if (error) { reportError(error, { where: "workers.load", extra: { contractorId } }); return { workers: [], error: "Couldn't load your crew — it has been reported." }; }
  type Row = { id: string; name: string; mobile: string; inducted_at: string | null; last_link_sent_at: string | null };
  const rows = (data ?? []) as Row[];
  let shared = new Set<string>();
  if (workOrderId && rows.length > 0) {
    const { data: s, error: sErr } = await supabase.from("wo_worker_shares").select("contractor_user_id")
      .eq("work_order_id", workOrderId).is("unshared_at", null);
    if (sErr) reportError(sErr, { where: "workers.shares", bestEffort: true, extra: { workOrderId } });
    shared = new Set(((s ?? []) as { contractor_user_id: string }[]).map((x) => x.contractor_user_id));
  }
  return {
    workers: rows.map((r) => ({ id: r.id, name: r.name, mobile: r.mobile, inductedAt: r.inducted_at, lastLinkSentAt: r.last_link_sent_at, ...(workOrderId ? { shared: shared.has(r.id) } : {}) })),
    error: null,
  };
}

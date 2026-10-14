import { createClient } from "@/lib/supabase/server";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { reportError } from "@/lib/monitoring/report";
import type { ContractorJob } from "./jobs";

/**
 * A WORKER's jobs (induction Step 3a, ruling 13): the ones their contractor
 * shared, through the money-free RPC `worker_jobs` (20270264). No row of
 * work_orders is ever read by a worker session; the document arrives with
 * every money key stripped in SQL (jsonb_strip_money), and nothing here puts
 * one back. The shape is ContractorJob so the job list and the job page keep
 * ONE component tree — a worker is a mode, not a fork.
 */
export type WorkerJobRow = {
  work_order_id: string; wo_ref: string; stage: string; status: string;
  issued_at: string | null; viewed_at: string | null;
  job_start: string | null; job_end: string | null; shared_at: string;
  is_demo: boolean; walkthrough_required: boolean; colours: Record<string, unknown>;
  doc: unknown; contractor_name: string;
};

export type WorkerJob = ContractorJob & { stage: string; contractorName: string; sharedAt: string };

function toWorkerJob(r: WorkerJobRow): WorkerJob {
  const snap = r.doc as WorkOrderDoc | null;
  const doc = snap && (snap as Partial<WorkOrderDoc>).version === 1
    ? { ...snap, status: r.status ?? snap.status, startDate: r.job_start ?? snap.startDate, contactPhone: "", contractorPaymentCents: 0 }
    : null;
  return {
    id: r.work_order_id,
    woRef: r.wo_ref,
    status: r.status,
    startDate: r.job_start,
    endDate: r.job_end,
    issuedAt: r.issued_at,
    viewedAt: r.viewed_at,
    paymentCents: null,
    committed: true,
    isDemo: r.is_demo === true,
    surfacesDone: 0,
    surfacesTotal: doc ? doc.areas.flatMap((a) => a.surfaces).length : 0,
    doc,
    stage: r.stage,
    contractorName: r.contractor_name,
    sharedAt: r.shared_at,
  };
}

async function withProgress(jobs: WorkerJob[]): Promise<WorkerJob[]> {
  if (jobs.length === 0) return jobs;
  const supabase = await createClient();
  // The shared jobs' tick rows, readable through the visibility view (20270264).
  const { data, error } = await supabase.from("wo_surfaces").select("work_order_id, state")
    .in("work_order_id", jobs.map((j) => j.id)).eq("removed_from_scope", false);
  if (error) { reportError(error, { where: "workerJobs.progress", bestEffort: true }); return jobs; }
  const done = new Map<string, number>(); const total = new Map<string, number>();
  for (const r of (data ?? []) as { work_order_id: string; state: string }[]) {
    total.set(r.work_order_id, (total.get(r.work_order_id) ?? 0) + 1);
    if (r.state === "done") done.set(r.work_order_id, (done.get(r.work_order_id) ?? 0) + 1);
  }
  return jobs.map((j) => total.has(j.id) ? { ...j, surfacesDone: done.get(j.id) ?? 0, surfacesTotal: total.get(j.id) ?? 0 } : j);
}

export async function listWorkerJobs(): Promise<{ jobs: WorkerJob[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_jobs", { p_work_order_id: null });
  if (error) { reportError(error, { where: "workerJobs.list" }); return { jobs: [], error: "Couldn't load your jobs — it has been reported." }; }
  return { jobs: await withProgress(((data as WorkerJobRow[] | null) ?? []).map(toWorkerJob)), error: null };
}

export async function getWorkerJob(id: string): Promise<WorkerJob | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_jobs", { p_work_order_id: id });
  if (error) { reportError(error, { where: "workerJobs.one", extra: { id } }); return null; }
  const row = ((data as WorkerJobRow[] | null) ?? [])[0];
  if (!row) return null;
  const [job] = await withProgress([toWorkerJob(row)]);
  return job;
}

/** True when the document carries no money key at all — asserted in e2e, kept callable for a test. */
export function docHasNoMoney(doc: unknown): boolean {
  const re = /cents|price|rate|margin|total|payment|cost/i;
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.every(walk);
    if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).every(([k, x]) => !re.test(k) && walk(x));
    return true;
  };
  return walk(doc);
}

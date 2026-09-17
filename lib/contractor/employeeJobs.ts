import { createClient } from "@/lib/supabase/server";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { reportIfError } from "@/lib/monitoring/report";
import type { ContractorJob, EmployeeAssignment } from "./jobs";

/**
 * The employed painter's jobs (Session 3). SERVER ONLY.
 *
 * An employee has no row-level read on work_orders (20270153), so their jobs
 * arrive through `employee_jobs()` — a SECURITY DEFINER function that returns
 * the `view=employee` shape: the document with every money key stripped in
 * SQL, their own dates, the lead flag, the Accept stamp and a time budget.
 * The result is mapped onto the SAME ContractorJob shape the portal already
 * renders, so no screen is forked; `assignment` is set and `paymentCents` is
 * null, and the pages branch on `capabilities`, never on the shape.
 *
 * Reuse, don't fork (brief §5.2): jobs/page, calendar/page, jobs/[id]/page
 * all take a ContractorJob. This is the other loader for that type.
 */

type EmployeeJobRow = {
  work_order_id: string; wo_ref: string; stage: string; status: string;
  issued_at: string | null; viewed_at: string | null;
  job_start: string | null; job_end: string | null; my_start: string; my_end: string;
  assignment_id: string; is_lead: boolean; accepted_at: string | null; crew_size: number;
  walkthrough_required: boolean; colours: Record<string, unknown>; doc: unknown;
  budget_hours: number | string | null; budget_days: number | null;
};

function toEmployeeJob(r: EmployeeJobRow): ContractorJob {
  const snap = r.doc as Partial<WorkOrderDoc> | null;
  // The stripped document has no contractorPaymentCents by construction; the
  // WorkOrderDoc type still declares it. The employee variant of the renderer
  // never reads it, and the cast is the one place that fact is stated.
  const doc = snap && snap.version === 1
    ? ({ ...snap, status: r.status, startDate: r.job_start ?? snap.startDate ?? null } as WorkOrderDoc)
    : null;
  const assignment: EmployeeAssignment = {
    assignmentId: r.assignment_id,
    isLead: r.is_lead,
    acceptedAt: r.accepted_at,
    crewSize: r.crew_size,
    myStart: r.my_start,
    myEnd: r.my_end,
    stage: r.stage,
    walkthroughRequired: r.walkthrough_required,
    colours: r.colours ?? {},
    timeBudget: { days: r.budget_days ?? 1, hours: Number(r.budget_hours ?? 0) },
  };
  return {
    id: r.work_order_id,
    woRef: r.wo_ref,
    status: r.status,
    // The calendar and the job page show THEIR days, not the job's whole span.
    startDate: r.my_start,
    endDate: r.my_end,
    issuedAt: r.issued_at,
    viewedAt: r.viewed_at,
    paymentCents: null,
    // Assigned is committed: the office put them on it, there is no offer to
    // protect an address from (the privacy gate is for open offers).
    committed: true,
    surfacesDone: 0,
    surfacesTotal: doc ? doc.areas.flatMap((a) => a.surfaces).length : 0,
    doc,
    assignment,
  };
}

async function withProgress(
  supabase: Awaited<ReturnType<typeof createClient>>, jobs: ContractorJob[],
): Promise<ContractorJob[]> {
  const ids = jobs.map((j) => j.id);
  if (ids.length === 0) return jobs;
  const { data, error } = await supabase.from("wo_surfaces").select("work_order_id, state").in("work_order_id", ids);
  reportIfError({ error }, { where: "employeeJobs.progress", bestEffort: true });
  const tally = new Map<string, { done: number; total: number }>();
  for (const row of ((data ?? []) as { work_order_id: string; state: string }[])) {
    const t = tally.get(row.work_order_id) ?? { done: 0, total: 0 };
    t.total += 1;
    if (row.state === "done") t.done += 1;
    tally.set(row.work_order_id, t);
  }
  return jobs.map((j) => {
    const t = tally.get(j.id);
    return t ? { ...j, surfacesDone: t.done, surfacesTotal: t.total } : j;
  });
}

export async function listEmployeeJobs(): Promise<ContractorJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("employee_jobs", { p_work_order_id: null });
  // A refused read is a broken screen, not an empty list — say so upstream.
  reportIfError({ error }, { where: "employeeJobs.list", bestEffort: true });
  const rows = ((error ? [] : data) ?? []) as EmployeeJobRow[];
  return withProgress(supabase, rows.map(toEmployeeJob));
}

export async function getEmployeeJob(workOrderId: string): Promise<ContractorJob | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("employee_jobs", { p_work_order_id: workOrderId });
  reportIfError({ error }, { where: "employeeJobs.one", bestEffort: true });
  const row = (((error ? [] : data) ?? []) as EmployeeJobRow[])[0];
  if (!row) return null;
  const [job] = await withProgress(supabase, [toEmployeeJob(row)]);
  return job;
}

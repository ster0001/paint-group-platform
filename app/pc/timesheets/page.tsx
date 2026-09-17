import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { allocatedHours, melbourneClock, workedHours } from "@/lib/timesheets/hours";
import TimesheetRow, { type TimesheetRowProp } from "./TimesheetRow";
import RecordHours, { type PainterOption } from "./RecordHours";

export const dynamic = "force-dynamic";

const melbourneDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const shiftDays = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type EntryRow = {
  id: string; contractor_id: string; work_order_id: string; work_date: string; started_at: string; finished_at: string | null;
  break_minutes: number; source: "painter" | "pc"; status: "open" | "submitted" | "approved" | "rejected";
  approved_at: string | null; rejected_reason: string;
  contractors: { profiles: { name: string | null } | null } | null;
  work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string } | null } | null;
};

/**
 * Employed painters — Session 6: the days waiting on the office. Approve
 * posts ONE labour line to the job at hours × the painter's cost rate on
 * that day; reject sends the reason back to the painter. Below: the office's
 * own entry form, allocated-vs-actual per job, and the payroll CSV (hours
 * only — the platform never calculates pay).
 */
export default async function TimesheetsPage() {
  const supabase = await createClient();
  const today = melbourneDay(new Date());
  const select = "id, contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status, approved_at, rejected_reason, contractors(profiles(name)), work_orders(wo_ref, wo_snapshot)";

  const [pending, decided, employees, assignments, rates] = await Promise.all([
    supabase.from("timesheet_entries").select(select).in("status", ["open", "submitted"]).order("work_date", { ascending: true }).order("started_at", { ascending: true }),
    supabase.from("timesheet_entries").select(select).in("status", ["approved", "rejected"]).gte("work_date", shiftDays(today, -60)).order("work_date", { ascending: false }).limit(200),
    supabase.from("contractors").select("id, profiles(name)").eq("employment_type", "employee").eq("active", true),
    supabase.from("wo_assignments").select("contractor_id, work_order_id, work_orders(wo_ref, wo_snapshot, stage)").neq("status", "released"),
    supabase.from("employee_cost_rates").select("contractor_id, effective_from").lte("effective_from", today),
  ]);
  const failures: string[] = [];
  for (const [label, r] of [["timesheets", pending], ["decided timesheets", decided], ["employees", employees], ["assignments", assignments], ["cost rates", rates]] as const) {
    if (r.error) { reportError(r.error, { where: `pc.timesheets.${label}` }); failures.push(label); }
  }

  const ratedFrom = new Map<string, string>();
  for (const r of (rates.data ?? []) as { contractor_id: string; effective_from: string }[]) {
    const prev = ratedFrom.get(r.contractor_id);
    if (!prev || r.effective_from < prev) ratedFrom.set(r.contractor_id, r.effective_from);
  }
  const toProp = (r: EntryRow): TimesheetRowProp => ({
    id: r.id, painter: r.contractors?.profiles?.name?.trim() || "Employee",
    woRef: r.work_orders?.wo_ref ?? "", jobTitle: r.work_orders?.wo_snapshot?.jobTitle ?? "",
    workDate: r.work_date, start: melbourneClock(r.started_at), finish: r.finished_at ? melbourneClock(r.finished_at) : null,
    breakMinutes: r.break_minutes, hours: workedHours(r.started_at, r.finished_at, r.break_minutes),
    source: r.source, status: r.status, rejectedReason: r.rejected_reason,
    // A rate set AFTER the work day does not price it — the RPC refuses, and the row says so up front.
    rateMissing: !(ratedFrom.get(r.contractor_id) && ratedFrom.get(r.contractor_id)! <= r.work_date),
  });
  const pendingRows = ((pending.data ?? []) as unknown as EntryRow[]).map(toProp);
  const decidedRows = ((decided.data ?? []) as unknown as EntryRow[]);

  // Allocated vs actual — approved hours per job against the document's hours.
  type AssignRow = { contractor_id: string; work_order_id: string; work_orders: { wo_ref: string; wo_snapshot: unknown; stage: string } | null };
  const assignRows = (assignments.data ?? []) as unknown as AssignRow[];
  const byJob = new Map<string, { woRef: string; title: string; allocated: number; actual: number }>();
  for (const r of decidedRows) {
    if (r.status !== "approved") continue;
    const h = workedHours(r.started_at, r.finished_at, r.break_minutes) ?? 0;
    const cur = byJob.get(r.work_order_id) ?? {
      woRef: r.work_orders?.wo_ref ?? "", title: r.work_orders?.wo_snapshot?.jobTitle ?? "",
      allocated: allocatedHours(r.work_orders?.wo_snapshot ?? null), actual: 0,
    };
    cur.actual = Math.round((cur.actual + h) * 100) / 100;
    byJob.set(r.work_order_id, cur);
  }

  // The office's entry form: employees and the jobs each is on.
  const jobsFor = new Map<string, { id: string; label: string }[]>();
  for (const a of assignRows) {
    if (!a.work_orders || a.work_orders.stage === "closed") continue;
    const snap = a.work_orders.wo_snapshot as { jobTitle?: string } | null;
    const list = jobsFor.get(a.contractor_id) ?? [];
    if (!list.some((j) => j.id === a.work_order_id)) list.push({ id: a.work_order_id, label: `${a.work_orders.wo_ref} · ${snap?.jobTitle ?? ""}`.trim() });
    jobsFor.set(a.contractor_id, list);
  }
  const painters: PainterOption[] = ((employees.data ?? []) as unknown as { id: string; profiles: { name: string | null } | null }[])
    .map((e) => ({ id: e.id, name: e.profiles?.name?.trim() || "Employee", jobs: jobsFor.get(e.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const fortnightFrom = shiftDays(today, -13);
  const lastWeekFrom = shiftDays(today, -6);

  return (
    <>
      <div>
        <h1>Timesheets waiting on you.</h1>
        <p className="lede">
          Each day an employed painter clocked. Approve posts the hours to the job at their cost rate;
          the painter only ever sees the hours. Payroll takes the CSV.
        </p>
      </div>

      {failures.length > 0 && (
        <p className="note" data-testid="timesheets-read-failure">
          Couldn&rsquo;t read {failures.join(", ")} — what&rsquo;s shown may be incomplete. It has been reported.
        </p>
      )}

      <div className="sect">
        <div className="stack" data-testid="timesheets">
          {pendingRows.map((row) => <TimesheetRow key={row.id} {...row} />)}
          {pendingRows.length === 0 && (
            <p className="empty" data-testid="timesheets-empty">Nothing waiting. Days appear here when a painter taps Finish day.</p>
          )}
        </div>
      </div>

      <div className="sect">
        <div className="card">
          <h3>Record a day for a painter <em>a forgotten tap, a paper sheet</em></h3>
          <RecordHours painters={painters} today={today} />
        </div>
      </div>

      <div className="sect">
        <div className="card" data-testid="allocated-vs-actual">
          <h3>Allocated vs actual <em>approved hours, last 60 days</em></h3>
          {byJob.size === 0 ? (
            <p className="empty">No approved days yet.</p>
          ) : (
            <div className="stack" style={{ marginTop: 10 }}>
              {[...byJob.entries()].map(([woId, j]) => {
                const over = j.allocated > 0 && j.actual > j.allocated;
                return (
                  <div className="row" key={woId} data-testid={`ava-${woId}`} style={{ alignItems: "baseline", gap: 14 }}>
                    <span style={{ minWidth: 220 }}>{j.title || j.woRef} <em style={{ fontStyle: "normal", color: "var(--muted)", fontSize: 11 }}>{j.woRef}</em></span>
                    <span className="mi"><span>Allocated</span><b>{j.allocated.toFixed(1)} h</b></span>
                    <span className="mi"><span>Actual</span><b style={{ color: over ? "var(--amber)" : "var(--emerald)" }} data-testid={`ava-actual-${woId}`}>{j.actual.toFixed(1)} h</b></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="sect">
        <div className="card" data-testid="payroll-export">
          <h3>Payroll CSV <em>approved days · hours only</em></h3>
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn" href={`/pc/timesheets/export?from=${lastWeekFrom}&to=${today}`} data-testid="export-week">Last 7 days</a>
            <a className="btn" href={`/pc/timesheets/export?from=${fortnightFrom}&to=${today}`} data-testid="export-fortnight">Last 14 days</a>
          </div>
          <p className="note">Painter, job, date, start, finish, break, hours. No rate and no pay — payroll works those out.</p>
        </div>
      </div>
    </>
  );
}

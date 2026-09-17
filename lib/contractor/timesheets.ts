import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import type { TimesheetEntry, TimesheetStatus } from "@/lib/timesheets/hours";

/**
 * The employed painter's own timesheet (Session 6). SERVER ONLY.
 *
 * Read through the painter's session: the `timesheet_entries_own` policy
 * (20270163) scopes the table to their rows, and the table carries no money
 * — hours only. The cost rate lives on a staff-only table this never joins.
 */

type Row = {
  id: string; contractor_id: string; work_order_id: string; work_date: string;
  started_at: string; finished_at: string | null; break_minutes: number;
  source: "painter" | "pc"; status: TimesheetStatus; approved_at: string | null; rejected_reason: string;
};

export type MyTimesheet = {
  /** The day in progress, if one is. */
  open: TimesheetEntry | null;
  /** The last fortnight, newest first — the open day included. */
  recent: TimesheetEntry[];
  /** A refused read is said, never rendered as "no hours". */
  error: string | null;
};

const toEntry = (r: Row): TimesheetEntry => ({
  id: r.id, contractorId: r.contractor_id, workOrderId: r.work_order_id, workDate: r.work_date,
  startedAt: r.started_at, finishedAt: r.finished_at, breakMinutes: r.break_minutes,
  source: r.source, status: r.status, approvedAt: r.approved_at, rejectedReason: r.rejected_reason,
});

export async function loadMyTimesheet(workOrderId?: string): Promise<MyTimesheet> {
  const supabase = await createClient();
  let q = supabase.from("timesheet_entries")
    .select("id, contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status, approved_at, rejected_reason")
    .order("started_at", { ascending: false })
    .limit(14);
  if (workOrderId) q = q.eq("work_order_id", workOrderId);
  const { data, error } = await q;
  if (error) {
    reportError(error, { where: "portal.timesheets.load" });
    return { open: null, recent: [], error: "Your hours couldn't be loaded just now — pull down to refresh." };
  }
  const recent = ((data ?? []) as Row[]).map(toEntry);
  // The open day is the painter's, whichever job it is on — asked for
  // separately when the list above is scoped to one job.
  let open = recent.find((e) => e.status === "open") ?? null;
  if (!open && workOrderId) {
    const { data: o, error: oErr } = await supabase.from("timesheet_entries")
      .select("id, contractor_id, work_order_id, work_date, started_at, finished_at, break_minutes, source, status, approved_at, rejected_reason")
      .eq("status", "open").maybeSingle();
    if (oErr) reportError(oErr, { where: "portal.timesheets.open" });
    else if (o) open = toEntry(o as Row);
  }
  return { open, recent, error: null };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";
import { payrollCsv, type PayrollRow } from "@/lib/timesheets/hours";

export const dynamic = "force-dynamic";

/**
 * Employed painters — Session 6: the payroll CSV. Approved entries in the
 * range, hours only: painter, job, date, start, finish, break, hours. No
 * rate, no pay, no cost — payroll/MYOB owns the money side (brief §3.8).
 * Staff only; a failed read is a 503, never an empty file that reads as
 * "no hours this fortnight".
 */
export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return new NextResponse("Not found", { status: 404 });

  const url = new URL(req.url);
  const parsed = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return new NextResponse("from and to (YYYY-MM-DD) are required", { status: 400 });
  const { from, to } = parsed.data;

  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("work_date, started_at, finished_at, break_minutes, source, approved_at, contractors(profiles(name)), work_orders(wo_ref)")
    .eq("status", "approved").gte("work_date", from).lte("work_date", to)
    .order("work_date", { ascending: true }).order("started_at", { ascending: true });
  if (error) {
    reportError(error, { where: "timesheets.export" });
    return new NextResponse("Unavailable", { status: 503 });
  }
  type Row = {
    work_date: string; started_at: string; finished_at: string; break_minutes: number; source: "painter" | "pc"; approved_at: string;
    contractors: { profiles: { name: string | null } | null } | null; work_orders: { wo_ref: string } | null;
  };
  const rows: PayrollRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    painter: r.contractors?.profiles?.name?.trim() || "Employee",
    woRef: r.work_orders?.wo_ref ?? "",
    workDate: r.work_date, startedAt: r.started_at, finishedAt: r.finished_at,
    breakMinutes: r.break_minutes, source: r.source, approvedAt: r.approved_at,
  }));
  return new NextResponse(payrollCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paint-group-timesheets-${from}-to-${to}.csv"`,
    },
  });
}

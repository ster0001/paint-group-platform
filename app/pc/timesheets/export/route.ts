import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";
import { payrollCsv, type PayrollBonusRow, type PayrollRow } from "@/lib/timesheets/hours";
import { melbourneInstant } from "@/lib/time/businessHours";

export const dynamic = "force-dynamic";

/**
 * Employed painters — Session 6: the payroll CSV. Approved entries in the
 * range, hours only: painter, job, date, start, finish, break, hours. No
 * rate, no pay, no cost — payroll/MYOB owns the money side (brief §3.8).
 * Staff only; a failed read is a 503, never an empty file that reads as
 * "no hours this fortnight".
 */
/** Midnight Melbourne on a YYYY-MM-DD day (+ n days), as an instant — the offset comes from the zone, never written down. */
function melbStart(day: string, plusDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return melbourneInstant(y, m, d + plusDays, 0, 0);
}

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
    work_date: string; started_at: string; finished_at: string; break_minutes: number; source: "painter" | "pc" | "auto"; approved_at: string;
    contractors: { profiles: { name: string | null } | null } | null; work_orders: { wo_ref: string } | null;
  };
  const rows: PayrollRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    painter: r.contractors?.profiles?.name?.trim() || "Employee",
    woRef: r.work_orders?.wo_ref ?? "",
    workDate: r.work_date, startedAt: r.started_at, finishedAt: r.finished_at,
    breakMinutes: r.break_minutes, source: r.source, approvedAt: r.approved_at,
  }));
  // Painter status Step 7 (⚑11): approved bonuses for employed painters, decided in the range.
  const bonusRes = await supabase.from("painter_bonuses")
    .select("decided_at, amount_cents, contractors!inner(employment_type, profiles(name)), work_orders:trigger_wo_id(wo_ref)")
    .in("status", ["approved", "paid"]).gte("decided_at", melbStart(from).toISOString()).lt("decided_at", melbStart(to, 1).toISOString())
    .eq("contractors.employment_type", "employee");
  if (bonusRes.error) {
    reportError(bonusRes.error, { where: "timesheets.export.bonuses" });
    return new NextResponse("Unavailable", { status: 503 });
  }
  type BRow = { decided_at: string; amount_cents: number | null; contractors: { employment_type: string; profiles: { name: string | null } | null } | null; work_orders: { wo_ref: string } | null };
  const bonuses: PayrollBonusRow[] = ((bonusRes.data ?? []) as unknown as BRow[]).map((b) => ({
    painter: b.contractors?.profiles?.name?.trim() || "Employee", woRef: b.work_orders?.wo_ref ?? "",
    decidedOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(b.decided_at)),
    amountCents: b.amount_cents ?? 0, approvedAt: b.decided_at,
  }));
  return new NextResponse(payrollCsv(rows, bonuses), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paint-group-timesheets-${from}-to-${to}.csv"`,
    },
  });
}

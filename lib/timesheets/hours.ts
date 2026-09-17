/**
 * Employed painters — Session 6: the hours arithmetic, in one place.
 *
 * The database is the source of truth (`timesheet_hours()` in
 * 20270163000000_timesheets.sql posts the labour line); these mirror it so a
 * screen can preview what approval will do and the CSV can be checked
 * against it. The platform never calculates PAY — a rate here is the
 * office's internal cost per hour, and it never reaches a painter payload.
 */

export type TimesheetStatus = "open" | "submitted" | "approved" | "rejected";

export type TimesheetEntry = {
  id: string;
  contractorId: string;
  workOrderId: string;
  workDate: string;
  startedAt: string;
  finishedAt: string | null;
  breakMinutes: number;
  source: "painter" | "pc" | "auto";
  status: TimesheetStatus;
  note?: string;
  approvedAt: string | null;
  rejectedReason: string;
};

/** Worked hours to two places: the span less the break. Null while open. */
export function workedHours(startedAt: string, finishedAt: string | null, breakMinutes: number): number | null {
  if (!finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms / 3_600_000 - breakMinutes / 60) * 100) / 100;
}

/** Hours × the cost rate, rounded to the cent — what approval posts. */
export function labourCents(hours: number, centsPerHour: number): number {
  return Math.round(hours * centsPerHour);
}

/** Melbourne calendar day and clock for a timestamp, for screens and the CSV. */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false });
export const melbourneDay = (iso: string) => dayFmt.format(new Date(iso));
export const melbourneClock = (iso: string) => clockFmt.format(new Date(iso));

export type PayrollRow = {
  painter: string;
  woRef: string;
  workDate: string;
  startedAt: string;
  finishedAt: string;
  breakMinutes: number;
  source: "painter" | "pc" | "auto";
  approvedAt: string;
};

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/**
 * The payroll CSV: approved entries only, hours only. No rate, no pay, no
 * cost column — payroll/MYOB owns the money side (brief §3.8).
 */
export function payrollCsv(rows: readonly PayrollRow[]): string {
  const head = ["painter", "job", "date", "start", "finish", "break_minutes", "hours", "source", "approved_at"];
  const lines = rows.map((r) => [
    r.painter, r.woRef, r.workDate, melbourneClock(r.startedAt), melbourneClock(r.finishedAt),
    r.breakMinutes, (workedHours(r.startedAt, r.finishedAt, r.breakMinutes) ?? 0).toFixed(2), r.source, r.approvedAt,
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

/** Allocated hours from the frozen document — the same sum employee_jobs() shows the painter. */
export function allocatedHours(snapshot: unknown): number {
  const areas = (snapshot as { areas?: unknown } | null)?.areas;
  if (!Array.isArray(areas)) return 0;
  let total = 0;
  for (const area of areas) {
    const surfaces = (area as { surfaces?: unknown })?.surfaces;
    if (!Array.isArray(surfaces)) continue;
    for (const s of surfaces) {
      const h = Number((s as { hours?: unknown })?.hours ?? 0);
      if (Number.isFinite(h)) total += h;
    }
  }
  return Math.round(total * 100) / 100;
}

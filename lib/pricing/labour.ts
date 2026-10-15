/**
 * Hours × an hourly rate, in cents — the ONE place that arithmetic lives
 * (lib/workorder/boundary.test.ts pins it to lib/pricing). The TypeScript
 * twin of `timesheet_auto_approve` / `timesheet_approve`:
 * `round(v_hours * v_rate)::integer`, hours to two places.
 */
export function labourCostCents(hours: number, centsPerHour: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(centsPerHour) || hours <= 0 || centsPerHour <= 0) return 0;
  return Math.round(hours * centsPerHour);
}

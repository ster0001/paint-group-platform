import type { WorkOrderDoc } from "./snapshot";

/**
 * The job's estimated hours: the sum of every surface's hours allowance in the
 * frozen work-order document. ONE place (Tom, 1 Oct: "add the total estimated
 * hours at the top of the work order") — the scheduler's tray already summed
 * these to size a booking, and the job sheet now prints the same figure, so
 * the two can never disagree. `hours` per surface already carries the
 * Condition multiplier and typed prep (see WOSurface), so nothing is added.
 */
export function estimatedHours(doc: Pick<WorkOrderDoc, "areas"> | null | undefined): number {
  if (!doc) return 0;
  const total = doc.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + (s.hours ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** "30.6 h" — one decimal, no trailing zero; "—" when the document has none. */
export function formatHours(hours: number): string {
  if (!(hours > 0)) return "—";
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

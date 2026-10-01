// Holds and extra visits on the scheduling board (Tom, 1 Oct 2026). Pure
// helpers — no Supabase imports, so the board (a Client Component), the board
// loader and the work queue all share one reading of the rows.

/** A staff-only reservation of a painter's days while the client decides. */
export type HoldRow = {
  id: string;
  contractor_id: string;
  start_date: string;
  end_date: string;
  work_order_id: string | null;
  note: string;
  created_at: string;
  released_at: string | null;
};

/** An extra run of days on a job this painter is already booked on. */
export type AppointmentRow = {
  id: string;
  work_order_id: string;
  contractor_id: string;
  start_date: string;
  end_date: string;
  note: string;
};

/**
 * A hold is RESOLVED the moment the job it waited on is booked — to anyone.
 * Derived, not stored: nothing has to release it when the offer goes out, and
 * a hold with no job stays until the office lets it go.
 */
export function holdIsResolved(hold: Pick<HoldRow, "work_order_id" | "released_at">, bookedWorkOrderIds: ReadonlySet<string>): boolean {
  if (hold.released_at) return true;
  return hold.work_order_id != null && bookedWorkOrderIds.has(hold.work_order_id);
}

/** The holds still standing: unreleased, and not answered by a booking. */
export function openHolds<T extends Pick<HoldRow, "work_order_id" | "released_at">>(holds: readonly T[], bookedWorkOrderIds: ReadonlySet<string>): T[] {
  return holds.filter((h) => !holdIsResolved(h, bookedWorkOrderIds));
}

/** What the pink block says when the hold carries no job. */
export const HOLD_FALLBACK_TITLE = "Held — waiting on the client";

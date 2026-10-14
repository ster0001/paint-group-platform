/**
 * The demo wall (induction brief §4.2, Tom's ruling 14 Oct 2026, ruling 1).
 *
 * 12 Demo Street is a real work order on the contractor's own account, rendered
 * by the same screens as a real job. It must never count: not in PC Command,
 * the home dashboard, Payments, the status evaluator, the sweeps, the exports
 * or anything a customer reads. The database carries ONE flag, `is_demo`, on
 * the estimate, the work order and every child row (migration 20270262 copies
 * it by trigger), and this file is the ONE way a list read leaves demo rows
 * out: `realOnly(query)`.
 *
 * A read by id (the job page, an action on a row you already hold) is not a
 * list and takes no scope — the contractor and the office must be able to
 * open the demo. `lib/demo/boundary.test.ts` greps every list read of a
 * flagged table in app/ and lib/ and fails the build when one is missing the
 * scope, so a new report or queue cannot forget it.
 */

/** The column and value, for a reader that builds its filter by hand (an `.or()` string, an RPC argument). */
export const DEMO_COLUMN = "is_demo" as const;

/** Real rows only. Chain it where the `.from()` is, before any `.order()` / `.range()`. */
export function realOnly<T>(query: T): T {
  // PostgREST's builder returns `this` from .eq(). T is left unconstrained on
  // purpose: a constraint such as `{ eq(...): unknown }` makes tsc instantiate
  // the typed service client's generic .eq() and gives up ("excessively deep").
  return (query as unknown as { eq(column: string, value: boolean): unknown }).eq(DEMO_COLUMN, false) as T;
}

/** The flagged tables — the list the ratchet test enforces. Keep it equal to the migration's. */
export const DEMO_FLAGGED_TABLES = [
  "estimates", "work_orders",
  "booking_offers", "contractor_expenses", "contractor_invoices", "expense_preapprovals",
  "invoices", "job_costs", "material_costs", "painter_job_results", "timesheet_entries",
  "wo_appointments", "wo_assignments", "wo_callbacks", "wo_checklist_items", "wo_day_flags",
  "wo_events", "wo_message_threads", "wo_photos", "wo_qa_checks", "wo_reminder_moments",
  "wo_signoff", "wo_site_visits", "wo_surfaces", "wo_updates", "wo_variations",
  "wo_walkthroughs", "schedule_holds", "review_requests", "warranties", "messages", "crm_events",
  // 20270265: a share on a demo job (worker logins, Step 3a).
  "wo_worker_shares",
] as const;

/**
 * What the estimates list SHOWS for a row (Tom, 4 Sep 2026: "when an
 * estimate is viewed, adjust the status from sent to viewed").
 *
 * The database status stays the state machine's (`sent` until accepted or
 * declined); "viewed" is the sent state plus the first customer open
 * (`estimates.viewed_at`, stamped by record_estimate_view). Deriving it here
 * keeps one source of truth and no enum surgery.
 */
export type ListStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | string;

export function displayStatus(row: { status: string; viewed_at?: string | null }): ListStatus {
  return row.status === "sent" && row.viewed_at ? "viewed" : row.status;
}

/** The list's filter tabs, in order. `viewed` splits `sent` by viewed_at. */
/** "wizard" (buckets brief §5) lists the open wizard sessions — leads with no estimate yet. */
/**
 * C7b — "waiting" is FIRST and is the default tab.
 *
 * It is not a status: it is the work queue, filtered to this page's subjects.
 * `filterQuery` deliberately returns nothing for it, because it never becomes
 * a `.eq("status", …)` — the rows come from `lib/crm/work-queue.ts`, the same
 * evaluator CRM Today reads. One evaluator, one list, one count (CLAUDE.md).
 */
export const LIST_FILTERS = ["waiting", "all", "draft", "sent", "viewed", "accepted", "declined", "expired", "wizard"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

/** Translate a tab into the query: which DB status, and whether viewed_at must be set/null. */
export function filterQuery(filter: string | undefined): { status?: string; viewed?: boolean } {
  // C7b: "waiting" is the work queue, not a status. It must never reach
  // `.eq("status", "waiting")` — there is no such status, and a filter that
  // silently matched nothing would look like an empty inbox rather than a bug.
  if (!filter || filter === "all" || filter === "waiting") return {};
  if (filter === "viewed") return { status: "sent", viewed: true };
  if (filter === "sent") return { status: "sent", viewed: false };
  return { status: filter };
}

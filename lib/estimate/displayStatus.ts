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
export const LIST_FILTERS = ["all", "draft", "sent", "viewed", "accepted", "declined", "expired"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

/** Translate a tab into the query: which DB status, and whether viewed_at must be set/null. */
export function filterQuery(filter: string | undefined): { status?: string; viewed?: boolean } {
  if (!filter || filter === "all") return {};
  if (filter === "viewed") return { status: "sent", viewed: true };
  if (filter === "sent") return { status: "sent", viewed: false };
  return { status: filter };
}

import type { WorkItem } from "@/lib/crm/work-queue";
import type { WizardJourney } from "@/lib/wizard/journey";
import { parseEstimateNumber } from "./number";
import type { ListRow } from "./listRows";

/**
 * The Estimates search, in one place (Tom, 23 Oct 2026: "the search bar
 * crashes and retypes as you type").
 *
 * The page fetches whatever its tab shows and the needle only ever narrowed
 * that list in memory — yet each keystroke used to navigate to a fresh
 * `?q=`, which swapped the page for the loading skeleton and mounted a new
 * box holding the needle from a moment ago. Now the three tab tables filter
 * on the client with these matchers, the box keeps `?q=` in the URL with
 * `history.replaceState` (no server round trip), and the server's first paint
 * of a `?q=` link runs the SAME functions through `useSearchParams`. Nothing
 * else decides what the needle matches.
 */

/** Case-insensitive substring over any of the fields; an empty needle matches everything. */
export function matchesNeedle(q: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

/** The status tabs: title, customer, address, the wizard session's name/address/suburb, or the estimate number ("42", "0042", "#42"). */
export function filterEstimateRows<R extends Pick<ListRow, "title" | "customer" | "address" | "number" | "wizard">>(rows: readonly R[], q: string): R[] {
  if (!q.trim()) return [...rows];
  const n = parseEstimateNumber(q);
  return rows.filter((r) =>
    matchesNeedle(q, r.title, r.customer, r.address, r.wizard?.name, r.wizard?.address, r.wizard?.suburb)
    || (n != null && r.number === n));
}

/** The Wizard tab: who, where and how to reach them. */
export function filterWizardSessions<S extends Pick<WizardJourney, "name" | "address" | "suburb" | "email" | "phone">>(sessions: readonly S[], q: string): S[] {
  if (!q.trim()) return [...sessions];
  return sessions.filter((s) => matchesNeedle(q, s.name, s.address, s.suburb, s.email, s.phone));
}

/** The Waiting tab: the work item's title and its one line of detail. */
export function filterWaitingItems<I extends Pick<WorkItem, "title" | "detail">>(items: readonly I[], q: string): I[] {
  if (!q.trim()) return [...items];
  return items.filter((i) => matchesNeedle(q, i.title, i.detail));
}

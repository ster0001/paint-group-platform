/**
 * Page through a PostgREST query that can outgrow the response cap.
 *
 * PostgREST caps every response at 1000 rows and truncates SILENTLY — at
 * ~4k open jobs the Projects board simply lost jobs, and nothing errored
 * (found by the 3a-8 volume dataset). Any query whose row count grows with
 * the business goes through here; state-bounded queries (open offers,
 * unsigned sign-offs) can stay single-shot.
 *
 * The builder passed in MUST carry a stable `.order(...)` — without one the
 * pages can overlap or skip. Throws on a query error rather than returning
 * a partial set: a missing page is the same silent-truncation bug this
 * helper exists to prevent.
 */
const PAGE = 1000;

export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

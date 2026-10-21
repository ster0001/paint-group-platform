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
  opts: { prefetchPages?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  // A table whose size is roughly known (the suburb centroids: ~3,500 rows) asks for its first
  // pages TOGETHER — one round trip instead of one per page on a read that gates the first byte.
  // The same rows in the same order: a short page ends the read, and any pages past the first
  // batch still follow one at a time.
  const prefetch = Math.max(1, Math.floor(opts.prefetchPages ?? 1));
  const first = await Promise.all(Array.from({ length: prefetch }, (_, i) => query(i * PAGE, (i + 1) * PAGE - 1)));
  for (const { data, error } of first) {
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  for (let from = prefetch * PAGE; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

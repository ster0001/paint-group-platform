/**
 * Read an id-keyed table in slices, because a long `.in(...)` list is a long URL
 * and the request layer refuses it.
 *
 * Found twice. First on the CRM work-queue P5 rebuild, where it was fixed. Then
 * again on 16 Sep 2026 on the Invoicing dashboard, which passes every invoice id
 * into one `.in("invoice_id", ids)`: at 400 invoices that URL is ~15 KB and the
 * fetch dies with `TypeError: fetch failed`. Because the read discarded its
 * error, the payments simply came back empty and the dashboard showed every
 * invoice — paid ones included — as unpaid and overdue. Nothing said so. It only
 * surfaced when the payments read was made to report its failures.
 *
 * So this returns the error rather than hiding it: a caller that cannot read the
 * payments must say so, not quietly price the screen as if nothing were paid.
 */
export const ID_SLICE = 120;

export type SliceError = { message?: string; code?: string };

export async function inSlices<T>(
  ids: readonly string[],
  run: (slice: string[]) => PromiseLike<{ data: T[] | null; error?: SliceError | null }>,
): Promise<{ rows: T[]; error: SliceError | null }> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_SLICE) {
    const { data, error } = await run(ids.slice(i, i + ID_SLICE));
    // One refused slice makes the whole set untrustworthy — a partial answer here
    // is exactly the "some payments are missing" lie, just smaller.
    if (error) return { rows: [], error };
    rows.push(...(data ?? []));
  }
  return { rows, error: null };
}

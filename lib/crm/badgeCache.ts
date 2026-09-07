/**
 * The Today badge's fast path (P7, deep dive §4.7 / shell brief 2A.10).
 *
 * The tab rail asks for the count on every navigation. Rebuilding the whole
 * queue (a dozen bounded reads) for one number on every click is the cost the
 * deep dive flagged. The layout and the Today page already build the queue
 * for their own render; they park the count here, and the badge route serves
 * it for a short while instead of rebuilding. Per server instance, per user,
 * 45 seconds — a stale badge for under a minute is fine; a slow tab bar is not.
 */

const TTL_MS = 45_000;
const cache = new Map<string, { count: number; at: number }>();

export function rememberBadge(userId: string, count: number): void {
  cache.set(userId, { count, at: Date.now() });
  if (cache.size > 500) {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
}

export function cachedBadge(userId: string, now = Date.now()): number | null {
  const hit = cache.get(userId);
  return hit && now - hit.at < TTL_MS ? hit.count : null;
}

/** A CRM write that changes the queue (a log, a dismissal) forgets the number early. */
export function forgetBadge(userId?: string): void {
  if (userId) cache.delete(userId); else cache.clear();
}

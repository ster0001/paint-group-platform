/**
 * The connection an ADVISORY LOCK must be taken on — the plain-JS twin of
 * `lib/testing/session-pooled-url.ts`.
 *
 * Two files because the lock has two callers that cannot share a module: the
 * e2e run lock is TypeScript (`e2e/run-lock.ts`), and the sweep is a plain
 * `.mjs` run by `node scripts/c1/hygiene.mjs`. `lib/testing/session-pooled-url.test.ts`
 * imports BOTH and asserts they agree, so the pair cannot drift — the same
 * mirror-and-pin the segments table uses.
 *
 * Why it matters: Supabase's TRANSACTION pooler (:6543) gives two connections
 * the SAME backend, so the second `pg_try_advisory_lock` returns true (a
 * session's own lock is re-entrant) and the lock excludes nobody. :5432 is the
 * SESSION pooler — one backend per connection, which is what a session-level
 * lock means.
 */
export function sessionPooledUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.port === "6543") u.port = "5432";
    return u.toString();
  } catch {
    return raw; // not a URL we can reason about; let pg report it
  }
}

/** The key `e2e/run-lock.ts` contends on. Any run, any checkout, any machine. */
export const E2E_RUN_LOCK_KEY = 0x70676532;

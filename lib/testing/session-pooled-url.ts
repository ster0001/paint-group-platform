/**
 * One client connection = one backend. That is the whole requirement behind
 * the e2e run lock (`e2e/run-lock.ts`), and Supabase's TRANSACTION pooler
 * (:6543) does not meet it: two separate connections measured the SAME
 * `pg_backend_pid()`, so the second `pg_try_advisory_lock` returned true — a
 * session's own advisory lock is re-entrant — and the "lock" excluded nobody.
 * The same host on :5432 is the SESSION pooler, one backend per client
 * connection, where the second caller is correctly refused and the lock frees
 * itself the moment the holding connection ends. Measured 18 Sep 2026.
 *
 * Lives under lib/ because that is where the unit suite looks.
 */
export function sessionPooledUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.port === "6543") u.port = "5432";
    return u.toString();
  } catch {
    return raw; // not a URL we can reason about; let pg report it
  }
}

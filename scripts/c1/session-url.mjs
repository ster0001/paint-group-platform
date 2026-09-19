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

/**
 * WHO holds the lock, written where the server can see it.
 *
 * `pg.Client({ application_name })` puts the name in the STARTUP PACKET, and
 * Supabase's pooler swallows it: every lock-holding connection read back as
 * "Supavisor" in `pg_stat_activity`, so a refused run could not say what was
 * holding the project. Measured on the test project 19 Sep 2026 — the same
 * shape as the transaction-pooler trap above, one layer further in. A runtime
 * `set_config('application_name', …)` DOES survive the pooler, so that is how
 * both holders name themselves.
 *
 * `application_name` is truncated at 63 bytes by Postgres (NAMEDATALEN) and
 * the name below is ~40, so it survives whole.
 */
export const LOCK_NAME_PREFIX = "pg-e2e-lock";

/** `pg-e2e-lock:sweep:ci:2026-09-19T21:14Z` — parseable, and readable raw. */
export function lockHolderName(kind, opts = {}) {
  const where = opts.ci ? "ci" : "local";
  const at = (opts.now ?? new Date()).toISOString().slice(0, 16) + "Z";
  return `${LOCK_NAME_PREFIX}:${kind}:${where}:${at}`;
}

/**
 * Turn what `pg_stat_activity` reports into a line a refusal can print. An
 * unparseable name is the normal case for a while — an older checkout takes
 * the lock without naming itself — so it must read as "we cannot tell", never
 * as a wrong answer.
 */
export function describeLockHolder(applicationName, connectionAge, now) {
  const parts = (applicationName ?? "").split(":");
  if (parts[0] !== LOCK_NAME_PREFIX || parts.length < 4) {
    // `backend_start` is the POOLED BACKEND's age, not this holder's: a
    // rehearsal that took the lock one second earlier reported "running
    // 00:44:27" because the pooler handed it a 44-minute-old backend. So it is
    // reported as what it actually is, and never as how long the lock is held.
    const open = connectionAge ? `; its pooled connection has been open ${connectionAge}, which is NOT how long it has held the lock` : "";
    return `something that did not record what it is (application_name ${JSON.stringify(applicationName ?? null)})${open} — an older checkout, most likely`;
  }
  const [, kind, where, ...at] = parts;
  const startedAt = at.join(":");
  const what = kind === "sweep"
    ? "the hygiene sweep (scripts/c1/hygiene.mjs)"
    : kind === "e2e" ? "an e2e run" : `a ${kind}`;
  // The holder stamped its own start time into the name, so THIS is the one
  // number here that means what it says.
  const started = Date.parse(startedAt);
  const mins = Number.isNaN(started) ? null : Math.round(((now ?? new Date()).getTime() - started) / 60_000);
  const ago = mins === null ? "" : `, ${mins} min ago`;
  return `${what}, started ${where === "ci" ? "in CI" : "locally"} at ${startedAt}${ago}`;
}

/** Finds the holder of the advisory lock. `pg_advisory_lock(bigint)` splits the
 *  key across classid/objid; ours fits in the low half, so classid is 0. */
export const LOCK_HOLDER_QUERY =
  "select a.application_name, date_trunc('second', now() - a.backend_start)::text as held_for " +
  "from pg_locks l join pg_stat_activity a on a.pid = l.pid " +
  "where l.locktype = 'advisory' and l.classid = 0 and l.objid = $1 and l.granted limit 1";

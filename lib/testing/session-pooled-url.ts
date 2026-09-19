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
export function lockHolderName(kind: "e2e" | "sweep", opts: { ci?: boolean; now?: Date } = {}): string {
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
export function describeLockHolder(applicationName?: string | null, connectionAge?: string | null, now?: Date): string {
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

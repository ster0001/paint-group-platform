/**
 * ONE e2e RUN AT A TIME AGAINST THE TEST PROJECT — enforced by the database,
 * not by a workflow file (18 Sep 2026).
 *
 * `global-teardown.ts` deletes what the run created "since the marker", and a
 * TIMESTAMP IS NOT OWNERSHIP: every row a CONCURRENT run created falls inside
 * the same window. So a second run finishing first deletes the first run's
 * LIVE anonymous users — while their JWTs are still in the browser. The next
 * insert then fails `estimates_created_by_fkey`, the wizard shows "Couldn't
 * create the estimate", and it reads as a product bug. That is what turned
 * main's e2e job red from 16 Sep 2026: r5-editor, save-and-book and what-we-do
 * all failed on that one foreign key, always LATE in the run.
 *
 * CI already serialises itself (the constant `e2e-test-project` concurrency
 * group, shared with the sweep). Nothing serialised a LOCAL run against the
 * same project — and this repo is worked in several checkouts at once, with a
 * peer's `next start` on :3101 as often as not.
 *
 * A Postgres session-level advisory lock is the right shape: it is held by the
 * connection, so it CANNOT outlive the process. Crash, Ctrl-C, a killed CI
 * job — the backend goes away and the lock goes with it. No file to stale, no
 * row to clean up.
 *
 * BUT IT MUST NOT BE TAKEN OVER THE TRANSACTION POOLER. `E2E_DATABASE_URL` is
 * Supabase's pooler on :6543, where many clients share one backend — two
 * separate connections measured the SAME `pg_backend_pid()`, so the second
 * `pg_try_advisory_lock` returned true (a session's own lock is re-entrant)
 * and the lock was a no-op that looked like it worked. Same host on :5432 is
 * the SESSION pooler: one backend per client connection, which is what a
 * session lock means. Measured on the test project — different pids, the
 * second caller refused, and the lock free again the moment the first
 * connection ended.
 */
import pg from "pg";
import { sessionPooledUrl } from "@/lib/testing/session-pooled-url";

/** Arbitrary but fixed: "pge2e" as a 32-bit key. Any run, any checkout, any
 *  machine pointed at this database contends for THIS number. */
export const E2E_RUN_LOCK_KEY = 0x70676532;

let client: pg.Client | null = null;

export function e2eDatabaseUrl(): string {
  return process.env.E2E_DATABASE_URL || process.env.C1_DATABASE_URL || "";
}



/**
 * Take the lock for the lifetime of this process. Returns:
 *   "held"    — this run owns the project.
 *   "busy"    — another run owns it; the caller must REFUSE to start.
 *   "skipped" — no connection string, so there is nothing to lock against
 *               (the tripwire in global-setup fails on that separately, and a
 *               lock is not the place to duplicate that message).
 */
export async function acquireRunLock(): Promise<"held" | "busy" | "skipped"> {
  const raw = e2eDatabaseUrl();
  if (!raw) return "skipped";
  const connectionString = sessionPooledUrl(raw);
  const c = new pg.Client({ connectionString, application_name: "pg-e2e-run-lock" });
  await c.connect();
  try {
    const r = await c.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [E2E_RUN_LOCK_KEY]);
    if (!r.rows[0]?.ok) {
      await c.end();
      return "busy";
    }
    client = c;
    return "held";
  } catch (e) {
    await c.end().catch(() => {});
    throw e;
  }
}

/** Release it. Safe to call when nothing was taken. */
export async function releaseRunLock(): Promise<void> {
  const c = client;
  client = null;
  if (!c) return;
  // Ending the connection releases a session-level lock on its own; the
  // explicit unlock just makes the intent readable in a log.
  await c.query("select pg_advisory_unlock($1)", [E2E_RUN_LOCK_KEY]).catch(() => {});
  await c.end().catch(() => {});
}

export const RUN_LOCK_BUSY_MESSAGE =
  "REFUSED: another e2e run already holds the test project.\n" +
  "  Two runs at once delete each other's live anonymous users (the teardown deletes by\n" +
  "  time window, and a concurrent run's rows fall inside it), which surfaces as\n" +
  "  \"Couldn't create the estimate: … estimates_created_by_fkey\" late in whichever run\n" +
  "  is still going. Wait for the other run to finish — CI runs are visible under\n" +
  "  Actions → CI, and a local one is usually a peer checkout's ./scripts/c1/run-e2e.sh.";

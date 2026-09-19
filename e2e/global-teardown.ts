import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RUN_MARKER_FILE } from "./global-setup";
import { releaseRunLock } from "./run-lock";
import { resolveTeardownWindow, type RunMarker } from "@/lib/testing/teardown-window";

/**
 * C7c — a run cleans up after itself (brief step 2).
 *
 * Runs once after every spec has finished, PASS OR FAIL (⚑45): Playwright
 * calls globalTeardown whenever globalSetup completed, whatever the suite did.
 * It removes the anonymous users and pg.e2e.* logins CREATED BY THIS RUN —
 * identified by the marker global-setup recorded, never by a pattern over
 * all time — and the estimate chains, leads and @example.com accounts that
 * hang off them, in the order the foreign keys require.
 *
 * It deletes ONLY when this process's global-setup recorded the window (the
 * run id it stamped alongside it). A run that was refused reaches this
 * function too and must delete nothing: see lib/testing/teardown-window.ts.
 *
 * It is the same script the scheduled sweep runs (scripts/c1/hygiene.mjs),
 * so there is ONE guard, ONE exclusion list and ONE delete walk. A refusal
 * (exit 3) is thrown, because a teardown that silently did nothing is the
 * defect this chunk exists to remove; a cleanup error (exit 1) is logged
 * with what was left, because the suite's own result must stand.
 */
export default async function globalTeardown(): Promise<void> {
  let marker: RunMarker = null;
  try { marker = JSON.parse(readFileSync(RUN_MARKER_FILE, "utf8")) as RunMarker; } catch { /* no marker, or unreadable */ }

  // WHOSE ROWS ARE THESE? Only this run's, and only when this run can be shown
  // to have recorded the window. A refused run (busy lock, failed tripwire)
  // reaches this function too, owning nothing — and once deleted another run's
  // live users by the marker file a previous run had left behind.
  const window = resolveTeardownWindow({
    runId: process.env.E2E_RUN_ID,
    envSince: process.env.E2E_RUN_STARTED_AT,
    marker,
  });
  if (!window.act) {
    console.error(`e2e teardown: deleting nothing — ${window.reason}.`);
    await releaseRunLock();
    return;
  }
  const since = window.since;
  const r = spawnSync(process.execPath, ["scripts/c1/hygiene.mjs", "teardown", "--since", since], {
    encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"], timeout: 8 * 60_000,
  });
  if (r.status !== 0 && r.status !== 3) console.error(`e2e teardown did not finish cleanly (exit ${r.status}); whatever it could not delete is listed above and the sweep will catch it.`);
  // The lock goes LAST: the delete walk is the part that must not overlap
  // another run, so it stays held until the rows are gone. Released in a
  // finally so a refusal still hands the project to whoever is waiting.
  await releaseRunLock();
  if (r.status === 3) throw new Error("e2e teardown REFUSED to run — see the reason above. The run's rows are still on the project.");
}

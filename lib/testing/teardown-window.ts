/**
 * WHOSE ROWS ARE THESE? — the question `e2e/global-teardown.ts` must answer
 * before it deletes anything (19 Sep 2026).
 *
 * The teardown deletes what the run created "since the marker". `run-lock.ts`
 * already explains why a TIMESTAMP IS NOT OWNERSHIP between two concurrent
 * runs; this module closes the other half of the same hole, which the lock did
 * not cover and which was hit on 19 Sep:
 *
 *   A run whose global-setup REFUSED still gets a global-teardown. Playwright
 *   calls it whenever globalSetup was invoked, thrown or not. The refused run
 *   had written no marker of its own — so the teardown fell back to the marker
 *   FILE, which lives in the machine's temp dir (`pg-e2e-run-marker.json`) and
 *   is shared by every checkout and every worktree on the machine. It found
 *   the PREVIOUS run's timestamp, and deleted every row created since: 22
 *   users, 12 estimates and 3 accounts belonging to the run that held the lock
 *   and was still going.
 *
 * So the run-lock refused the run, correctly, and the teardown then did the
 * exact damage the lock exists to prevent.
 *
 * The rule is therefore ownership, not recency: a teardown may only delete
 * rows whose window THIS PROCESS recorded. global-setup stamps a fresh
 * `E2E_RUN_ID` into the environment and into the marker it writes; a marker
 * carrying any other id belongs to somebody else's run and is not ours to act
 * on. A run that never got as far as writing a marker owns nothing and
 * deletes nothing.
 *
 * Kept as a pure function so it can be unit-tested without a database, a
 * browser or a temp file — see `teardown-window.test.ts`.
 */

/** What global-setup wrote into the marker file. Unknown shapes are tolerated:
 *  a marker we cannot read is a marker we do not own. */
export type RunMarker = { startedAt?: unknown; runId?: unknown } | null;

export type TeardownWindow =
  /** Delete rows created at or after `since` — this run recorded it. */
  | { act: true; since: string }
  /** Delete nothing, and say why. */
  | { act: false; reason: string };

export function resolveTeardownWindow(input: {
  /** `process.env.E2E_RUN_ID` — stamped by global-setup in THIS process. */
  runId: string | undefined;
  /** `process.env.E2E_RUN_STARTED_AT` — stamped alongside it. */
  envSince: string | undefined;
  /** The parsed marker file, or null when it is missing or unreadable. */
  marker: RunMarker;
}): TeardownWindow {
  const runId = (input.runId ?? "").trim();

  // No run id means global-setup did not complete in this process: the suite
  // was refused (a busy lock, a failed tripwire, a production target) or died
  // before it recorded anything. Either way this run created nothing, so it
  // has nothing to clean up — and the rows now on the project are somebody
  // else's.
  if (!runId) {
    return { act: false, reason: "global-setup did not complete in this process, so this run recorded no window of its own and owns none of the rows now on the project" };
  }

  // The environment is the first-hand record: same process, same run.
  const envSince = (input.envSince ?? "").trim();
  if (envSince) return { act: true, since: envSince };

  // Fall back to the marker file ONLY when it carries this run's id. It is a
  // machine-wide file, so any other id is another run's window — very possibly
  // one that is still going.
  const marker = input.marker;
  const markerRunId = typeof marker?.runId === "string" ? marker.runId.trim() : "";
  const markerSince = typeof marker?.startedAt === "string" ? marker.startedAt.trim() : "";

  if (!markerRunId) {
    return { act: false, reason: "the run marker carries no run id (it predates this guard, or was written by an older checkout), so it cannot be shown to belong to this run" };
  }
  if (markerRunId !== runId) {
    return { act: false, reason: `the run marker belongs to run ${markerRunId}, not this run (${runId}) — those rows are another run's, and deleting them is what turned main's e2e job red` };
  }
  if (!markerSince) {
    return { act: false, reason: "the run marker names this run but carries no start time, so there is no window to delete by" };
  }
  return { act: true, since: markerSince };
}

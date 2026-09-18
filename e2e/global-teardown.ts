import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RUN_MARKER_FILE } from "./global-setup";
import { releaseRunLock } from "./run-lock";

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
 * It is the same script the scheduled sweep runs (scripts/c1/hygiene.mjs),
 * so there is ONE guard, ONE exclusion list and ONE delete walk. A refusal
 * (exit 3) is thrown, because a teardown that silently did nothing is the
 * defect this chunk exists to remove; a cleanup error (exit 1) is logged
 * with what was left, because the suite's own result must stand.
 */
export default async function globalTeardown(): Promise<void> {
  let since = process.env.E2E_RUN_STARTED_AT ?? "";
  if (!since) {
    try { since = JSON.parse(readFileSync(RUN_MARKER_FILE, "utf8")).startedAt ?? ""; } catch { /* no marker */ }
  }
  if (!since) {
    console.error("e2e teardown: no run marker — global-setup did not record one, so nothing is deleted (a teardown by pattern alone would eventually delete a fixture).");
    await releaseRunLock();
    return;
  }
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

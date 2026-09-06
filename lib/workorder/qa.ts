/**
 * Which quality checks are still open — the TS twin of `wo_qa_open_count`
 * (migration 20270112). One rule, both sides:
 *
 *   · result null  → open (not yet logged)
 *   · result fail  → open until a re-check row points at it (`retry_of`);
 *                    the re-check then carries the job's openness
 *   · result pass  → clear
 *
 * A failed check is a RECORD, never reset: the fail spawns its successor in
 * wo_record_qa, same kind, standards seeded fresh. The screens use this to
 * tell "logged FAIL, re-check below" from "logged FAIL, job parked".
 */
export type QaCheckLite = { id: string; result: string | null; retryOf?: string | null };

/** Ids of failed checks that already have a re-check pointing at them. */
export function supersededQaIds<T extends QaCheckLite>(checks: readonly T[]): Set<string> {
  const out = new Set<string>();
  for (const c of checks) if (c.retryOf) out.add(c.retryOf);
  return out;
}

/** The checks that still hold the job: unlogged, or failed with no re-check yet. */
export function openQaChecks<T extends QaCheckLite>(checks: readonly T[]): T[] {
  const superseded = supersededQaIds(checks);
  return checks.filter((c) => c.result === null || (c.result === "fail" && !superseded.has(c.id)));
}

/** Every check settled — and there is at least one. Mirrors wo_qa_route_passed's "route now" test. */
export function qaAllClear<T extends QaCheckLite>(checks: readonly T[]): boolean {
  return checks.length > 0 && openQaChecks(checks).length === 0;
}

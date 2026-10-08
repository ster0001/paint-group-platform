# Finish standards, painter status, call backs — Step 5 report (the evaluator)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** §10 Step 5 · **Before:** `standards-status-callbacks-s4-report.md`

## What was built

| Brief asked | Built |
|---|---|
| The twenty-four §4.6 golden tests first, failing | `lib/painterStatus/evaluate.test.ts`: 24 cases + idempotence, rebuild-from-events, trend and rules merge (28 green) |
| `lib/painter-status` as pure functions | `lib/painterStatus/evaluate.ts` — `scoreJobs`, `applyCredits`, `colourFromSummaries`, `evaluatePainter`, `colourFromEvents`, `trendOf`. No I/O. |
| ONE RPC that writes `painter_job_results` and `painter_status` | `painter_status_write` (migration 20270228). Staff or service only; nobody else can insert or update the tables. Diffs before writing |
| `painter_bonuses` with the idempotent "raise one review" at a counter of 4 | Table + `on conflict (painter_id, trigger_wo_id) do nothing`; `qualifying_changed_at` set when a qualifying job's result later changes. Approval flow is Step 7 |
| Score only jobs signed off on or after the launch date (⚑25) | `rules.launchDate` 2026-10-08; earlier sign-offs are not scored and not counted |
| Every §5 event | `job_result_set` (with the previous row), `status_changed` {from,to}, `bonus_review_raised` — written by the RPC, only when something changed |
| Finalise at sign-off + 7 days on the existing cron | The daily `wo-sweep` runs every active painter; a pending result becomes clean / not clean once the window passes |
| Recompute on every §4.4 trigger | `campaign-sweep` every half hour for painters with an event in the last 35 minutes; `after()` from the call-back actions and `recordQa` |
| Seed every existing painter as New at launch | The first daily sweep after the paste |
| §4.5 cadence on the existing QA scheduling; PC "Spot check" | `wo_schedule_qa` reads `painter_status.colour`; `wo_qa_checks.trigger` says why; `wo_add_qa_check(…, p_kind mid|spot)`; **Spot check this job** on the quality-check card |
| A plain staff-only table | `/pc/status` (**Painters** in the rail) |
| E2e | `e2e/painter-status.spec.ts`: sweep results + idempotence, RLS by role, cadence by colour + spot check, the table |

## Acceptance (brief Step 5)
- Twenty-four golden tests green — yes (28 with the extras).
- Running the evaluator twice changes nothing — unit (same output) and e2e (no new events, same row).
- No browser code computes a result, a colour or a count — `/pc/status` and the QA controls render rows only; `evaluate.ts` is server-side and imported only by `run.ts` (server-only) and its test.
- A test rebuilds a painter's status from the event log alone — `colourFromEvents` over `job_result_set` events, shares `colourFromSummaries` with the live path.
- Employed painters with no led jobs have no status row — `runPainterStatus` skips them.
- No job signed off before the launch date in any count — golden case + `rules.launchDate`.

## Decisions taken
1. **Credits spend the same job first, then later jobs within the lookback** (⚑6 read literally); a credit lapses with the lookback.
2. **A skipped (no-work / rescheduled) or never-sent moment counts nowhere** — the Step 4 rows make this exact.
3. **`wo_contractor_is_new` still decides "New painter's first jobs"** from the old `qaCadence.newContractorJobs` (3). The status rule `newJobs` (4) is how many clean jobs take New to Green. Two numbers, both in Settings; unifying them is a one-line change if Tom wants one.
4. **The half-hour pass looks back 35 minutes of `wo_events`**, so a trigger that is not a `wo_event` (a bonus decision, a settings change) is picked up by the daily pass. Every §4.4 trigger is an event.
5. **A call back counts against the painter who did the job even when someone else fixes it** (C7) — the loader filters by `wo_callbacks.painter_id`.

## Open for Tom
- Paste `20270228000000_painter_status.sql` (converges; re-paste if it stops).
- `newJobs` 4 vs `newContractorJobs` 3 — see decision 3.

## Not in this step
The painter's traffic light and the Green wording of text 3 (Step 6); Contractors view, bonus approval, the PC call for Orange and the Tom conversation for Red (Step 7).

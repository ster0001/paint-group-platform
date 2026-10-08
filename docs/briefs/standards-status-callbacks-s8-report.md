# Finish standards, painter status, call backs — Step 8 report (PC Command Contractors + queue cards)

**Date:** 9 October 2026 · **Branch:** `feat/pc-contractors-section` · **Brief:** §10 Step 8 · **Before:** `standards-status-callbacks-s7-report.md`

## What was built

| Brief asked | Built |
|---|---|
| The Contractors section per the mockup | `/pc/contractors` (the **Contractors** tab): counts by colour; open call backs, rewards due, not signed; one row per painter with light, checks, app, call backs, streak, trend and tags; tap for the last 10 jobs, bonus history (staff only), Spot check, Log call back |
| The queue cards in §8 on the existing attention queue | All ten §8 triggers already produce a card (Steps 3, 5, 7: walkthrough flagged, call back unbooked / visit soon / fixed, bonus changed, Orange, Red, bonus due, standards unsigned, payment hold). Nothing new to add; Step 7's spec covers the ones it built, Step 3's the call backs |
| Counts on the strip and the cards come from one query | `buildContractorsView` derives the strip from the rows it lists; the unit test pins strip = list |
| Point the home dashboard's Contractor section at the same source | `loadDashboard` loads the same view; four tiles (`contractors.on_green`, `open_callbacks`, `bonus_due`, `standards_unsigned`) read it |
| Every number is read from the model | The page and the tiles render `ContractorsView` fields only |
| E2e as PC | `e2e/pc-contractors.spec.ts` |

## Acceptance (brief Step 8)
- Every §8 trigger produces exactly one card — unchanged from Steps 3/5/7 (keys are per trigger; dismissals per episode).
- Strip counts equal the list — unit test and e2e, per colour and for Not signed.
- The dashboard and PC Command show the same numbers from the same query — the e2e reads the strip then the tile.
- Visual match with the mockup on a phone in both themes — built to the mockup's layout (lights grid, three stats, rows with the four mini counts and tags, the sheet with dots, buttons) in PC Command's own tokens. Phone screenshots are yours on the deployed build.

## Decisions taken
1. **Step 5's plain `/pc/status` table is removed**, not kept beside the new tab — two lists of the same rows would be a single-source violation. Its spec now opens `/pc/contractors`.
2. **"Log call back" is not a fifth route** (brief §7): the row offers the painter's finished jobs and lands on that job's call-back card.
3. **Rows sort Red first** so the painters needing a decision are at the top; the mockup's order was by name.
4. **Painters with no status yet show "NOT EVALUATED"** rather than being hidden — an employed painter who has never led a job, or a painter before the first sweep.
5. **The bonus read on the dashboard tolerates the RLS refusal** for a staff role outside owner / admin / PC: the bonus column is empty and nothing else breaks.

## Open for Tom
- Nothing to paste — no migration in this step.
- Whether the rows should sort by name instead of worst-first.

## Not in this step
Step 9: the full-loop story and hardening.

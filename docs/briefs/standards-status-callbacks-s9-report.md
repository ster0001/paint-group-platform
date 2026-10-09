# Finish standards, painter status, call backs — Step 9 report (hardening and the full loop)

**Date:** 9 October 2026 · **Branch:** `feat/status-full-loop` · **Brief:** §10 Step 9 · **Before:** `standards-status-callbacks-s8-report.md`

## What was built

| Brief asked | Built |
|---|---|
| One e2e story across roles: sign → offer → reminders → checks → signed walk-through → 7 days → clean ×4 → Green → picker priority and 3-business-day due date → 4 qualifying jobs → bonus review | `e2e/status-full-loop.spec.ts`, story 1 — the painter signs on the phone, the PC's offer RPC answers, the evaluator runs through the real sweep after each stage, the board and the draft RPC are read back |
| The failure story: check fails and is fixed the same day; a walk-through flagged → return visit; call backs on day 5 and day 9; colour checked at each point against §4 | Story 2 — Yellow (8 of 9 first-time passes), Yellow (1 call back), Orange (2 call backs), Orange with the day-9 job clean (R6); the `status_changed` events replay new → green → yellow → orange |
| Prove the customer role sees none of it | Story 3 reads all seven new tables as the customer: every one empty |
| Greps clean for client-side writes to result, colour, status or money columns | `lib/painterStatus/boundary.test.ts` (three checks, runs with the unit suite) |
| Update CLAUDE.md, ARCHITECTURE.md and the messaging inventory | CLAUDE.md: one evaluator / one writer; "sql done" is a claim; check CI after every push. ARCHITECTURE: Step 9 paragraph. Inventory: rows 11–18 (painter) and 17–19 (office) were added in Steps 2–7 and are complete |

## Acceptance (brief Step 9 and §11 definition of done)
- Both stories green in CI — the spec runs in CI on this PR (the test project's lock is still held locally by yesterday's dead CI connection; see below).
- Customer-role RLS denial for every new table — story 3.
- Greps clean — the boundary test is green (one allowed writer: the reminder sweep plans moment rows, by design since Step 4).
- §11 1–8: enforced on the server (Steps 2, 5, 7); surfaces open at the job's level (Step 1); one call-back record, four routes, the Flow column (Step 3); the colour rebuilds from the event log and the 24 golden tests pass (Step 5); one source for PC Command, the painter app and the dashboard (Steps 6, 8); nothing readable in the customer role (every step's spec); every number a Settings value (`standards_rules`, `job_update_rules`, `painter_status_rules`, `visit_booking_rules.publicHolidays`, `contractorTermsDays`); every message in the inventory with editable wording.
- §11 9 is yours: on your phone, both themes — as a painter see the light, tap in, see why, open a surface standard from a job; as PC log a customer call back and watch the column appear.

## Open ⚑ for Tom (the PR body list, §3)
| ⚑ | Default shipped | Where |
|---|---|---|
| 1 | 7 days grace, then no offers | `standards_rules.graceDays` |
| 2 | Employees: reminders + card, no block | built that way |
| 3–6 | Update = tick or photo; one update per moment; follow-ups 10:30/1:30 and 5:30/7:00; credits same job first | `job_update_rules`, evaluator |
| 7 | Picker sorts Green first, shows lights, PC chooses | board |
| 8 | Owner records "Spoken with, offers allowed" with a reason; lasts until the colour changes | `painter_clear_red` |
| 9 | Counter counts qualifying jobs while already Green; resets on leaving Green | evaluator |
| **10** | **GST on the bonus — not decided.** Approvals OFF until you say | `painter_status_rules.bonusApprovalsEnabled` |
| **11** | **Employee bonus through payroll** — recorded, on the CSV, never paid by the platform | payroll export |
| 12 | Painter is told on approval — **with the amount, by your ruling of 8 Oct** | message 8 |
| 13 | Bonus amounts: owner, admin, PC | RLS |
| 14 | Mon–Fri less the Booking-rules public holidays | `business_days_after` |
| 15 | PC changes a reason; only the owner voids | Step 3 |
| 16 | Status belongs to the account that accepts the offer | Step 5 |
| 17 | Reminders days 2, 4, 6 at 9 am; card day 7 | `standards_rules` |
| 18 | New material version: what changed, re-tick six, same grace | Step 2 |
| **19** | **Contractor agreement wording** — your check before launch | — |
| 20 | Example photos: schema ready, none loaded | — |
| 21 | Painters see status — ON | `statusVisibleToPainters` |
| 22 | Painter marks fixed, PC closes | Step 3 |
| 23 | Hold = back to default terms, never later | Step 7 |
| 24 | Fewer than 5 checks or moments: band by misses | evaluator |
| 25 | Only jobs signed off on or after the launch date | `launchDate` 2026-10-08 |

## Decisions taken
1. **Facts are written as rows in the loop spec; routes are not re-driven.** Steps 2–7 each prove their own route through the UI; the loop proves the EVALUATOR's answer and the colour at each point through the real sweep. Driving twelve jobs through twelve UIs would take an hour and prove nothing new.
2. **The reminder sweep is the one allowed non-RPC writer of moment rows** (Step 4's design); the boundary test names it rather than weakening the rule.
3. **No migration in Steps 8–9.**

## Not in this step
Nothing — the brief's build order ends here. Rollout (§12) is yours: tell the crews, two or three trusted painters sign first, then message 1 to everyone; settle ⚑10, ⚑11 and ⚑19 before switching bonus approvals on.

# Finish standards, painter status, call backs — Step 3 report (call backs: one record, four ways in)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** `docs/briefs/claude-code-brief-standards-status-callbacks.md` §10 Step 3 · **Before:** `standards-status-callbacks-s2-report.md`

## What was built

| Brief asked | Built |
|---|---|
| `wo_callbacks` with open → booked → fixed → done, plus void | `20270226000000_wo_callbacks.sql`: the table, the enums, RLS (staff; the painter it is about and the one booked to fix it; customers nothing), and six RPCs. Only `wo_callback_close` (staff) ends one; `wo_callback_void` is the owner's with a reason; the PC changes the reason with `wo_callback_set_reason`. All logged on `wo_events` (and `contractor_events` for the painter) |
| Every route records a reason (default workmanship) and a reported date (default today) | Columns with those defaults; the one `wo_callback_log` behind every route; the route 3 form shows both, routes 1, 2 and 4 default them (the mockup drew them on route 3 only) |
| Route 1: a FAIL asks "rectify today, or a call back?" | `QaCheck` after a logged FAIL; "Call back" logs source `qc_fail` linked to the check; the check stays a FAIL (C4) |
| Route 2: a flagged walk-through → queue card + the question on the job page; passed_after_fix when fixed and signed same day; critical if unsigned by end of day | Queue kind `walkthrough_flagged` from the sign-off's flagged areas (critical once the flag's day has passed); the job page asks "Is a call back required?"; `wo_signoff.outcome` derived by trigger: `passed_after_fix` when the signature follows a rectification or a withdrawn flag, `failed_callback` when route 2 logs one |
| Route 3: "Customer called back" with date, what is wrong, photos, reason, return visit → record + booking for the painter who did the job | `CallbackPanel` form; the visit is written by the RPC (the job may be closed) for the fixer, defaulting to the painter who did the job |
| Route 4: a scheduler tick box; attach to an open call back, never a second record | The Extra visit sheet's **Call back** tick; `wo_callback_log(source scheduler)` joins an open call back on the job (`ok:<id>:attached`) |
| Flow: a Call backs column only while one is open; a Call back tag | Done, above the river; absent from the DOM when none is open; plus an **Invoice chasing paused** tag |
| Set and clear the invoice chase hold through the existing mechanism | `invoices.chase_hold_kind` added so a close clears only what a call back set; a staff dispute hold survives; the ladder and `stillNeeded` already honour `chase_hold_reason` |
| Never reopen a closed job; never touch contractor pay | No stage write anywhere in the migration; no pay column touched; asserted in the spec |
| E2e as PC for each route and as the painter | `e2e/callbacks.spec.ts`: route 3 and route 1 through the screens, route 2 from the queue card, route 4 through the RPC the tick calls; the painter sees what is wrong and the day, cannot close, marks fixed with a photo |

## Acceptance (brief Step 3)
- All four routes produce the same record type with a reason and a reported date — in the spec (`source` differs, everything else the same shape).
- Route 4 on a job with an open call back creates no second record — in the spec.
- Logged → closed in the e2e, and only the PC's close ends it (the painter's close is `error:not_staff`).
- The column is absent from the DOM when no call back is open — in the spec.
- Invoice chasing pauses on log and resumes on close, proven against the ladder's own column (`chase_hold_reason`), which `invoiceChaseable` and `stillNeeded` read.
- The record names the painter who did the job even when another painter is booked to fix it — in the spec (`painter_id` vs `fixed_by_painter_id`).

## Decisions taken
1. **The invoice hold gained a kind,** not a second mechanism: `chase_hold_kind` beside the existing reason column, so the close never wipes a dispute hold set by hand.
2. **The walk-through outcome is derived by a trigger on `wo_signoff`**, not by rewriting the three signing functions: `rectified` or a rectified / withdrawn area at signing → `passed_after_fix`; route 2 marks `failed_callback` while unsigned.
3. **"No, fixed and signed today" on the route 2 card is a dismissal** (the signature itself records the pass-after-fix on the painter's phone); "Yes, call back" opens the job page's form prefilled.
4. **Route 4 lives on the Extra visit sheet** (the board's way of adding a visit to any project, finished ones included); the offer sheet's "Walkthrough not required" box is for new jobs, which a call back never is.
5. **A photo is required to mark fixed** (⚑22's "with a photo"); the office can close without one.
6. **`wo_painter_on_job` counts a return-visit holder**, so a painter who did not do the job but is booked to fix it can upload the fix photo.
7. **Message 7** goes to the fixer, once per visit day.

## Open for Tom
- Paste `20270226000000_wo_callbacks.sql`.
- The queue cards' wording and the painter's text (Settings → Automations → Call back booked).
- Whether the Invoicing list should also badge "chasing paused" (today: Flow and the Money view's tooltip).

## Not in this step
Reminder moments (Step 4), the evaluator and scoring of call backs (Step 5 — `callbackScored` is written and tested, unused yet), the traffic light (Step 6), payment and bonus (Step 7), PC Contractors (Step 8).

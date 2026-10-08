# Finish standards, painter status, call backs — Step 4 report (reminder moments, follow-up texts and credits)

**Date:** 8 October 2026 · **Branch:** `feat/standards-status-callbacks` · **Brief:** §10 Step 4 · **Before:** `standards-status-callbacks-s3-report.md`

## What was built

| Brief asked | Built |
|---|---|
| Extend the EXISTING reminder automation; record each §4.2 moment per work order | `wo_reminder_moments` (migration 20270227), planned by the same sweep from the same planner (`jobRhythm.ts`); no second scheduler. The old per-rung claims are gone for this automation |
| Mark a moment answered by an app update on its day (⚑3, ⚑4) | A trigger on `wo_events`: a tick, a photo or the all-done event by the painter answers the earliest open moment of that Melbourne day; one update answers one moment |
| Up to three texts on the day at the ⚑5 times; stop once answered; nothing after 7 pm | `decideSend` + `settings.job_update_rules` (10:30 / 13:30 after a 7:30 moment; 17:30 / 19:00 after a 3:30 one; lastSend 19:00; maxTexts 3). Each send is claimed on the row first. Texts 2 and 3 have their own editable wording |
| PC "No work today" (job page and scheduler) skipping that day's moments | `wo_set_no_work_day` (today or a past day, with a reason) + `wo_clear_no_work_day`; the card on the job page and the control on the board's block detail. Skipped moments leave every count even if texts went |
| Recalculate future moments when booking dates move | `reconcilePlan` on every sweep: un-happened moments follow the new dates; past ones never change; rungs that vanish are skipped as rescheduled |
| Show the job's moments and their state on the painter's work order screen | `UpdateMoments` card, the mockup's words |
| Third text general wording now; Green wording in Step 6 | `contractorJobUpdateSms3`: "Last reminder today…"; the Green variant waits for status |
| Inventory | Row 16 (the automation had no row at all — Step 0 found the doc stale) |
| E2e as the painter and as PC | `e2e/automation-job-reminders.spec.ts` rewritten |

## Acceptance (brief Step 4)
- No text after a moment is answered — in the spec (the sweep after the photo sends nothing).
- Never more than three texts per moment — in the spec (a moment at three gets no fourth) and the unit test.
- Nothing after 7:00 pm — `withinSendingWindow`, unit-tested at 19:05 (grace for the half-hour sweep) and 19:06.
- A skipped day's moments are absent from every count, including after texts went — the spec marks No work after two texts; both moments read `no_work`.
- The schedule matches §4.2 for 1, 2, 5 and 9-day jobs — pinned in `reminderMoments.test.ts` against the planner.

## Decisions taken
1. **A day that went by with no text is `not_sent`, not a miss.** Step 0 found that a failed or `nobody` send used to burn the claim invisibly; now the row says what happened and Step 5 will never score it against the painter.
2. **A missed day is never caught up.** A moment is texted only on its own day (the old engine sent a day-1 text at 2 pm or a last-day text three days late).
3. **One update answers one moment** (⚑4), earliest first, so a one-day job's morning and afternoon each need their own.
4. **Credits are not stored.** R9/⚑6 are derived from these rows by the evaluator in Step 5, as the brief requires.
5. **The follow-up times and the 7 pm cut-off are one Settings row**, `job_update_rules`, so the e2e can drive them and Tom can tune them.

## Open for Tom
- Paste `20270227000000_reminder_moments.sql`. The next sweep after that plans every open job's moments; nothing is re-texted for moments already in the past (they become `not_sent`).
- The second and third texts' wording (Settings → Automations → Update your work order).

## Not in this step
The evaluator and credits (Step 5), the Green wording of the third text (Step 6).

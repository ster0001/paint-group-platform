# Work order UX — Step 3: 40% check-in and defect-day note

Brief `docs/briefs/claude-code-brief-work-order-ux.md` §4.3 Triggers B and C; ledger `docs/briefs/work-order-ux-progress.md`.

## What changed
- **Migration `20270302000000_customer_notes.sql`** (Tom pastes after 20270301): one row per job per note kind (partial unique on `(work_order_id, kind)` for `checkin_40` / `defect_day`), `wo_draft_note(wo, kind, text)` — inserts once, answers `already` on a repeat, refused by `wo_customer_updates_allowed`. Read-back `_expect_`: note_unique 1 · fn 1 · grants 2.
- **The one planner** `lib/workorder/jobRhythm.ts`: `customerCheckinDay(days, pct = 0.4, minDays = 3)` — first morning at or past the share (3 → day 3, 5 → day 3, 7 → day 4, 10 → day 5; none under 3 days) — and `customerDefectDay(days)` — the defect-tape day on 3+ day jobs, the last day on shorter ones (every job, R11).
- **The sweep** `lib/automations/sweeps/customerUpdates.ts runCustomerNoteTriggers` (half-hour campaign sweep, `?only=updates`, before the auto-send): drafts the check-in from `customerCheckinTime` (09:00) and the defect-day note from `customerDefectDayTime` (07:30), both wording fields under registry key `customer_updates_queue`; `checkin_percent` (40) and `checkin_min_days` (3) are its timing values. Idempotent.
- **Timeline only** (R10, and the Step 3 default for the defect-day note): auto-send and a person's Send to timeline record these two kinds without email or text (`isTimelineOnlyKind`).
- `CLAUDE.md` gains the standing rule **One customer-updates queue**; help (`pc.md`, `customer.md`), inventory row 10a, `docs/ARCHITECTURE.md`, the session ledger.

## Decisions taken (defaults — say if wrong)
- **M1:** the existing `customer_defect_tape` TEXT is untouched (9:00, 3+ day jobs, its own e2e). The defect-day note is a separate timeline-only row at 7:30 on the same day, on every job. If you want the text folded into the queue instead, that is a small follow-up.
- The check-in share and floor are the office's numbers (Settings → Automations → Customer updates), defaults 40 / 3.

## Tests
- Unit: `jobRhythm.test.ts` (+6: 3/5/7/10-day maths, none on 2-day jobs, the office's numbers), `lib/automations/sweeps/customerUpdates.test.ts` (notesDue, dueNow incl. ⚑2). Whole suite green; lint at the ceiling.
- E2e `e2e/wo-customer-notes.spec.ts` on C1: a five-day job on day 3 gets both notes, a two-day job ending today gets the defect-day note only, the second sweep drafts nothing; PC sees both kinds; with the switch on the sweep sends both at once, no message row is recorded for the job, and the customer reads them with the sender line and ONE Reply button.
- Local result: see the PR's CI e2e run if the C1 lock was held when pushed.

## Tom's two-minute phone check (brief §5 Step 3 accept)
As a painter: open a job → By surface → Mark all walls painted → Undo. As PC: Customer updates → the milestone draft → Send to timeline. As the customer: the entry with *Felipe, Paint Group* and Reply to Felipe.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

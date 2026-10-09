# Scheduling board: change the finish date of a running job — manual test (8 Oct 2026)

Branch `feat/schedule-end-date-in-progress`. Migration **20270245000000_schedule_end_date_in_progress.sql** — paste it
in the SQL editor (starts with `set lock_timeout`), compare the read-back row to its `_expect_` values (all six `true`),
and check `_prod_migrations` has the row before the deploy goes live. The board's Finish date box works without the
migration; the migration adds the database's refusal to move a started job's start, and makes a dragged booking's end
reach the job's own dates.

## A contractor's job under way
1. Projects → Schedule. Find a **cyan** (in progress) block. Try dragging it along the row: nothing moves and no sheet opens.
2. Click it. The sheet shows **Finish date — the job has started, so the start stays** with the current last day.
3. Pick a day two working days later. The line under it reads **Last day …**. Tap **Save finish date**.
4. The message reads "Finish date moved to … The final walkthrough moved with it." The block on the board now ends on that day; the start has not moved.
5. Open the job (**Open the job — stage view**): the job's dates show the new last day, and a booked final walkthrough is on the new day at the same time.
6. Sign in as that painter (portal) → the job page and **Calendar** show the new last day. If they have Google Calendar connected, the event's run of days follows within a minute.
7. Back on the board, pick a **Saturday** for a painter who does not work Saturdays: the line reads "… — the next day they work" and the save lands on the Monday.
8. Pick a day before the job started: "That's before the job started — pick a later day." Nothing changes.

## An accepted (green) booking
9. Click a green block: the same Finish date box is there. Change only the last day and save — the start stays. Dragging the block still moves the whole booking as before; after a drag, the job page's dates show the new end too (needs the migration).

## Employed painters on a running job
10. Click an employee's block on a cyan job whose first day has passed. Under **… days on this job** the start box is greyed out; change the second date and **Save days**. The job's span follows.

# Scheduling board: second visit + pink hold — manual test (1 Oct 2026)

Branch `feat/schedule-hold-second-appointment`. Migration **20270209000000_schedule_holds_and_extra_visits.sql** — paste
it in the SQL editor (starts with `set lock_timeout`), compare the read-back row to its `_expect_` values
(2 / 1 / 2 / 0 / 6), and check `_prod_migrations` has the row before the deploy goes live.

## A second visit on a booked job
1. Projects → Schedule. Find a painter with a green (accepted) or dashed-green (assigned) job on their row.
2. Drag across two **empty** days on that row a few days after the job. The sheet opens with three tabs: **Block out · Extra visit · Hold**.
3. Tap **Extra visit**. **Which job** lists only jobs on this row. Pick the job, type "back to finish the ceilings", **Add the visit**.
4. The job appears a second time on the row, same colour, labelled **EXTRA VISIT** with a dotted left edge. Toast: "Visit added — it's on the board and in their calendar."
5. Sign in as that painter (portal) → **Calendar**: the extra days show under the job's name.
6. Back on the board, drag the visit one day along the row → **Move this visit?** → **Move visit**. It moves; the original booking does not.
7. Click the visit → **Remove this visit**. It goes; the job's booking is untouched.
8. Try the Extra visit tab on a row with nothing booked: the sheet says to drop a job from the tray first and the button is disabled.

## Hold the days while the client decides
9. Drag across empty days on any row → **Hold** tab. Pick a tray job under **Waiting on which job** (or leave "No job yet"), note "client confirming by Friday", **Hold these days**.
10. A **bright pink** block reads **HELD · WAITING ON CLIENT · WO-…**. Legend has a pink **Held · waiting on the client** entry.
11. Sign in as that painter: the hold is NOT in their calendar and not in their jobs.
12. Click the pink block: the note, "Book it now — send the offer for these dates" (only when the job is in the tray), and **Release this hold**. Tap **Book it now**: the usual offer sheet opens on the held dates. Cancel it.
13. Drag another tray job over the held days: the ghost reads **DAYS HELD — DROP TO BOOK OVER THE HOLD**; the sheet carries a pink note. Cancel.
14. Drag the tray job the hold is for onto a row and, on the offer sheet, tap **Hold these dates instead — waiting on the client**: a second pink block, no offer sent, the job still in the tray.
15. Send the offer for that job (any row). Both pink holds for it disappear on their own (resolved by the booking).
16. Make a hold starting within 7 days. CRM → **Today** shows **Held dates — <painter>'s days are held for <job> — dd/mm–dd/mm**, action **Open the board**. Release the hold from the pink block; the item goes.
17. Drag a pink hold along its row → **Move hold**. Drag it to ANOTHER row: the sheet refuses with a message (release and re-hold instead).

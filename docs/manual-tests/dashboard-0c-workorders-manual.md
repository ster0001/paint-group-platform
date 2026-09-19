# Manual test — Home dashboard v2 · session 0c (capture: work orders)

Run `20270178000000_dashboard_capture_workorders.sql` and read the select at its end: expect
`new_columns_expect_3 = 3`, `new_tables_expect_2 = 2`, `policies_expect_3 = 3`,
`new_triggers_expect_3 = 3`, `tick_writes_all_done = true`, `new_functions_expect_5 = 5`,
`day_hours_expect_8 = 8`, `accepted_without_booked_end_expect_0 = 0`, `contractors_opted_in_expect_0 = 0`.
`jobs_with_all_done` and `rechecks` are the backfill counts.

1. **Contractors page.** Every painter reads "Hours from schedule". Click one → "Asks for hours".
2. **As that painter** (their portal login), open a job in progress, tick every surface. The
   **All surfaces done** card now shows **How long were you on site?** pre-filled from the booking.
   Change to 3 days / 22.5 hours and press **All done — next step**. The job moves on as before.
3. **Their self-invoice** for that job (when it is generated) carries a line "Time on site — as
   entered by the painter · 3 days · 22.5 hours · reference only, not charged" with no amount.
4. Switch the painter back to "Hours from schedule". Their next job asks nothing.
5. **Booking extension.** On a booked job, as the painter set a later finish date. The job's
   activity shows a booking extended entry with the days added.
6. **QA.** Book a check, fail it, book another: the second check is attempt 2 (visible to the
   dashboard; the PC card is unchanged for now).
7. **Review.** On a completed job's PC page: **We asked for a review** → "Asked <date> — not
   received yet"; pick stars and **Review received** → "Received <date> · ★★★★★".
8. **Settings.** `worked_day_hours` appears among the numeric settings at 8 hours; changing it
   changes the painter's pre-fill on their next finish.

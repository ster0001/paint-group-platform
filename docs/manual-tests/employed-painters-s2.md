# Manual test — employed painters, Session 2 (assignments and the calendar)

Needs `20270153` and `20270154` applied. Make two or three test painters employees first (test project SQL):
`update public.contractors set employment_type = 'employee' where id in ('…');`

1. **Projects → Schedule.** Those painters' rows now read **EMPLOYEE** where a contractor reads READY / NOT READY.
2. Drag an Unscheduled job onto an employee's row. The sheet says **Assign this job?**, shows a time budget (days · hours) and no price, and the button reads **Assign job**. Confirm the walkthrough (or tick not required) and assign.
3. The job leaves the tray. A green block with a dashed outline and **NOT YET SEEN** sits on that row with a ★ (they are the lead). The customer's booking confirmation goes out now (check Messages), and the painter gets the "tap Accept" text/email.
4. Click the block. The detail sheet lists the crew, **Add a painter** (pick another employee → Add) and **Take X off this job**. Add two more. Each row now shows the same job with **1 OF 3 / 2 OF 3 / 3 OF 3**; only one ★.
5. Open a non-lead's block → **Make X the lead painter**. The ★ moves; the customer's portal shows the new name on next load.
6. Try **Take X off this job** on the lead while others remain → refused with "name another lead painter first".
7. Drag one painter's block to other days → **Move these days?** → Move days. The block goes dashed again (their Accept is cleared) and they get the "accept again" text.
8. Drag a job onto a **contractor's** row: the sheet is still **Send this offer?** with their price — nothing changed for contractors.
9. Drag a job onto an employee who already has a job on those days → the sheet's error names the other job's WO reference. Type an override reason and assign → goes through; the reason is on the job's event log.
10. `select count(*) from public.booking_offers where work_order_id = '<the job>'` → 0. An employee job never has an offer.

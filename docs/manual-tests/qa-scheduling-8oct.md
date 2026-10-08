# Manual test — quality checks in the calendar, site check-ins (8 Oct 2026)

Run after migration `20270247000000_qa_check_scheduling.sql` is pasted and its read-back row matches.

## 0. Who gets the invites
1. Settings → Staff alerts. The matrix has a new column **QA invite** with an **Email** box only (no Text).
2. Tick **Email** under **QA invite** on Felipe's login (projects@). Save.

## 1. Scheduled at booking
1. Pick a job for a painter who is still new (fewer than three closed jobs), or tick **Quality check required** on the job first.
2. On the board, offer it with the final walkthrough confirmed (say a Friday, 3:00 pm).
3. Accept it on the painter's phone.
4. Open the job in PC Command → **Job facts**. Expect **Quality check · <the Thursday> 09:00** and, under it, **Calendar invite sent to Felipe …** within a minute (refresh).
5. Felipe's inbox: an invite *Quality check — <address> (<WO ref>)*, Thursday 9:00–10:00, with **Add to calendar** / Accept.

## 2. Move it by hand
1. **Move** → pick the Friday (the final's day) and 4:00 pm → **Save**. Expect "A check has to be before the final walkthrough…".
2. Pick the Wednesday, 10:30 → **Save**. Expect "Scheduled — the calendar invite is on its way."
3. Felipe's calendar entry moves to Wednesday 10:30 (an update to the same entry, not a second one).

## 3. Move the final
1. In the walkthrough card, rebook the final for the following Tuesday, 2:00 pm.
2. Refresh: the check now reads the **Monday 10:30** (the working day before, same time). Felipe's entry moves again.
3. Repeat with a Monday final where the Friday before is a public holiday in Settings → Booking rules: the check lands on the Thursday.

## 4. Cancel the final
1. Cancel the booked final walkthrough.
2. The check stays where it was. PC Command (the console) shows **Quality check still booked for …, but the final walkthrough was cancelled** with **Open the job**.
3. Rebook the final: the card goes and the check moves to the working day before it.

## 5. Site check-in
1. On a job in progress: **+ Add a site check-in** → today, a time later today → **Add it**.
2. The painter's job page shows **Paint Group site check-in: <today>**.
3. PC Command shows **Site check-in today at <time> — <address>**; **Record the check** opens the job at the check card. Tick the standards, log a pass: the card goes.

## 6. Taking checks off the books
1. On a job with a dated check, press **Quality check not required on this job**.
2. Felipe gets a **Cancelled: Quality check — …** email and the entry leaves his calendar.

## 7. Nobody ticked
1. Untick **QA invite** for everyone, move a check.
2. The line under the check reads **No calendar invite — nobody is ticked for "QA invite"…**. Tick Felipe again: the next change (or the next morning's sweep) sends the current date.

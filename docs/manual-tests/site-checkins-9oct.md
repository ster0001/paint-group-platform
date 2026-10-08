# Manual test — site check-ins: Felipe's visits, notes and photos (9 Oct 2026)

Needs migration `20270248000000_site_checkins.sql` pasted on production and its read-back
row matching every `_expect_` value. Check the ledger first:
`select * from public._prod_migrations where name = '20270248000000_site_checkins.sql';`
— no row means it has not run; the new card will say it couldn't read the site check-ins.

## Adding one holds nothing
1. Projects → open a job that is **In progress**. Under **Job facts**, press **+ Add a site check-in**,
   pick today and a time later today, press **Add it**.
2. Expect *Site check-in added — it is in the quality-check calendar. Nobody else is told.* and a
   **Site check-ins** card on the job ("your own visits — no pass or fail").
3. The **Quality checks** line in Job facts does not count it, and if the job had **Quality check not
   required** pressed, it still reads *Not required — waived by the office*.
4. Felipe (ticked for **QA invite**) gets a calendar invite *Site check-in — <address> (WO-…)*.
5. The painter gets no text, no email, and their job page does not mention it.

## On the day
1. **PC Command** shows *Site check-in today at <time> — <address>* with **Open the check-in**.
2. Open it. Write a note, pick a photo, tick **Send to the painter**, press **Add note**.
3. Expect *Note saved with 1 of 1 photo. Sent to <painter> by text…* (or *…no text or email went:* with
   the reason). The painter receives a text (and an email, if they have one) with the note and a link.
4. Add a second note **without** the tick. It reads *Office only — the painter has not been sent this.*
5. Press **Mark visited** → *Visited <time> · <you>*; the PC Command card is gone.

## What the painter sees
1. Log in as the painter (or open their job page from **as contractor**). Under **Notes from Paint
   Group** is the sent note and its photo — tap it to open. The office-only note is not there.
2. Their **Finish & walkthrough** card lists only *Paint Group quality check: …*, never a mid-job,
   spot check or site check-in.

## What the customer sees
1. Open the customer's portal (**/account/project**) for that job: no site check-in, no notes, no
   photos. *Quality check passed* appears only once the END-OF-JOB quality check passes — a passed
   mid-job or spot check never puts it there.

## The job finishes with a visit still open
1. On a job with an open (not visited) site check-in and no quality check due, let the painter finish.
   The job goes to **Walkthrough** as usual — the visit does not hold it.

## Existing site check-ins
The migration moved the open ones the office added since 8 Oct (same calendar entry). Its read-back
row shows how many moved (`moved_site_checkins`) and how many older office-added open mid-job checks
were left as quality checks (`office_mids_left`) — tell Claude the numbers if `office_mids_left` > 0.

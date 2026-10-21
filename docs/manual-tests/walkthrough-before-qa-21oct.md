# Manual test — the walkthrough goes ahead before the quality check (21 Oct 2026)

Needs migration `20270284000000_walkthrough_before_quality_check.sql` pasted on production
(check the ledger: `select * from public._prod_migrations where name like '20270284%';`).

## Book the final with a check open (office)
1. Projects → open a job that has a quality check on it and no final booked yet
   (**Job facts** shows a *Quality check* line; the **Walkthrough** card says *not booked*).
2. Pick a date and time → **Book final**.
3. Expect **Final walkthrough booked.**, the header showing the date, the customer and painter
   calendar invites, and the check moving to the working day before (16e in the PC guide).
   - Before the migration a FIRST final here answered *Quality check first — the final isn't
     booked with the customer until the checks pass.*

## Start the walkthrough with the check unpassed (painter)
1. On a job that needs a check, tick every surface, upload the after photos, answer the
   finishing-up list, tap **All done — next step**. The message now reads *Paint Group still
   has a quality check to do on this job — it doesn't hold you up …*; the job sits at
   **05 Quality check** on the console as before.
2. Reload the job page. Expect:
   - the **Quality check** notice saying the check *doesn't hold you up*;
   - the pinned bar reading **READY TO SIGN OFF · Start the walkthrough**, with the line
     *Paint Group's quality check is still to come — it doesn't hold this up.*;
   - the **Walkthrough & sign-off** card with the booked date.
3. Tap **Start the walkthrough** (bar or card). The customer's view opens on the phone
   (**READY FOR YOUR LOOK — Your job is finished**). On the console the job is now at
   **06 Walkthrough** and the activity shows *walkthrough before QA*.
4. The check is still on the job, still open. Log it from the console as usual: tick the four
   standards, **Log check — PASS**. Expect *Passed — all checks clear* and the job staying at
   **06 Walkthrough** (nothing re-routed). The painter's page then reads **Quality check passed —
   Paint Group signs this job off from the office** if the customer has not yet signed.

## Still held (by design)
- A job with **Walkthrough not required** and an open check: **Close the job** on the Next-step
  card still answers *1 quality check still open* — the office logs the check first.
- Colour-match codes still needed: starting the walkthrough from Quality check answers
  *Not yet — colour match codes still needed for …* in the bar.
- A check that has already **passed**: the painter runs no walkthrough; the office signs off
  (24 Sep rule, unchanged).

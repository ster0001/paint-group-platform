# Manual test — rebook a cancelled walkthrough (8 Oct 2026)

Needs migration `20270241000000_walkthrough_rebook_after_cancel.sql` pasted on production
(check the ledger: `select * from public._prod_migrations where name like '20270241%';`).

## 12A Cavell Court (PS-3156) — the job that started it
1. Projects → open **PS-3156 — 12A Cavell Court**.
2. The **Walkthrough** card says *not booked*; the 13 Oct 15:30 final shows as **cancelled**.
3. Pick the new date and time with the client, press **Book final**.
4. Expect **Final walkthrough booked.** under the card, the header showing the new date, and the
   customer and painter receiving the calendar invite.
   - Before the migration this answered *Quality check first — the final isn't booked with the
     customer until the checks pass.*

## Any job — cancel, then rebook
1. On a job with a booked final walkthrough, press **Cancel** on the Final row → *Updated.*, the row reads *cancelled*.
2. Pick a date + time → **Book final** → *Final walkthrough booked.*
3. Pick another date → **Rebook final** → the earlier row turns *cancelled*, one booked row remains.

## Still refused (by design)
- A job that has NEVER had a final booked and has an open quality check: **Book final** answers
  *Quality check first*. Book it once the check passes.
- Moving the date never signs the job: sign-off still waits for the 06 Walkthrough stage.

# Manual test — walkthrough with an open variation, the quality-check strip, the painter's two-business-day text (19 Oct 2026)

**Before anything:** paste `supabase/migrations/20270277000000_walkthrough_with_open_variations.sql` on **production** (`llmrvgdequpmzzuaxdhq`) and read back the ledger row for it. Items 2 and 3 need no migration.

## 1. The walkthrough goes ahead with a variation still undecided
1. Pick a job under way where the painter has ticked every surface and the after photos are in, and raise a variation on it (from the painter's phone, or write one down in PC Command) — leave it **raised** or **priced**.
2. On the painter's phone the pinned **ALL SURFACES DONE · Start the walkthrough** bar is there. Tap it (with the finishing-up list done).
3. The job moves on — to the quality check if one is due, otherwise the walkthrough opens. It no longer says **1 variation still waiting on a decision**.
4. PC Command → the job: **Before the next step** lists the variation as a tick with *— not holding the walkthrough now every surface is ticked*; **Variations for approval** still carries it. Decide it there in your own time.
5. Counter-check: untick one surface on a job with an open variation, and the finish is refused with the surfaces line first (and, from completion prep, the variation line again).

## 2. A required quality check at the top of PC Command
1. Open **PC Command**. Above the four tiles, a cyan **Quality checks to book in before the final walkthrough** strip lists every open job that needs a check, from booking until the check's day.
2. A job whose check has no day reads **Quality check required — no day booked yet** with **Book the check**; one placed from the booking with no final walkthrough booked reads **… pencilled for … final walkthrough not booked** with **Book it in**; one before a booked final reads **Quality check … before the final walkthrough on …** with **Open the check** and **Confirmed**.
3. Tap the button: the job page opens at the check's day-and-time card. Set the day, book the final, or record the check — the line changes state or goes.
4. On the check's own day the line is gone and the **Quality check today at …** card in **Needs you now** takes over; a job parked at Quality check shows **Quality check to do** instead.
5. A booked job that starts more than a week away is not on the strip yet.

## 3. The painter's text two business days before the walkthrough
1. **Settings → Automations**: **Final walkthrough in two business days — running ahead or behind?** is listed under the painter messages, on, text by default, with its wording editable.
2. Pick a job under way whose walkthrough day (the booked final, else the last booked day) is two business days from today — e.g. on a Monday, a job finishing Wednesday. Between 7:30 am and noon the painter on it gets: *Paint Group: hi Sam, the final walkthrough on WO-1234 at Thornbury is Wednesday 21 October — two business days away. Running ahead or behind? Change the date in the app …* with the job link.
3. The job's event log carries `finish_reminder_sent`. The next sweep sends nothing more for that date.
4. The painter taps **Change the date** on **Finish & walkthrough** and moves it a week: no further text today; two business days before the new date, a new one.
5. Outside the window (after noon) nothing goes, and nothing is sent late in the afternoon. A hand run: `GET /api/cron/campaign-sweep?only=finish` with the cron secret.

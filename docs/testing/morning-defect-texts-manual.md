# Morning heads-up + defect-tape text — manual test script for Tom

Branch `feat/morning-update-and-defect-texts`. No SQL to paste.

## After the deploy
1. **Settings → Automations → Contractors**: a new row **Update your work order — morning heads-up**, switched On, Text. Press **Edit wording**: one text, an email subject and body. Press **Send test text to me** and read it on your phone.
2. **Settings → Automations → Customers**: a new row **Mark touch-ups with tape before the walkthrough**, On, Text. Edit wording shows the first text, the second (afternoon) text, and the email used when a customer has no mobile. Send yourself a test text and change anything you'd say differently, then **Save automations**.

## The painter's morning text
1. Find a job under way on the schedule whose half-way or last day is tomorrow (a 3–6 day job), or tomorrow is its 30% / 60% / last day (7+ days).
2. Tomorrow at about 7:30 am the painter (and any crew on the job) gets "today is an update day … day N of M" with the job link. At 3:30 pm they get the usual update reminder.
3. Each send is recorded on the job (`wo_events` → `reminder_morning_sent`) with every painter's outcome — ask me to read it if a painter says they got nothing. A painter with no mobile is emailed instead; one with neither shows `nobody` — fix the mobile on their contractor page.
4. Day 1 of a job never gets the morning heads-up (it already has the 7:30 am reminder). A day marked **No work** before 7:30, or a day the painter already updated, gets nothing.

## The customer's tape text
1. Pick a 3–6 day job: two working days before its last day the customer gets the text at 9:00 am and a shorter reminder at 3:30 pm. On a 7+ day job: one text at 9:00 am three working days before the last day. Weekends only count when the painter works them.
2. Move the job's finish date on the schedule before the text is due: the text follows the new date.
3. A customer who turned off **Property & job updates** texts in their account is not texted; the job records `suppressed`.

## What to tell me
- The wording of both texts (drafted by me; edit them in Settings).
- Whether 9:00 am and 3:30 pm are the right times for the customer, and 7:30 am for the painter.
- Tom wrote "3–6 days" and "more than 7": I treated a 7-day job like the longer ones (one text, three working days before the end). Say if 7 should get the two-text treatment instead.

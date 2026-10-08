# Reminder moments, Step 4 — manual test script for Tom

Branch `feat/standards-status-callbacks`.

## Before you start
1. Paste `supabase/migrations/20270227000000_reminder_moments.sql`. Read-back: 2 tables, 4 policies, no insert, 1 trigger, skip grant true, max 3.
2. Deploy. Within half an hour every job under way has its moments (PC job page → **App updates** card).

## Office
1. Open a job under way in PC Command. The **App updates** card lists the moments — **Upcoming**, **Due today · N sent**, **Answered**, **Missed · N texts**. Day 1's 7:30 moment on a job that started before this went live reads **Skipped — not texted**: not a miss.
2. Settings → Automations → **Update your work order — reminders**: three texts, each editable. The trigger text describes the follow-up times.
3. On a day it rained: **No work on** today, a reason, **No work that day**. The card shows the day; every moment on it reads **Skipped — no work**. **Clear** puts it back. The same control is on the schedule board when you tap a job block.

## Painter (phone)
1. At 7:30 on day 1 the text arrives. Do nothing: at 10:30 the second text ("please update your job in the app today"), at 1:30 the third ("last reminder today"). Nothing after 7 pm.
2. Tick a surface or add a photo: the job page's **App updates on this job** shows that moment **Answered** and no further text comes that day.
3. On a one-day job the 3:30 moment needs its own tick or photo.

## What to tell me
- The wording of texts 2 and 3.
- Whether 10:30 / 1:30 and 5:30 / 7:00 are the right follow-up times (Settings → `job_update_rules`, DB for now).

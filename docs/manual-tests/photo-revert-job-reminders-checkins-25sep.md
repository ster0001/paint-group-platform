# 25 Sep 2026 — per-area photos again, painter update texts, customer check-ins

**SQL first:** `20270200000000_wo_photo_rules_per_area.sql` on production and the test project
(`set lock_timeout = '15s';` at the top). Read-back: `gate_per_area_with_optional_rows` true,
`short_job_helpers_left` 0. Ledger row `20270200000000_wo_photo_rules_per_area.sql`.

## 1 · Photos are per area again
1. Painter's job page on a 2-day booking: the first tick in EACH area asks for that area's before
   photo; the last tick in each area asks for its finished shot. No "one is enough" wording anywhere.
2. A line the office marked **Photos not required** still ticks without a photo.

## 2 · Painter "update your work order" texts
Settings → Automations → **Update your work order — reminders** is on, Text, send automatically.
1. A job booked and under way (In progress) with the painter's mobile on their profile.
2. The half-hour sweep (`/api/cron/campaign-sweep`) texts at day 1 07:30, then by length: day 2
   15:30 (1–2 days) · half way + last day 15:30 (3–6) · 30% + 60% + last day 15:30 (7+). Days are the
   painter's working days (weekends only if their profile says they work them).
3. Each moment fires once (`automation_claims`, key `contractor_job_update_reminder`, entity = the
   job). Move the job to Quality check or Walkthrough: later moments are claimed as stopped, no text.
4. Every painter on the job is texted — the contractor and any assigned crew.

## 3 · Customer check-ins on Today
1. A 5-day job in progress: on day 3 a **Check-in** item appears from the morning — "… mid-job
   check-in (50% through, day 3 of 5)", HIGH IMPORTANCE, due 5 pm, action **Ring them** → the job.
2. A 10-day job: two items, at 35% (day 4) and 70% (day 7).
3. A 2-day job: no mid item; the morning after its last day a **Follow-up** item — "job done, check
   they are happy". Gone after ten days.
4. Dismiss from Today once you have called; a closed job's mid check-ins disappear on their own.

## Gates
- Unit: `lib/workorder/jobRhythm.test.ts`, `lib/automations/sweeps/jobReminders.test.ts`,
  `lib/crm/work-queue-jobs.test.ts`, `lib/workorder/surfaces.test.ts`.
- e2e: `automation-job-reminders.spec.ts`, `wo-photo-rules.spec.ts` (per-line exemption only).

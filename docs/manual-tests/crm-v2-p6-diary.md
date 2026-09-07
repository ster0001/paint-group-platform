# Manual test · CRM v2 Phase 6 — visits, the Diary, staff Google Calendar

Branch `feat/crm-v2-p6-diary`. Source: `docs/briefs/crm-v2-deep-dive.md` §4.6; `docs/briefs/claude-code-brief-visit-booking.md`
(rulings 1–5; V1–V5 taken as reconstructed: one metro zone with AM/PM windows, 10 business days, 24 h cutoff,
per-estimator visit length, roster = whoever is ticked in Settings). Automated: `e2e/crm-p6-diary.spec.ts` (C1),
`lib/visits/availability.test.ts`, `lib/visits/notify.test.ts`, `lib/crm/stage.test.ts` (P6 case), `lib/crm/work-queue.test.ts` (rebook).

## Migration to paste (one file, idempotent, read-back at the end)

`20270127000000_crm_visits.sql` — `visits` (with the `visits_no_double_booking` exclusion constraint; needs `btree_gist`,
created in `extensions`), its trigger writing `visit_booked` / `visit_completed` / `visit_no_show` / `visit_cancelled`
into the event log, `staff_availability`, `settings.visits`, `staff_gcal_connections` + `staff_gcal_events`
(service-only), and the RPCs `visit_book` / `visit_set_status` / `visit_move`.
Expect ONE row: `tables_ok`, `no_double_booking`, `functions_ok`, `trigger_ok`, `settings_seeded` all true, `policies` 2.
If `no_double_booking` is false, the `btree_gist` extension could not be created — enable it under Database →
Extensions and re-paste (the file is idempotent).

**No new env.** Staff Google Calendar reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and the existing callback URL
(`/api/gcal/callback` tells staff from contractors by the signed-in role), so Google's console needs nothing new.

## Walk

1. **Settings → Company → Estimator visits.** Tick who takes visits, their days, hours and visit length. The
   windows (morning 9–12, afternoon 1–4), the 10-day horizon, the 24 h cutoff and the reminder hour are the
   global numbers. Save.
2. **A customer's record → Visits panel → + Book a visit.** Estimator, date, time, kind, a note → Book. The status
   line reads "Visit booked"; the timeline shows it; the customer gets "Your visit is booked" with a `.ics`
   (Settings → Automations → "Visit booked — calendar invite"). Book the same estimator at an overlapping time:
   "That time is already taken for this estimator" — the database refused it, not the form.
3. **Diary.** Day / week toggle, ‹ › to move. Estimate visits in one lane per estimator (address, customer,
   phone, note), then Jobs running, then Booked jobs. On a visit: Done (with what came of it), No show, Rebook,
   Move (date, time, estimator), Cancel. A no-show or rebook lands in Today → Follow-ups as
   "<name> — visit was a no-show, rebook it" until a new visit is booked for them; the lane falls back to the quote.
   Done → the record's lane is "Visit done, no reply" and the second-attempt rule counts from it.
4. **Your Google Calendar** (bottom of the Diary): Connect → Google consent → back with "Connected". A
   "Paint Group Visits" calendar appears in your Google account with each booked visit as a timed event
   (address, customer, phone, estimate link). Move a visit → the event moves; cancel → it goes. "Also put booked
   jobs in it" adds the 07:30–15:30 job blocks. Sync now / Disconnect. The evening sweep re-syncs everyone.
5. **Online.** With an estimator ticked, the estimate builder's "book a visit" list becomes real windows
   ("Tue 8 Sep · morning (9–12)") from availability minus booked visits. Picking one books a visit with the freest
   estimator and their earliest block; a window that filled in the meantime says so and offers the list again.
   A hand-written list under Settings → Online estimates still overrides (and books nothing automatically).
6. **Reminder.** The evening sweep (18:00 Melbourne, `/api/cron/wo-sweep`) texts tomorrow's customers once
   ("Visit reminder text" in Automations). A moved visit is reminded again for its new day.

## Traps found building it

- The exclusion constraint needs `btree_gist` for `uuid =`; created in the `extensions` schema like `pg_trgm`.
- `en-AU` date formatting differs between ICU builds ("Sept", commas) — labels the customer and the tests see are
  composed from parts, never `toLocaleDateString`.
- The horizon counts days that actually offer a window, not calendar days: today never counts (its windows end
  inside the cutoff).
- Event-driven lanes: a `visit_cancelled` / `visit_no_show` newer than the last `visit_booked` clears the
  "visit booked" lane; a later booking wins again. `FACT_EVENT_TYPES` had to learn both kinds or the facts row
  never saw them.
- The record page's second `Promise.all` is where the visits load lives; the Visits panel sits between Status
  and Messages.

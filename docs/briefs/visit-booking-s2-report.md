# Visit booking, addendum A — S2 report (schedule and the availability function)

**Date:** 6 October 2026 · **Branch:** `feat/visit-booking-s2` (stacked on S1) · **Migration:** `20270213000000_visit_slots_and_booking_rules.sql` (applied on the TEST project, read-back matched; NOT on production — Tom pastes it after 20270212)

## What was built

- **Migration 20270213**: `visit_slots` (one row per named slot of an estimator's week: weekday, start, run length, zones, the R14 conditional rule) with a btree_gist exclusion constraint so two slots of one estimator never overlap; `visits.zone` and `visits.far_edge` (frozen at booking, for R14/R18); the `visit_booking_rules` settings row created with the brief's starting values. Staff-only RLS, anon revoked, read-back, ledger row.
- **`lib/visits/schedule.ts`**: the vocabulary, `STANDARD_WEEK` (section 5, 21 slots), `BookingRules` + `mergeBookingRules`, and **`availability()`** — the one pure function. Inputs: the week, confirmed bookings, live holds, busy times, the rules, the customer's zone and far-edge flag, and now. Applies §4.2's rules in order. Output per day: offered slots with the start instant, the one-hour visit end (R32), the 90-minute block end, and the section-9 wording ("Monday 5 October", "2:00 pm").
- **`lib/visits/scheduleDb.ts`**: loaders for the rules, one estimator's week, and the Settings data. Every read checks its error.
- **Settings → Company → Visit schedule** (per estimator, day tabs, zone chips, conditional rule, add/remove, live per-zone totals, "No zones — nobody can book this", "Load the standard week") and **Settings → Booking rules** (same-day, notice, window, hold, slot/visit length, Speak with us caps, reminder time, gate order, far-edge pairs, public holidays). Server actions zod-validated under the staff session; the overlap check names the slot it ran into (section 8 test 18) and the database refuses it independently.
- `scripts/seed-visit-week.ts --estimator <email>` seeds the standard week for a named staff login (refuses to overwrite). The Settings button does the same thing for Tom.
- Help: `docs/help/visit-schedule/staff.md`. Architecture paragraph added. The old Estimator visits panel now says its windows are the OLD engine and points at Booking rules / Visit schedule / Visit zones.

## Done-when, as verified

| Golden test (brief S2) | Result |
|---|---|
| Seeded week gives per-zone totals 16 / 13 / 6 / 5 / 9 | ✅ |
| Zone 1 Monday: 08:00, 09:30, 11:00, 12:30, 14:00, 15:30. Zone 4 Friday: 08:00 only. Zone 3 Tuesday: 08:00 and 15:00 | ✅ |
| Friday 12:30 to Zone 1 only when Friday 11:00 has a confirmed Zone 1 booking; a hold does not unlock it | ✅ |
| Now Monday 10:15: 11:00 hidden, 12:30 offered; exactly 2 hours ahead offered | ✅ |
| 21 days ahead offered, 22 not | ✅ |
| Far edge both orders; ordinary Zone 3 and Zone 1 unaffected; a hold is not a booking | ✅ |
| Busy 13:00–13:30 Wednesday hides 12:30 only; all-day busy hides the day | ✅ |
| Monday after DST starts (5 Oct 2026, +11) and after it ends (5 Apr 2027, +10) both offer 08:00 local | ✅ |
| Editing a slot's zones changes the answer | ✅ |
| Public holiday offers no slots; the same weekday a week later is normal | ✅ |
| Booking blocks its full 90 minutes whatever happened to the travel block (test 19) | ✅ |

19 golden tests in `lib/visits/schedule.test.ts`; 255 unit tests green across lib/visits + lib/crm; tsc and lint clean.

**e2e on the test project (8/8 green, three runs):**
- `e2e/visit-schedule.spec.ts` (3): load the standard week → totals 16/13/6/5/9 and 21 rows; toggling Zone 1 off Monday 11:00 shows the warning and the total drops to 15, back on restores 16; Friday 12:30 shows the R14 rule; adding 08:45 on Monday is refused by the action ("starts inside the 08:00 slot") and by the database (`visit_slots_no_overlap`); Booking rules save and read back; visit longer than slot refused.
- `e2e/visit-zones.spec.ts` (4, S1's spec, first time run): seeded list with the shared-postcode pairs; Check an address follows a move at once; a made-up suburb records two hits, shows on Today, "Add as Zone 2" resolves both; anon read and write refused.
- `e2e/customer-journey/reveal-book-link.spec.ts` (1): the S0 bug fix.

**Two things the first e2e run caught, both fixed:**
1. **Row cap.** The Settings suburb read used `limit(5000)`; PostgREST capped it at 1,000, so Zone 1 showed 71 suburbs of 174 and Glen Waverley was missing. `loadVisitZonesData` now pages in 1,000-row ranges.
2. **"Add as…" on an unmapped suburb saved everything as Zone 1**: the chosen status was written to state after the save fired. The status now travels with the call. The spec that asserts "Added … as Zone 2" is what found it.

## Decisions taken inside the brief's rulings

- `visits.zone` / `visits.far_edge` are frozen at booking: a suburb Tom moves later must not rewrite a booked day's R14/R18 answers.
- The public-holiday list starts empty (S4 seeds it from the official Victorian list and reports the dates). The Booking rules screen already edits it.
- "Load the standard week" refuses a non-empty week. Starting again means removing the slots first; nothing is overwritten silently.
- Zone estimators and weeks are left for Tom to assign (the seed never guesses which login is Tom). On the test project the e2e assigns and removes its own.
- The old half-day engine still serves `/estimate/book` until S3 replaces the customer path; `settings.visits` is untouched so nothing live changes before S3.

## For Tom

1. PR from `feat/visit-booking-s2` (contains S0 + S1).
2. Paste `20270212` then `20270213` into production; compare both read-backs to their `_expect_` values.
3. Seed the suburbs: `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-visit-zones.ts seed --prod`.
4. Settings → Visit zones: pick yourself on all five zones. Settings → Visit schedule: pick yourself, **Load the standard week**. Check the Friday 12:30 rule reads as you meant it.
5. Settings → Booking rules: confirm the starting values.

## Next: S3

Walking skeleton: Book a site visit → calendar → hold → text code → booked. Holds table + hashed codes, one server action in a single transaction, the `visits` row with zone and far edge, `crm_events`, text + email, section 8 tests 1–9, anonymous-customer e2e.

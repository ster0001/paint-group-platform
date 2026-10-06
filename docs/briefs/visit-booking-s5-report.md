# Visit booking, addendum A — S5 report (Google Calendar)

**Date:** 6 October 2026 · **Branch:** `feat/visit-booking-s5` (stacked on `feat/visit-booking-s4` — merge S4 first) · **Migration:** `20270216000000_gcal_visits.sql` (applied on the TEST project, read-back matched; to paste after 20270215)

## The decision this was built on

info@paintgroup.com.au is a **Google Workspace** account (Tom, 6 Oct). So the OAuth app can be **Internal** and the staff connection asks for `calendar.events` as well as the existing read scope. Booked visits go into the estimator's **main** calendar (decision 2's "the main one") with the customer as a guest. No Google verification is needed.

## What was built

- **Scopes**: `GCAL_STAFF_SCOPE` adds `calendar.events`; `scopesCanWritePrimary()`. A connection made before today must reconnect once; the Diary card says so and asks for it.
- **Write** (`lib/gcal/staff.ts` + `lib/gcal/visitEvents.ts`): when the scope is there, `reconcileStaffCalendar` targets the primary calendar. Each booked visit becomes a **one-hour** event (R32) at the property with the customer as a guest (`sendUpdates=all`, so Google emails the invitation), a popup reminder on the estimator's copy, and a separate **30-minute "Travel"** block with no guests. Both are tagged with `extendedProperties.private.pgKind`. Jobs still go to the app-created calendar when `push_jobs` is on. A visit that used to live in the app calendar moves to the primary one on the next reconcile. Confirming a booking or offering a time reconciles at once (within a minute); the sweep retries.
- **Read** (`lib/gcal/read.ts`): events tagged `pgKind` are skipped, so a booking never blocks itself. Everything else in the estimator's calendars still counts as busy; an all-day event hides the day (S2).
- **Inbound** (`lib/gcal/inbound.ts`): each visit event is re-read and classified — **gone** (Tom deleted it, R27) or **declined** (the guest said no, R22) → the visit is cancelled through the existing `visit_set_status` RPC with `cancel_reason` `deleted_in_google` / `declined_invitation`, both events removed, the cancel email and the new `visit_cancelled` text sent, a `visit_declined` card for staff; **moved** (R27) → `google_start` recorded on the mapping row, nothing else changes, a `visit_moved_in_google` card asks staff to confirm with the customer. Past visits are left alone.
- **Two paths in**: a push channel on the primary calendar (`events.watch` → `/api/gcal/webhook`, token = HMAC of the channel id with `CRON_SECRET`, renewed a day before expiry, stopped on disconnect) and `/api/cron/gcal-sweep` every five minutes (`vercel.json`), which also re-runs the write side.
- **Gating**: Booking rules gained **"Customers can only book when the estimator's Google Calendar is connected"** (default on). Without a write-capable connection a zone customer gets the request path and an `estimator_calendar_missing` card tells staff why. If Google cannot be reached when a customer looks or confirms, `CalendarUnavailable` sends them to request-a-time; a held slot is released; nothing is booked blind.
- **Disconnect** stops the channel and revokes the token; the events already in Google stay; customers in that estimator's zones get the request path.
- **Reminders**: confirmed against the Events reference — `reminders` are "for the authenticated user", so the popup reaches the estimator's copy only; the customer's calendar reminds by its own settings. The customer's text reminder stays the existing `visit_reminder` at 6 pm the evening before, which skips cancelled visits and visits booked after the sweep has run (R36).
- **Messaging**: `visit_cancelled` (text) added, editable under Settings → Automations; inventory updated.
- Help: `docs/help/visit-booking/staff.md` gained a Google Calendar section. `docs/gcal-setup.md` gained the S5 steps. `docs/manual-tests/visit-gcal.md` is the real-Google walk for Tom.

## Verified

| Check | Result |
|---|---|
| Event builders: one hour, location, guest, estimator popup, pgKind; travel block after; classifier gone / declined (customer's reply only) / moved (≥ 1 min) / same | ✅ `lib/gcal/visitEvents.test.ts` |
| Busy read skips our own events, keeps everything else | ✅ `lib/gcal/read.test.ts` |
| Whole lib unit suite (3,156 tests), typecheck, lint | ✅ |
| Migration on the test project, read-back 5 / 5 / travel ok / 1 | ✅ |
| No connected calendar → request screen, hold refused with `calendar_unavailable`, Today card | encoded in `e2e/visit-calendar-gating.spec.ts` — **not run here** |
| Dead token → "unavailable" → request screen | same spec, skipped where the stack has no Google credentials (the test project has none) |
| S3 and S4 journeys still pass with the rule switched off for the run | encoded (`visitHelpers.ensureEstimator`) — **not run here** |

**e2e did not run.** The single attempt was REFUSED: the test project was held by CI (the S4 PR's run, started 11:10Z). One try, no loop. CI on the S5 PR runs these specs.

### What cannot be verified without the real calendar

The brief's S5 done-when list is mostly real-Google behaviour: the event appearing within a minute, a private event hiding a slot within five minutes, the decline from Gmail, **the decline from Outlook and Apple Mail**, delete and move in Google. The test project has no Google credentials or connection. `docs/manual-tests/visit-gcal.md` walks Tom through each one. **If the Outlook or Apple Mail declines do not reach Google, the brief says STOP: the fallback is a cancel link in the text, which needs Tom's ruling.** Google processes iCalendar replies emailed back to the organiser, which is how those clients answer, so it should work; it is not proven here.

## Decisions taken inside the brief's rulings

- The default for the new rule is **calendar required**. The test project switches it off per run and restores it. Production should keep it on.
- Switching the OAuth app to Internal means a painter's Gmail cannot connect their own calendar (none has). Keeping External with verification would allow both; Tom's call (noted in `docs/gcal-setup.md`).
- A decline after the visit has happened changes nothing.
- On disconnect the events already in Google are left alone.
- `GCAL_WEBHOOK_URL` is optional; the site URL's `/api/gcal/webhook` is the default. Without an HTTPS site URL the channel is skipped and the sweep alone carries changes.

## For Tom

1. Merge the S4 PR, then open the S5 PR from `feat/visit-booking-s5`.
2. Paste `20270216000000_gcal_visits.sql` after 20270215. No seed follows.
3. Google Cloud console: OAuth consent screen → Audience **Internal**.
4. Diary → Google Calendar → **Reconnect**, accepting the new permission.
5. Run `docs/manual-tests/visit-gcal.md`, especially step 3 (declines from Gmail, Outlook and Apple Mail), and report back.

## Next: S6

The gate: contact step as the last question before the range, the Settings switch (details first / range first, already in Booking rules), per-session tracking, the dashboard report in "Where estimates go", the R24 range screen order, and the API test that the range cannot be fetched without a completed gate.

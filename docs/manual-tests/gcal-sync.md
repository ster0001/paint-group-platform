# Manual test — Google Calendar sync for contractors

Prereqs: migration `20261201000000_gcal_sync.sql` run; `GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET` in env (see `docs/gcal-setup.md`); a contractor login
(Josef `pg.josef.contractor@gmail.com` / `painttest123`) and any Google account
to connect.

Each step, then what you should see.

1. **Card renders.** Portal → Calendar as Josef. Below the calendar grid: a
   "Google Calendar" card with a Connect button. (If the env keys are missing
   the card is absent — that's the intended off state.)
2. **Connect.** Press Connect → Google sign-in → consent screen. The
   permission text mentions creating/managing *calendars created by this app*
   — NOT "see all your calendars". Allow → you land back on Calendar with a
   green Connected card showing the Google email.
3. **Backfill.** Open calendar.google.com for that account. A "Paint Group
   Jobs" calendar exists, holding an all-day event for each accepted booking
   Josef already had — spanning the booked days, address in the location,
   description has the WO ref + a portal link. No dollar figures anywhere.
4. **Accept → appears.** As staff, offer Josef a job (schedule board drag →
   confirm). As Josef, accept it in the portal. Within a few seconds the job
   is in Google. An offer merely SENT must NOT appear — only accepted ones.
5. **Move → moves.** As staff, drag Josef's accepted booking to different
   days. The Google event moves to the new days (refresh Google Calendar).
6. **Cancel → disappears.** As staff, cancel the booking. The event is gone
   from Google; the job is back in the tray.
7. **Hand-deleted event heals.** Delete one job's event in Google by hand,
   then in the portal press "Sync now". The event comes back.
8. **Deleted calendar heals.** Delete the whole "Paint Group Jobs" calendar in
   Google settings, press "Sync now". A fresh calendar appears with every
   current booking.
9. **Disconnect.** Press Disconnect → card returns to the Connect state.
   Booking changes no longer touch Google. Reconnect works and reuses a new
   calendar without duplicating events.
10. **Token never leaks.** As Josef, in the browser dev tools run a REST probe:
    `contractor_gcal_connections` and `contractor_gcal_events` via
    `supabase.from(...).select()` both return an error/empty — the tables are
    service-only. Also grep the Calendar page's HTML for the refresh token
    string: absent.
11. **Privacy gate.** With a job that has only an OFFERED (unaccepted) offer
    for Josef: it must not be in Google even after "Sync now" — the committed
    rule (accepted, or direct assignment with no offer) decides, not dates.

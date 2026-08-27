# Google Calendar sync — one-time setup (Tom)

The contractor portal's Calendar tab has a **Connect Google Calendar** card.
When a painter connects, the platform creates a **"Paint Group Jobs"** calendar
inside their own Google Calendar and keeps it up to date automatically:

- **accept an offer** → the job appears (all-day event across the booked days,
  with the address, contact and a link back to the portal job)
- **booking moved / reschedule approved** → the event moves
- **booking cancelled or reassigned** → the event disappears

Privacy: the app uses Google's `calendar.app.created` permission — it can only
touch the calendar it created. It **cannot see or change anything already in
the painter's personal calendar**, and Google's consent screen says so. That
also means no scary "unverified app" warning for the sensitive calendar scopes.

Until the two env keys below exist, the card simply doesn't render — nothing
else in the app changes.

## 1 · Run the migration

Paste `supabase/migrations/20261201000000_gcal_sync.sql` into the Supabase SQL
editor and run it. The read-backs at the bottom should show both tables with
`rls_enabled = true` and **zero rows** in the grants query.

## 2 · Create the Google OAuth client (once, ~10 minutes)

1. Go to **https://console.cloud.google.com/** and sign in with the Paint Group
   Google account (info@paintgroup.com.au is fine).
2. Top bar → project picker → **New project** → name it `Paint Group Platform`
   → Create, then make sure it's selected.
3. Left menu → **APIs & Services → Library** → search **Google Calendar API**
   → open it → **Enable**.
4. **APIs & Services → OAuth consent screen** (Google may call it "Branding"
   under *Google Auth Platform*):
   - User type: **External** → Create.
   - App name `Paint Group`, support email = your email, developer contact =
     your email. Save through the steps; no extra scopes need adding here.
   - Under **Audience**, press **Publish app** (from "Testing" to
     "In production"). This matters: while it stays in Testing, each
     painter's connection dies after 7 days.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name `Paint Group Platform`.
   - **Authorised redirect URIs** — add BOTH:
     - `https://paint-group-platform.vercel.app/api/gcal/callback`
     - `http://localhost:3000/api/gcal/callback`
   - Create, then copy the **Client ID** and **Client secret**.

## 3 · Add the keys

- `.env.local` (for your machine):
  ```
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  ```
- Vercel → the project → **Settings → Environment Variables**: add the same
  two for Production, then **redeploy**.

## 4 · Check it works

Sign into the portal as a contractor (e.g. Josef,
`pg.josef.contractor@gmail.com` / `painttest123`) → Calendar → **Connect
Google Calendar** → pick a Google account → allow. You land back on the
Calendar tab with a green "Connected" card, and a **Paint Group Jobs**
calendar appears in that Google account with every accepted booking already
on it. Full test script: `docs/manual-tests/gcal-sync.md`.

## Notes

- The nightly sweep (the existing Vercel cron) re-syncs every connected
  contractor, so a missed update heals itself within a day.
- Disconnecting (button on the card) revokes our access and forgets the
  token; the calendar itself stays in their Google account until they delete
  it there.
- If a painter deletes the "Paint Group Jobs" calendar by hand, the next sync
  recreates it with all current bookings.

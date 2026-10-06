# Google Calendar sync — one-time setup (Tom)

The contractor portal's Calendar tab has a **Connect Google Calendar** card.
When a painter connects, the platform creates a **"Paint Group Jobs"** calendar
inside their own Google Calendar and keeps it up to date automatically:

- **accept an offer** → the job appears (a 07:30–15:30 block on every booked
  day, with the address, contact and a link back to the portal job)
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
   - **Authorised redirect URIs** — add ONE PER HOST the app is reached on.
     The callback lands on whichever host the painter pressed Connect from
     (the sign-in cookies live there), so every host needs its own entry:
     - `https://login.paintgroup.com.au/api/gcal/callback` (the live address painters use)
     - `https://paint-group-platform.vercel.app/api/gcal/callback`
     - `http://localhost:3000/api/gcal/callback`
     A host missing from this list fails on Google's side with
     `redirect_uri_mismatch` naming the exact URI to add.
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

## A painter can't connect (1 Oct 2026, Jacob at DJ Decor)

Zero contractors had ever connected — only the office's own test from August.
Two things to check, in order:

1. **The redirect URI for the live host.** Until 1 Oct the callback was built
   from `NEXT_PUBLIC_SITE_URL` (the vercel.app address) while painters sign in
   at `login.paintgroup.com.au`. Google sent them back to the other host, where
   neither the state cookie nor their sign-in existed → "Connecting to Google
   didn't work". The code now returns to the host the painter started on; that
   host must be in the OAuth client's **Authorised redirect URIs** (step 2.5).
2. **Audience / publishing status** on the OAuth consent screen. It must be
   **External** and **In production**. *Internal* lets only Paint Group
   Workspace accounts through (a painter's Gmail gets "Error 403:
   org_internal" on Google's own page); *Testing* lets only listed test users
   through and expires their connection after 7 days. Note the staff Diary's
   read scope is "sensitive": with External + unverified, STAFF see Google's
   "unverified app" interstitial (Advanced → continue) — painters never do,
   their scope isn't sensitive.

When it fails on OUR side the Calendar card now says why in a sentence and
gives the painter a short code to read out ("calendar: state cookie",
"calendar: exchange", or Google's own wording); the same code is on the
Sentry event under `gcal.callback`.


## Visit booking S5 (6 Oct 2026): visits in the main calendar, with the customer invited

info@paintgroup.com.au is a Google **Workspace** account, so:

1. **OAuth consent screen → Audience: Internal.** Only Paint Group Workspace logins can connect; no verification is
   needed for the sensitive scopes. (Painters' Gmail connections use the separate narrow scope and are unaffected
   only if the app stays External — if you switch to Internal, painters cannot connect. Tom's call: today no painter has
   connected, and the staff flow is the one that needs the sensitive scopes. If both are wanted, keep External and go
   through verification.)
2. **Reconnect once.** Diary → Google Calendar card → *Reconnect Google Calendar*. The consent screen now also asks to
   "View and edit events on all your calendars" (`calendar.events`). Until that is granted, the card says the
   connection cannot write visits, customers in your zones are offered a request instead of a time, and Today carries
   a "Google Calendar is connected without permission to write visits" card.
3. **Nothing new in Vercel is required.** The push channel posts to `https://<NEXT_PUBLIC_SITE_URL>/api/gcal/webhook`
   (set `GCAL_WEBHOOK_URL` to override), authenticated with a token derived from `CRON_SECRET`. Without an HTTPS site
   URL the channel is skipped and the five-minute sweep (`/api/cron/gcal-sweep`, vercel.json) carries the changes alone.
4. **What you will see in Google:** each booked visit as a one-hour event in your main calendar with the property as
   the location and the customer as a guest (they get Google's invitation), followed by a 30-minute "Travel" block.
   Deleting the visit event cancels the visit and texts the customer. Moving it changes nothing in the platform and
   raises a card on Today asking you to confirm the new time with the customer, then move it on the Diary.
   A private event you add hides the overlapping slot from customers within five minutes (two-minute read cache plus
   the sweep).

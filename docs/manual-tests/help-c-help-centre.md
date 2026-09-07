# Help centre — Phase C (routes, search, tour) — Tom's review

One migration to paste on production first: `supabase/migrations/20270114000000_contractor_tour_seen.sql`
(adds `contractors.tour_seen_at` and the `contractor_tour_seen()` RPC; ends with a read-back select).
Ten minutes.

## 1. Office Help (2 min)
Sign in to the console. **Help** is the last sidebar entry. Expect three groups of cards
(Scheduling, Self invoicing, Work orders, plus Help centre) labelled Office or Project coordinator,
never a contractor card. Open one: the film sits under *Watch it first*, then the steps with pictures.
Search `mark paid` — the Payables guide is listed with the sentence that matches.

## 2. Contractor Help (3 min)
Sign in to the portal as a painter. **HELP** is the sixth tab. Only painter guides are listed.
Open *Answer a job offer…*, watch the film, scroll the steps. Search `before photo` — the work-order
guide matches; search `margin` — "Nothing mentions". Tap **Show me around again**: the tour cards
appear one at a time, Next moves the tab behind the card, Skip closes it.

## 3. The first-sign-in tour (4 min)
From **Contractors → Invite**, invite a made-up painter to an inbox you control. Open the link,
set a password. The portal opens with *Show me around · 1 of 7*. Press Next through the seven
cards (the last lands on Help), then **Done — let's go**. Sign out, sign in again: no tour.
Delete or suspend the test painter afterwards.

## 4. Nothing leaks (1 min)
Signed out, open `https://<site>/api/help/media/scheduling/staff-01.png` — expect *not found*.
As a painter, open `/portal/help/../../help` (the office route) — the console's sign-in redirect,
never a page.

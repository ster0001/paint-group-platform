# Tom's 8 Sep batch — a manual walk on the live site

Built on `feat/crm-batch-8sep` from main 51ecc9f. Migration **20270131000000_staff_gcal_scopes.sql**
(applied on C1; paste on prod — one `alter table … add column if not exists`, a read-back at the end).

## 1. Does a wizard drop-out record WHEN? What does it mean in the CRM?

What is recorded per online-estimate session (`wizard_drafts`): the moment they were **last active**
(`last_seen_at`, the heartbeat every 15 s while they are typing or looking), the **furthest page** they
reached, the time on each page and the total, and `dropped_at` — the moment the sweep (every 30 min, and on
read from CRM Today) noticed they had been idle 45 minutes and filed them as Dropped. So "when they dropped
out" = `last_seen_at`; `dropped_at` is up to 45 min later by construction.

In the CRM it means:
- **Board** → the "Dropped out" lane (a session with an address is a lead even without a name).
- **Today** → "Dropped this week", grouped by the page that lost them.
- **The customer's record** → NEW 8 Sep: an *Online estimate* strip under the name — "Dropped · Condition ·
  3 of 6 · 4 min · last active 3h ago · left Mon 7 Sep, 8:15 pm · Open the session →".
- **History on the record** → the event now reads "Dropped out of the online estimate — stopped on Condition
  (page 3 of 6) · 4 min in the wizard · last active Mon 7 Sep, 8:15 pm · email captured". (Events written
  before 8 Sep keep the old shorter line: they never carried the page or the time.)

Walk: CRM → Today → "Dropped this week" → Open → the strip is on the record; History shows the event.

## 2 + 3. The logo top-left goes home — on the CRM, Projects and Payments

- CRM, Projects (`/pc`) and Payments (`/invoicing`) all show the company logo (Settings → Company; the text
  mark "Paint·Group" when none is uploaded) top-left with the surface's name beside it.
- Tap it → the main platform (Estimates, or the first area that login is allowed to see).
- Projects keeps its "← Back to app" tab too.

## 4. The Google Calendar says free when it isn't

Until now the app could only WRITE to the "Paint Group Visits" calendar it created — it could not see a
dentist appointment typed into Google. From 8 Sep a staff Google connection asks for **read** access as well.

**You must reconnect once**: CRM → Diary → "Your Google Calendar" card shows an amber line "This connection can
only write … Reconnect Google Calendar →". Click it, consent (all boxes ticked). Google may show an
"unverified app" screen first if the OAuth app in Google Cloud isn't set to *Internal* — see the note below.

After reconnecting:
- Diary → your lane shows your own Google entries as dashed "Google" blocks (day and week view).
- The card says "Reading your Google calendars: info@paintgroup.com.au, …" — every calendar ticked in Google
  except the app's own "Paint Group …" ones.
- Record → Visits → "+ Book a visit" → the day plan lists Google entries as busy (dashed) and the free blocks
  skip them; the note says which calendars are read.
- The wizard's offered windows skip those times (an estimator whose morning has a Google entry isn't
  offered for it).
- Booking by hand over a Google entry is still allowed — the office can see it and decide. The wizard can't.

What counts as busy follows Google's own rule: cancelled, "free" (show me as available), declined, working-
location and birthday entries are ignored; all-day entries block the whole day.

Google OAuth note (Tom): `calendar.readonly` is a scope Google calls *sensitive*. Google Cloud → APIs &
Services → OAuth consent screen → if User type is **Internal** (Workspace) there is no warning. If it is
External and the app is unverified, Google shows "Google hasn't verified this app" — Advanced → "Go to
Paint Group (unsafe)" still works for your own accounts. Contractors are untouched (their scope is unchanged).

## 5. Contact address on the record

Record head, under the phone and email: the first property on file as a Google Maps link, "+N more" jumping
to Properties when there are several; "no address yet" otherwise.

## 6. Light and dark on Projects and Payments

The CRM's toggle now also sits top-right on Projects and Payments. One choice: flip it anywhere and all three
surfaces follow (same cookie). The scheduling board follows too.

## Proven on C1
- `e2e/chrome-8sep.spec.ts` 2/2: logo + theme across all three, the address, the strip.
- `lib/gcal/read.test.ts`: which calendars are read, which events count as busy (incl. all-day Melbourne days).
- Google itself can't be exercised on C1 (no Google keys there): the reconnect + lanes are yours to walk live.

## 7. Two logos, one per theme (Tom, 8 Sep later)
Settings → Company already holds two logos: the main one (white lettering, dark headers) and "Logo for light
backgrounds" (dark lettering; email and the quote PDF). The CRM, Projects and Payments now show the main logo in
dark mode and the light-background one in light mode; the theme button swaps them instantly. Either empty →
the other is used; both empty → the "Paint·Group" text mark. Proven by `e2e/chrome-8sep.spec.ts` test 2.

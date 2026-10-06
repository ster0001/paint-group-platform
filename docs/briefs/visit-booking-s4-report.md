# Visit booking, addendum A — S4 report (requests, pre-arranged, out of area, Speak with us, messages)

**Date:** 6 October 2026 · **Branch:** `feat/visit-booking-s4` (on the merged main, after S0–S3) · **Migration:** `20270215000000_visit_requests.sql` (applied on the TEST project, read-back matched; sent to Tom) · **Seed:** `scripts/seed-public-holidays.ts` (run on TEST; Tom runs `--prod` after the migration)

## What was built

- **Migration 20270215**: `visit_requests` (kind time / visit / call; the address's zone, contact fields, preferred days and time of day, `due_at`, answered_at / answered_by / answer / visit_id) and `customer_message_receipts` (idempotency for Send us a message). Staff-only RLS; customer writes through the service client in the routes.
- **The three options on every wizard step before the range (R3, R4)**: "Would you rather talk it through? Request a site visit / Call us / Send a message" in `QuickLook.tsx`, replacing the two old "Book someone in" blocks. Request a site visit opens `TalkSheet.tsx` (full name, address of the property, email, mobile, optional note) and creates a REQUEST — never a slot. Call us dials `settings.company_profile.phone`. Send a message asks for details first, then the message box.
- **The range screen (R25, R26)**: "Speak with us — Request a call to finalise your booking" (only when the server says the top of the range is inside the R34 caps; the submit route now stores `guideRange` on the estimate and returns `speakWithUs`), "Book a site visit — Choose a time for us to see the property", and "Send us a message — Ask a question about your estimate". The sent screens use the mockup's wording.
- **The visit page**: pre-arranged ("We visit Sorrento by arrangement") and unmapped ("Request a time") show the request-a-time screen — days that suit (Mon–Fri chips) and time of day (Morning / Afternoon / Either) — then "Thank you, we have your request". "None of these suit" and an empty calendar lead to the same screen. Out of area shows the mockup's apology and "Send us a message" (details first if we hold none), then "Thank you, your message is with us".
- **Working days (R23, R33)**: `lib/time/workingDays.ts` — `endOfNextWorkingDay` (17:00 Melbourne of the next Monday–Friday that is not a public holiday); unit tests for Friday → Monday, the day before Melbourne Cup Day → Wednesday, Christmas Eve → 29 December, and 23:30 across the UTC day boundary. Per Tom's decision c, `addBusinessHours` / `nextBusinessMorning` / `nextOpen` in `businessHours.ts` take an optional holiday set.
- **Public holidays**: read from Business Victoria's published pages (details below), kept in `docs/briefs/data/vic-public-holidays.json` with source and date, merged into `visit_booking_rules.publicHolidays` by `scripts/seed-public-holidays.ts` (never removes dates Tom added). A `holidays_next_year` work-queue item appears from 1 November while next year's list is empty.
- **Work queue**: kind `visit_request` derived from open rows, due at the row's `due_at`, action → `/crm/visit-requests/[id]`; the wizard session's outcome note starts "Requested online:" so no `wizard_ready` card doubles it. Kind `holidays_next_year`.
- **Staff answer (§4.4)**: `/crm/visit-requests/[id]` shows the request and every free slot of every estimator with a week over the booking window (`availability()` with zone `"any"`; far edges kept). "Offer this time" books through the existing `visit_book` RPC, freezes the zone and far-edge flag, marks the request answered, and sends the `time_offered` text and email with the invitation. "Mark as answered" for a phone answer.
- **Messages (§4.5, R35)**: `postCustomerMessage` posts into the **estimate chat** after the range (a draft gets a share token if it has none) and into the **website chat** (`agent_conversations` + handoff) before it; the submit route links such a conversation to the estimate once it exists, so staff see one conversation per customer (Tom's decision b). One email goes to the office address with the customer on it. Same client id twice = one message (test 17).
- **Messaging**: `request_received`, `call_request_received` (email), `time_offered` (text + email), `customer_message` (email, always on); all editable under Settings → Automations and listed in the inventory.
- The old pre-range "Save & book" sheet no longer fetches the half-day windows (R3).

## Public holidays seeded (for Tom to check)

Source: Business Victoria (Victorian Government), "Victorian public holidays 2026" and "… 2027", read on 6 October 2026 through the browser. The pages say dates may be subject to change.

| 2026 | 2027 |
|---|---|
| 1 Jan New Year's Day | 1 Jan New Year's Day |
| 26 Jan Australia Day | 26 Jan Australia Day |
| 9 Mar Labour Day | 8 Mar Labour Day |
| 3 Apr Good Friday | 26 Mar Good Friday |
| 4 Apr Saturday before Easter Sunday | 27 Mar Saturday before Easter Sunday |
| 5 Apr Easter Sunday | 28 Mar Easter Sunday |
| 6 Apr Easter Monday | 29 Mar Easter Monday |
| 25 Apr ANZAC Day (Saturday, no substitute) | 25 Apr ANZAC Day (Sunday, no substitute) |
| 8 Jun King's Birthday | 14 Jun King's Birthday |
| 25 Sep Friday before the AFL Grand Final | **not published — "subject to AFL schedule"** |
| 3 Nov Melbourne Cup | 2 Nov Melbourne Cup |
| 25 Dec Christmas Day | 25 Dec Christmas Day (Saturday) |
| 26 Dec Boxing Day (Saturday) | 27 Dec Christmas Day substitute |
| 28 Dec Boxing Day substitute | 26 Dec Boxing Day (Sunday); 28 Dec Boxing Day substitute |

28 dates in the list. Weekend dates are kept as published (the schedule has no weekend slots). **Pending:** the 2027 Grand Final Friday — add it under Settings → Booking rules when Business Victoria publishes it.

## Done-when, as verified

| Check | Result |
|---|---|
| Friday request due end of Monday; day before a holiday due the next working day after it | ✅ unit (`workingDays.test.ts`) |
| Holidays seeded from the official list; dates and source in this report | ✅ (test project; Tom runs `--prod`) |
| Typecheck, lint, unit suites (1,223 tests) | ✅ |
| Migration on the test project, read-back 2 / 2 / 1 / 0 | ✅ |
| Sorrento never sees the calendar and creates a time request | encoded in `e2e/customer-journey/visit-requests.spec.ts` — **not yet run** |
| Werribee: out-of-area screen, message, lead saved; message appears once, emailed | same spec — **not yet run** |
| Visit requested at step 2 with all four fields, nothing booked | same spec — **not yet run** |
| Overdue request shows in the existing queue; no new list | same spec — **not yet run** |
| Staff offer a time; customer receives it; slot taken | same spec — **not yet run** |
| Speak with us shown inside the phone range, absent outside; one call request; API refuses outside (test 16) | same spec — **not yet run** |
| Message before the range asks details first; after the gate straight to the box | same spec — **not yet run** |

**The e2e did not run.** The single attempt was REFUSED: the test project was held by a CI e2e run that started at 10:21Z (the S3 merge). Per the standing rule there was one try and no retry loop. CI on the PR runs the spec; or, when CI is idle:

```bash
./scripts/c1/run-e2e.sh e2e/customer-journey/visit-requests.spec.ts e2e/customer-journey/visit-booking.spec.ts e2e/customer-journey/save-and-book.spec.ts
```

The help page `docs/help/visit-requests/staff.md` was written from the screens as built; if the e2e disagrees with it, the help follows the app and the discrepancy goes in the next report.

## Decisions taken inside the brief's rulings

- "Both" jobs use the exterior cap for Speak with us (anything with an outside is not a straightforward interior).
- A pre-range message creates a website-chat conversation with a handoff, so it reaches the one staff inbox and Today like any "talk to a person"; no new alert.
- Section 10's "New request or message → staff → work queue": requests raise `visit_request` cards; messages reach staff through the existing chat alerts and handoff cards (one fact, one card).
- The "Save & book" header pill is kept (it saves the session and asks for a call back) but no longer offers the old windows.
- The submit route carries `guideRange` on `builder_state` so a call request can be checked server-side after the fact.

## For Tom

1. PR from `feat/visit-booking-s4`.
2. Paste `20270215000000_visit_requests.sql` (sent), then run the holiday seed on production (command sent in chat).
3. Check the holiday table above against the Business Victoria pages.
4. After the deploy: on your phone, build an estimate at a Sorrento address and tap Book your estimator; you should see "We visit Sorrento by arrangement", pick days, and the request should be on Today within a minute. Then open it from Today and offer a time.

## Next: S5

Google Calendar: connect the estimator's account, write the one-hour event with the customer as guest and the 30-minute travel block, read busy times, cancel on decline, push notifications + sweep, R27 moves/deletes, the reminder text, disconnect handling. Needs Tom's answer on whether info@ is Workspace or Gmail (decision a).

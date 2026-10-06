# Visit booking, addendum A — S3 report (walking skeleton: book a visit)

**Date:** 6 October 2026 · **Branch:** `feat/visit-booking-s3` (stacked on S2) · **Migration:** `20270214000000_visit_holds.sql` (applied on the TEST project, read-back matched; sent to Tom to paste after 20270213)

## What was built

- **Migration 20270214**: `visit_holds` (hashed code, attempts, resends, expiry; one LIVE hold per slot per estimator and one per estimate by partial unique index), `visit_code_sends` (the fact behind the per-mobile / per-IP limits), four definer RPCs granted to `service_role` only: `visit_hold_place`, `visit_hold_resend`, `visit_hold_release`, `visit_hold_confirm`. Confirm is the one transaction: code check, advisory lock per estimator-day, one active wizard visit per estimate, the full 90-minute run clear of confirmed visits, the R18 far-edge pairing, then the `visits` row (booked, source wizard, zone and far edge frozen, `ends_at` = start + 60) whose trigger writes `visit_booked` to `crm_events`.
- **`lib/visits/holds.ts`**: `loadVisitContext` (address → `resolveZone` → the zone's estimator → `availability()` fed by the week, confirmed visits, live holds and the estimator's Google busy times), `saveVisitDetails` (through `ensureAccountAndProperty`), `placeHold`, `confirmHold` (re-runs availability with the customer's own hold set aside, then the RPC), `resendCode`. `lib/visits/ownedEstimate.ts` is the one door for the routes (anonymous customers only on their own draft; staff on any).
- **Routes** `/api/visits/{details,hold,confirm,resend,availability}`, zod-validated, rate-limited, nothing from the browser trusted: the hold body carries only an estimate id and a start instant.
- **Customer page** `/estimate/visit?id=` with mockup 4's screens and wording: "A few details first" (only when we hold none), "Choose a time for your site visit", "Confirm it's you", "Your site visit is booked", and the plain "That time has been released" with a button back to the calendar. Pre-arranged / out-of-area / unmapped get the mockup's headline and hand off to the Book page's request-a-call-back until S4.
- **Entry points**: the reveal's "Book your estimator" door and the Book page's "Book a site visit" now go to the new page. The old half-day windows are no longer offered to customers.
- **Messaging**: `visit_code` (text, always on, never held, template `visitCodeSms`) and `visit_booked` (text, `visitBookedSms`), both editable under Settings → Automations; the email with the .ics invitation is the existing `visit_confirmation`, whose `visit_when` now reads "Monday 5 October, 2:00 pm to 3:00 pm" (R32). New `crm_events` type `visit_hold_placed`.
- **Submit route**: a TYPED address (no Google Places pick) now also lands on the estimate as `jobAddress`, with the street parsed from the typed line and the suburb and postcode from the fallback fields. Without it the booking page could not tell which zone a typed address was in — the first e2e run found this. The address loader also falls back to the wizard draft for older estimates.

## Done-when, as verified

| Check | Result |
|---|---|
| Anonymous customer books a Zone 1 visit from the range screen to the confirmation screen | ✅ `e2e/customer-journey/visit-booking.spec.ts` |
| The booked slot no longer shows for a second customer | ✅ same spec, through `/api/visits/availability` |
| Section 8 tests 1–9 | ✅ `e2e/visit-booking-api.spec.ts`, against the API with the anonymous session's cookies |
| Section 8 tests 10, 11, 13, 15 (bonus) | ✅ same spec |
| Screens match the mockup in order, wording and controls | ✅ asserted in the customer spec: headings, the "These are the times we are in Glen Waverley and nearby." line, both links, the masked mobile, the one-hour summary, the booked paragraph |
| Visit row: booked / wizard / quote / zone_1 / 60 minutes; hold confirmed; `visit_booked` event; booked text carries "2:00 pm to 3:00 pm" | ✅ |
| Typecheck, lint, unit suites (lib/visits, automations, crm, messaging, wizard: 1,201 tests) | ✅ |
| Migration on the test project, read-back 2 / 2 / 4 / 0 / 0 | ✅ |

**e2e: 12 / 12 green** on the test project (second run; the first run failed on the typed-address gap above, fixed before this push).

Test 4 as built: two customers call hold on the same slot at the same moment; exactly one gets it; the loser cannot confirm with the winner's hold id (404) and only the winner's confirmation books. Test 13 as built: far-edge Zone 4 (Mornington) holds Friday 08:00, far-edge Zone 3 (Lilydale) holds 09:30 — a hold is not a booking, so both holds stand — Zone 4 confirms, then Zone 3's confirmation is refused with `unavailable`.

## Decisions taken inside the brief's rulings

- The code is read back in e2e from the `messages` row the adapter records; the test stack has no Twilio, so no real text is sent. Section 11's "test customer's mobile" is only needed for a run against a Twilio-configured stack.
- Codes are hashed with `VISIT_CODE_SALT` (falls back to `WIZARD_IP_SALT`). Add `VISIT_CODE_SALT` to Vercel if you want them separate; not required.
- `visits.ends_at` is the visit the customer sees (60 min). The 90-minute block is enforced by the availability rule and by the confirm RPC's overlap check on the full run (test 19), not by the visits exclusion constraint.
- The Google Calendar event is NOT written yet (S5). A booked visit reaches the estimator's app-created "Paint Group Visits" calendar only through the existing wo-sweep reconcile. The customer gets the .ics invitation by email as today.
- "None of these suit", pre-arranged, out of area and unmapped hand off to the existing Book page (request a call back) — S4 builds the real screens and work-queue items.
- Test 9 ("never shown its range") is covered as: no estimate / not this customer's estimate / no contact yet → refused. The range-shown fact itself arrives with S6's tracking.
- Test 12, 14, 16–18: 12 and 16 belong to S6/S4; 14 is covered by `ownedEstimate` (and test 9's cross-customer check); 17 is S4; 18 passed in S2.

## For Tom

1. PR from `feat/visit-booking-s3` (contains S0–S2).
2. Paste `20270214000000_visit_holds.sql` after 20270213 (sent in chat). No seed follows it.
3. Once deployed, a real-phone walk: build an estimate at a Zone 1 address on your phone, tap **Book your estimator**, enter your details, pick a time, enter the code from the text. The visit should be on the Diary within a minute, the text and the email with the invitation in your inbox.
4. Settings → Automations: read the two new texts' wording.

## Next: S4

Requests, pre-arranged and out of area: the three options on every wizard step before the range (R3, R4), the request-a-time screen, "None of these suit", the out-of-area message step, work-queue items due within one working day with the public-holiday list seeded from the official Victorian list, Speak with us, Send us a message into the two chats shown together on the staff side.

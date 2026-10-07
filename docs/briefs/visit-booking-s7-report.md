# Visit booking, addendum A — S7 report (full loop and hand-over)

**Date:** 7 October 2026 · **Branch:** `feat/visit-booking-s7` (from main, after the S6 merge) · **Migration:** none

## What was built

- **The full loop as one spec** — `e2e/customer-journey/visit-full-loop.spec.ts`, anonymous customer: wizard → gate (details first) → range → Book a site visit → calendar (no details screen, the gate already took them) → hold → text code → booked → the guest declines → the slot is offered to the next customer and the card is on Today. The decline is applied at the seam the inbound Google sync uses (`visit_set_status` cancelled with `declined_invitation`), because the test project has no Google credentials or connection; the spec also asserts that nothing reached Google there.
- **Section 8, now complete**: 1–11, 13, 15 in `e2e/visit-booking-api.spec.ts`; 12 in `gate.spec.ts`; **14** (another customer calling this booking by id → 404 on resend, confirm and availability; the visit stays booked) and the platform half of **19** (a booked slot blocks its full 90 minutes for the next customer, whatever happens to the travel block in Google) in the full loop; 16 and 17 in `visit-requests.spec.ts`; 18 in `visit-schedule.spec.ts`.
- **Help from the finished screens**: `docs/help/visit-booking/staff.md` rewritten — the gate as the last question, the R24 option order, the request screens for pre-arranged / unknown / nothing-suits and the out-of-area message box (it still said those customers were "sent to the Book page" from before S4). `visit-zones`, `visit-schedule` (already carried the gate order) and `visit-requests` were read against the screens and left as they are. No customer-role file: per `docs/help/README.md` customer help is written when the portal exits its proving window.
- **Inventory**: every row of the brief's section 10 is in `docs/briefs/messaging-automations-inventory.md` — text code, visit booked (text + .ics email), request received, time offered, visit cancelled, reminder, call request received, customer message, and the work-queue rows (declined, request waiting, unmapped suburb, calendar not connected, moved in Google). "New request or message → staff → work queue" is served by `visit_request` cards for requests and, for messages, the existing chat alert (`office_estimate_chat`) and handoff cards — decided in S4, one fact one card.
- **Tom's 90-second walkthrough**: `docs/manual-tests/visit-full-loop.md`, phone, production, with a tick box per screen.

## Verified

| Check | Result |
|---|---|
| Full loop (above) | encoded — **not run here** (see note) |
| Section 8 across the five API/journey specs, S6 gate, S3 booking, S4 requests, S5 gating, S2 schedule, S1 zones, Save & book | **not run here** (see note); each spec was green on C1 or in CI when its session merged |
| Typecheck, lint (0 errors, 4 pre-existing warnings), unit suite 3,158, help index | ✅ |
| CI on main after the S6 merge | ✅ green (run 37548673574) |

**e2e did not run.** Both attempts were REFUSED: the test project is held by the S6 pull request's CI e2e job (run 37548103178, started 23:46Z, still running after 45 minutes while the merged main run had already passed). One try, one wait, one retry, no loop — Tom's rule. The full-loop spec is typechecked and linted; CI on the S7 PR is where it first runs. If that PR run is also queued behind a stuck job, cancel the S6 PR run under Actions — its branch is already merged and main is green.

## The health check

There is no script called "health check" in the repo; for this brief it is the set below. Items marked Tom need production and the Supabase console.

| | Check | State |
|---|---|---|
| 1 | `tsc`, `eslint`, `vitest`, `help:index --check` | ✅ clean |
| 2 | The visit e2e suite on the test project | see Verified |
| 3 | `_prod_migrations` has rows for 20270212, 20270213, 20270214, 20270215, 20270216 (gcal), 20270217 | **Tom** — all six were pasted; check the ledger lists all six names |
| 4 | Security Advisor: 0 errors | **Tom** — after 20270217 |
| 5 | Public holidays seeded on production (`scripts/seed-public-holidays.ts --prod`) | **Tom** — still outstanding from S4 |
| 6 | Google: consent screen Internal, Diary reconnected with the write scope | **Tom** — from S5 |
| 7 | The 90-second phone walkthrough | **Tom** — `docs/manual-tests/visit-full-loop.md` |

## What cannot be verified here

The Google half of the loop — the event appearing within a minute, the invitation, the decline from Gmail, Outlook and Apple Mail, the cancel text, the travel block deletion in test 19 — needs the real calendar. `docs/manual-tests/visit-gcal.md` (S5) and `visit-full-loop.md` (this session) cover it. **If the Outlook or Apple Mail decline does not reach Google, the brief says STOP** and a cancel link in the text is the fallback for Tom to rule on.

## Decisions for Tom (section 11), as built

- ⚑1 Public holidays: slots on a listed day are **not offered** (built as the starting value).
- ⚑2 Calendar: the **main** calendar of info@paintgroup.com.au (built, decision a).

## For Tom

1. Open the S7 PR from `feat/visit-booking-s7`. No SQL.
2. Run the checks marked Tom in the health check, in order: ledger, Security Advisor, holidays seed, Google reconnect, then the phone walkthrough.
3. Report any step of the walkthrough that reads differently from the help file — the screen wins and the help follows.

## The brief is built

S0–S7 are done. What is left is Tom's production checklist above and the two "Still open" items in the mockup, both built at their starting values.

# Visit booking, addendum A — S6 report (the gate)

**Date:** 7 October 2026 · **Branch:** `feat/visit-booking-s6` (stacked on `feat/visit-booking-s5`, which is stacked on S4 — merge in order) · **Migration:** `20270217000000_wizard_gate.sql` (applied on the TEST project, read-back 6 / 1; to paste after 20270216)

## What was built

- **The gate (R5)**: under "details first" the quick look's last question is a contact screen — "Last question", "Where shall we send your estimate?", full name, email, mobile, an unticked marketing box, and **Show my guide price**. Nothing moves without all three. The range follows at once; the account exists from that moment (`accounts` row named from the gate), and the marketing tick is recorded as consent.
- **The switch (R6)**: Booking rules → **gate order** (`visit_booking_rules.gateOrder`, already in Settings from S2) now drives the wizard. `/estimate` reads it on the server and the wizard builds its steps from it (`lib/wizard/quick-look.ts` `stepsFor(..., gate)`).
- **Range first (R7)**: no contact screen; the range shows on the ninth tap as before; **Tighten my price** opens the details sheet ("We will save your estimate so you can come back to it.") before going to the scope editor. Book a visit and Send a message already ask for details on their own screens (S3/S4).
- **Per-session tracking (§4.7)** on `wizard_drafts` (= `wizard_sessions`): `gate_version` frozen at the session's first save — flipping the switch mid-session changes nothing for it; `gate_shown_at`, `gate_completed_at`, `range_shown_at`, `range_option` + `range_option_at` (the first choice counts: tighten | speak | visit | message, via `/api/wizard/range-option`).
- **A fast walk still gets a session**: a customer who reaches the range in under the 2.5-second autosave debounce (the e2e drive does; a quick human can) had no session row at all, so the submit route now makes one — without `state`, which keeps its single writer — before stamping and converting it.
- **The API rule**: `/api/wizard/submit` answers **409 `gate_required`** under details first when the posted contact is incomplete, using the SESSION's recorded version (never the browser's claim). The two-estimates-per-visitor limit is unchanged and still counts by email or IP.
- **The range screen (R24)**: options in order — Tighten my price (the hero, "Get a more accurate quote now"), Speak with us (when the server says so), Book a site visit, Send us a message. "Keep this estimate" is shown only when no contact is known yet (range first). "Request a quote" wording is gone.
- **The dashboard**: "Where estimates go" gained **The gate, by version** — sessions, reached, completed, lost at the gate %, saw the range, and what they did next, per version, with a CSV export (`funnel.gate_sessions`). Roles owner / admin / sales.
- Help: `docs/help/visit-schedule/staff.md` (gate order) and `docs/help/dashboard/staff.md` (the gate table) updated.

## Verified

| Check | Result |
|---|---|
| Details first: gate is the last question with the mockup's wording; empty submit refused; range follows; session records version / shown / completed / range shown; account named; R24 order, Tighten hero, no Keep; option recorded on click | ✅ `e2e/customer-journey/gate.spec.ts` (anonymous customer) |
| At the API: the browser's real submit body replayed without contact → 409 `gate_required`; with contact the visitor cap refuses within the cap | ✅ same spec |
| Range first: no gate screen, range shown, Tighten asks for details, session says range_first + completed, option tighten | ✅ |
| A session keeps its version after the switch is flipped (reload rebuilds steps from the saved version) | ✅ |
| Dashboard gate table counts both versions; CSV export | ✅ |
| S3 booking and the Save & book journeys still pass | ✅ `save-and-book.spec.ts` 4/4, `visit-booking.spec.ts` 1/1 |
| Migration on the test project, read-back 6 columns / 1 index | ✅ |
| Unit suite 3,156, typecheck, lint (0 errors, 4 pre-existing warnings), help index | ✅ |

**e2e ran on the test project: 10 / 10** (gate 5, save-and-book 4, visit-booking 1). S4 and S5 specs were not re-run here; CI on each PR runs them.

### Found while testing

- The test project's `wizard_limits.maxEstimatesPerVisitor` is 5,000 (raised for the volume runs). The API test pins it to 2 for its own run and restores it.
- The visitor cap counts by email **or** IP, so in a one-IP run the refusal can land on the first replay rather than the third. The test asserts the cap fires within the cap, not on which call.
- `/api/wizard/draft` drops any save within ten minutes of a conversion ("just finished"), so "gate shown" for range first is stamped with "gate completed" when the details sheet is answered — they happen together there.
- The export route takes `preset=month|week|quarter|year|custom`, not `30d`.

## Decisions taken inside the brief's rulings

- The marketing box is unticked by default and recorded as consent only when ticked.
- Under range first the "Keep this estimate" door stays (the customer has given nothing yet); under details first it is gone (R24).
- `range_option` keeps the FIRST choice; a second tap on the range screen is not a second session.
- The session row the submit route creates for a fast walk carries no `state`; the estimate holds the answers.

## For Tom

1. Merge the S4 PR, then S5, then open the S6 PR from `feat/visit-booking-s6`.
2. Paste `20270217000000_wizard_gate.sql` after 20270216. Expected read-back: `gate_columns 6`, `gate_index 1`. No seed follows.
3. Settings → Booking rules → gate order: **details first** is the brief's default; range first is the test version.
4. Still outstanding from earlier sessions: `scripts/seed-public-holidays.ts --prod`; Google consent screen Internal + Reconnect on Diary; `docs/manual-tests/visit-gcal.md` (Outlook / Apple Mail declines are the STOP condition).

## Next: S7

Full-loop e2e across S1–S6, help pages for every role that can see the feature, messaging inventory completeness, and the health check.

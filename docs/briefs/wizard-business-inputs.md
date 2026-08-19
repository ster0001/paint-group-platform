# Wizard business inputs — Tom, Aug 2026 (v2, 19 Aug 2026)

Owner-supplied values the Step 7–8 builds must use; they override any
placeholder in the mockup. Committed beside the phase plan per the master
build plan.

**v2 note (19 Aug 2026): §2's thresholds are superseded.** Tom's later
policy (ruled in `wizard-rebuild-plan-v2.md` §0) replaces v1's
$7k / $15k / 80–90% ladder. §2 below now states the current policy; v1's
numbers are kept only as a struck-through record.

## 1. Typical room sizes (no-plan starter lists + wizard defaults)

| Room type | Dimensions (m) | m² |
|---|---|---|
| Toilet | 1.25 x 1.0 | 1.3 |
| Bedroom | 3.5 x 3.25 | 11.4 |
| Living room | 4.0 x 4.0 | 16.0 |
| Open-plan kitchen/living | 6.0 x 6.0 | 36.0 |
| Bathroom | 2.0 x 1.5 | 3.0 |
| Ensuite | 2.0 x 1.5 | 3.0 |
| Laundry | 2.0 x 1.5 | 3.0 |
| Garage | 6.0 x 4.0 | 24.0 |

These load into the room-type Settings (versioned with `room_type_scope_rules`)
as typical dimensions, editable in Settings like everything else in that table.
Wall areas derive from these + the storey ceiling height.

**Starter-list note:** because "open-plan kitchen/living" (36 m²) and
"living room + separate kitchen" are very different scopes, the no-plan basics
form gains one extra toggle: *"Open-plan kitchen/living?"* — it decides which
archetype the starter list uses.

## 2. Acceptance / sign-off policy (Settings values) — v2

- **Self-serve:** interior <= **$6,000** with accuracy **>= 90%**, OR
  straightforward exterior (workflow-doc definition) <= **$12,000** with
  accuracy **>= 85%** -> "Accept estimate" available online.
- **Everything else:** human sign-off — "Confirm my price — book the visit"
  (never a blocked state; the calendar is right there).
- Specialist handoffs (commercial, heritage, body corporate, lead-era +
  peeling, asbestos, under the $2,000 floor) unchanged.
- All four numbers ($6k, $12k, 90%, 85%) are Settings fields, not constants.

Rationale: the $2–4.5k band is the weakest-margin band in the job data
(~26% GP) — a +/-8% estimate error there can consume the entire margin, so
small jobs earn the tight +/-4% range before self-serve acceptance.

<details><summary>v1 policy (superseded 19 Aug 2026)</summary>

- ~~Accuracy >= 80% -> estimate can be accepted from the wizard.~~
- ~~Except jobs under $7,000: require accuracy >= 90% to accept.~~
- ~~Jobs >= $15,000: walkthrough always required before acceptance.~~ (the
  $15k walkthrough rule is deleted, not just re-numbered)

</details>

## 3. Exterior without a listing URL

2–3 facade photos required before quoting (front + each visible side).
Confirmed.

## 4. Copy tone

Wizard and customer-facing copy should read **English rather than Australian**
— polite, understated, precise. e.g. "Not a problem — thirty seconds of basics
instead" over "No worries"; "That's everything we need" over "Too easy".
Applies to wizard pages, editor, toasts, emails from the wizard flow. The
mockup's copy gets this pass in the Step 7 build.

## 5. Rate limiting + trade accounts

- Standard visitors: **maximum 2 estimates** per email/IP; beyond that, a
  polite hold — "Looks like you're busy — talk to us and we'll set you up
  properly."
- **Commercial/trade accounts** (real estate agents, builders, property
  managers): unlimited estimates. This introduces an `account_type`
  (residential | trade) with a light sign-up/approval path — and it's a
  channel, not just an exception: an agent running listings through the wizard
  is repeat B2B work arriving self-served. Trade estimates route to the review
  queue tagged `source=trade_wizard`.

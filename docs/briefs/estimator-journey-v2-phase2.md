# Estimator journey v2 · phase 2 — the quick look and the guide range

**Built:** 9 September 2026 · **Branch:** `feat/quick-look-phase2` · **No migration.**
**Plan:** `docs/briefs/estimator-journey-v2-plan.md` §3, §9 step 2.

## Why this came last instead of second

Phase 3 was built first at Tom's direction, and the sequence then ran forward —
3, 4, 4b, 5a, 5b, 6, 7a, 8a, 8b, 9 — without ever coming back. Seven of the
nine phases shipped, and the two that did not were the two the customer walks
through first. From the outside that read as "the wizard is unchanged", because
it was: everything built so far sits *behind* the price, and phase 2 is the
part in front of it.

## What it replaces

The five-page interior wizard — property, surfaces, condition, details,
contact — is no longer the customer's way in. It still exists, still serves
staff, and is still what the describe and upload routes walk. A customer now
gets **four screens and eight questions**:

| Screen | Asks |
|---|---|
| `start` | The address, and inside / outside / both |
| `place` | House, townhouse, unit or commercial · bedrooms · storeys |
| `job` | Scope preset · colour intent |
| `condition` | Condition band · living there while we paint |

Then the **guide range**: a range with the customer's own answers read back,
every assumption we made for them listed and tappable, and three doors with no
hierarchy between them — tighten online, book an estimator, keep the estimate.

## The rule the whole design rests on

**Ask only what a person standing in their own hallway can answer.** They know
how many bedrooms they have and whether the place looks tired. They do not know
how many coats a trim needs, what a bonding primer is, or their ceiling height
to the nearest 300 mm. Everything in the second category is derived and then
shown back — on the reveal's assume list, and on the paint-systems card that
phase 4 built.

Concretely, the quick look never asks: door style, window style, ceiling
height, size band, open-plan layout, heritage, body corporate, build year or
asbestos. All of them have honest defaults, and every one of them is listed
under the range.

## The three decisions worth arguing with

**1. The four hazard questions default to `"unsure"`, never `"no"`.**
This is the safety question the whole design rests on, and it is safe because
the policy ladder already treats `asbestos_unsure` and `heritage_unsure` as
SOFT flags (Tom, 7 Sep: *"not sure about asbestos is a flag for the visit,
never an online accept, not a dead end"*), and the wizard stopped asking the
build year at all because the office looks it up. So the range still shows, the
job still flags, and **nobody self-accepts on an unanswered hazard question**. A
definite "yes" from staff, the assistant or the detailed pages still hard-stops
exactly as before. We decline to guess; we do not decline to check.

**2. "Needs work" maps to damage tier 2, not 3.** ⚑ Tom's call if he disagrees.
The engine has four tiers; the customer is offered three, because a homeowner
cannot tell 2 from 3 by eye. At quick-look resolution "flaking, cracked
plaster, water marks" is a job with real preparation in it, not a restoration,
and a guide range must not overstate. Tier 3 stays reachable where it is
actually earned — a photographed spot in the tighten stage.

**3. `openPlanKitchenLiving` defaults to false.** Not asked. Living + separate
kitchen is the smaller of the two layouts, and the starter list's own rule is
that under-scoping is a conversation in the editor while over-scoping is a
wrong quote.

## Two prior rulings this reverses, deliberately

**⚑1 — the email gate.** `wizardStateSchema`'s comment read *"the email gate
before anything is revealed"*. §2.6 calls that "reasonable for retargeting;
costly for conversion", and Tom's ruling was "after, with a soft email-me-a-copy
bar under the range". A state can now be priced with no email; what needs one
is *keeping* it, which is the reveal's third door wearing its honest purpose.
The submit route's rate limiter was keyed on `email.eq.${email}` — with an
empty email that matches every emailless lead ever written, so it now keys on
the IP hash alone when there is no address.

**Tom, 28 Aug — "no interstitial result screen".** That ruling was right for a
wizard whose price arrived after 25-30 answers and a contact form: by then
another screen was a toll on somebody already committed. The quick look's
promise is the opposite — a number in under a minute, no commitment — so the
reveal *is* the product. The describe and upload routes still land straight in
the editor; they asked the long questions, so they have earned it.

**⚑14 still stands: nothing was demoted.** The describe and upload routes keep
their place on the first screen, as offers rather than as a toll gate in front
of the price (§2.1's first complaint). Their testids are unchanged.

## Not in this phase

- **The exterior quick look** (§3's branch, §9.7's other half) — still blocked
  on the per-elevation allowances spec. An outside-only job leaves the quick
  look after screen 2 and takes the existing exterior pages.
- **The commercial branch** keeps the phase-7a segment question and gates.
- **The hand-off screen** (§3's "Thanks — Sarah has it") — the three doors
  route to the flows that already own them.

## Traps found building it

- **A stale `next start` on :3101 makes every e2e assert against the previous
  build.** The first run "failed" showing the old five-page form. Check
  `lsof -ti:3101` before believing an e2e result.
- **Two cards now say nearly the same sentence**: phase 5b's job extras
  ("Anything we haven't listed — OPTIONAL") and the confirm loop's sweep
  ("Last check — anything we haven't listed?"). A text locator matches both.
  Addressed in the spec by `[data-card="sweep"]`; ⚑ worth renaming one in the
  product.
- **The submit closure reads `state`**, so a quick look that called `setState`
  and submitted in the same tick would price the previous answers.
  `runSubmit(override)` hands the derived state in directly.
- **Places is unavailable in the test stack**, so `AddressField` degrades to a
  plain input and no structured address is ever picked. Without a postcode the
  service-area check reads the job as outside the area — a handoff caused by
  our own outage. The suburb/postcode pair appears as a fallback the moment
  they have typed something the lookup did not resolve.
- **Door and window style moved to the editor**, which already had the chips.
  Three specs that drove them through the wizard now use `setStylesInEditor`.

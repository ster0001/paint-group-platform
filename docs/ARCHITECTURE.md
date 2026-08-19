# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

---

## AI plan reader — P0: the boundary, the schema and the file pipeline

**2026-08-17 · `lib/extract/`, `app/api/extract/floorplan/route.ts`,
`app/dev/extract/[runId]/`, `supabase/migrations/20260910000000`**

The first piece of the plan reader, and the app's **first API route**. It takes
a plan, works out what it is from its bytes, rasterises each page at 200 DPI,
lifts the text layer, classifies each page, stores everything in a private
bucket and writes one run row per page. **No model call** — that is P1. The
brief's own reasoning: the model call is the easy part; the accuracy lives in
the geometry and the plumbing.

**Two departures from the brief, both forced by the actual schema.** There are
no `areas` / `surfaces` tables to add provenance columns to — the builder tree
lives in `estimates.builder_state` jsonb with integer node ids, and
`estimate_areas` / `estimate_lines` are vestigial (nothing reads them). So
per-node provenance goes inside the jsonb node as additive fields, which suits
the brief's first rule better than a side table: the AI adds fields to the tree
rather than changing its shape, provenance survives duplicating an area, and no
backfill is needed because an absent `origin` reads as `human_confirmed`.
`defect_observations` therefore keys by `estimate_id` + the builder's own node
ids rather than by foreign key.

**mupdf (WASM) over poppler or a native canvas**, because it needs no system
binary and runs unchanged on Vercel. It also extracts the text layer, and that
turns out to matter more than the rendering: on a vector plan the dimension
strings come back exactly — `3.60 x 4.20` as characters. The brief names small
dimension text as the single biggest source of read errors; for digital plans
that is largely solved before the model is asked anything. A scan has no text
layer, says so, and carries low confidence.

**Page classification is deterministic**, from the text layer, and explains
itself in words that surface on the debug page. It found a real trap while being
tested: a Victorian **Section 32** vendor's statement is routinely bound into
the same PDF as the plan, and "section" is also a drawing term — it was reading
as an elevation sheet. Only a drawing-shaped label (`SECTION A-A`,
`SECTION 1:100`) counts now.

**No service-role key.** The brief specifies one; this app has never had one and
runs on the anon key plus RLS. The route uses the caller's own session, so RLS
and the storage policies do the enforcing — strictly safer than introducing a
key that bypasses them.

---

## An offer may only go to a compliant contractor

**2026-08-17 · `supabase/migrations/20260909000000`, `app/(app)/schedule/actions.ts`**

**Found by the end-to-end test on its first real run**, which is the entire
argument for having one. The test dropped a job on the first lane of the board;
lanes sort by company name and a contractor who hasn't filled hers in sorts to
the top, so the offer went to someone with **no verified insurance certificate**.
It was accepted by the system without complaint. Had she accepted it, an
uninsured painter would have been booked into a customer's home.

`send_offer` checked `active` (not suspended) but never `offerable`. Everything
upstream of that flag was correct — the trigger that computes it, the staff
verification step, the column privileges stopping a contractor setting it
themselves. Nothing consulted it at the moment it decided anything.

The fix also closes the stale-flag gap carried since Phase A: `offerable` is
recomputed only when a `contractor_documents` row changes, so a certificate that
lapses untouched leaves it reading true. `send_offer` now recomputes at the
point of use, so an offer can't ride on a certificate that expired last month.

Non-offerable lanes still appear on the board on purpose — staff need to see who
is nearly ready, and those lanes are already marked. The send is refused, not
the visibility.

---

## R6 — error reporting, query counts, and the last of the input validation

**2026-08-17 · `lib/monitoring/report.ts`, `lib/contractor/session.ts`,
`supabase/migrations/20260908000000`**

**The silent catches were worse than silent (S9).** Nine `catch {}` blocks
swallowed failures — but Supabase's client returns `{ error }` and does not
throw, so most of those handlers never ran at all and the error was simply
never read. Three of them dropped real work: the customer's **signature** on
acceptance, and two staff writes (product sheen, and the work-order colours and
crew notes a contractor works to).

`lib/monitoring/report.ts` is now the single seam every failure goes through.
`reportIfError(result, { where })` takes the `{ error }` shape directly, which
is what makes the dropped-error class of bug hard to write again. Best-effort
calls (view pings, expiry sweeps) still continue on failure, but they warn
rather than vanish. There is no Sentry account yet, so rather than half-install
one behind a missing DSN, the file marks the one place `captureException` goes.
The three that lose data now surface: the customer is told plainly if their
signature didn't store, and staff see why a save failed.

**The portal ran its session guard twice per request (S5).** The layout called
`getContractorSession` and the page called `requireContractor`, each doing
getUser + profiles + contractors. The three queries are now behind React's
`cache`, which is per-request and therefore safe for an auth check. Measured by
counting executions against a running server: **4 runs for two page loads
before, 2 after** — one per render, three queries saved per portal view.

**Unbounded selects (S6).** The scheduling board fetched *every offer ever
made* on each load; it now takes a window, deliberately wider than the visible
range because settled offers supply the tray's decline note and proposals must
appear in the approvals queue whatever their dates. The contractors page asked
for every offer to compute two counts, and settings read every estimate row to
count presentation usage. Both now ask only for what they use. The builder's
product and contact lists are deliberately NOT capped — silently truncating a
picker is worse than the query it saves.

**Input validation, the C4 remainder.** Money and state already went through
validated functions; ordinary editable data had nothing checking *what* was
written, only which rows. Constraints now live in the database rather than a
route, because a CHECK cannot be gone around with the anon key and curl: crew
size 1–99, sane text lengths on the contractor and document tables, a trigger
refusing a certificate that expires more than ten years out (a trigger, not a
CHECK — "ten years from now" is not immutable), and invite lifetimes clamped to
30 days inside `create_contractor_invite`, which previously took whatever day
count it was handed.

---

## R5 — tests (Vitest + Playwright)

**2026-08-17 · `vitest.config.mts`, `playwright.config.ts`, `lib/**/*.test.ts`,
`e2e/`, `lib/scheduling/dates.ts`**

Audit finding S8: nothing built in the last five phases had a test. The offer
state machine, the privacy gate, compliance state and the date arithmetic were
all verified by hand against the live database — which found real bugs, but none
of it was repeatable.

`npm test` is now **Vitest**, and runs under `TZ=Australia/Melbourne`. The
timezone is not decoration: the worst bug this project has shipped was calendar
dates parsed as local midnight and formatted back through `toISOString()`,
which moved every computed date a day earlier east of Greenwich — a job dropped
on 1 September was saved as 31 August. A suite running in UTC cannot see that
class of bug at all. The first test in `dates.test.ts` asserts the suite really
is east of Greenwich, so the rest can't pass vacuously.

**`lib/scheduling/dates.ts` is new** and is the enabling change: `addDays`,
`dayDiff` and the local-`today` helper existed in three hand-copied versions
(board loader, schedule page, board component) which is how the versions
disagreed in the first place. One module, imported by all of them, tested once.

The 42 pricing tests moved across unchanged — only the `node:test` import line
differs — and 63 new ones cover the offer state machine (expiry lapses an
unanswered offer but never a proposal), the **privacy gate** (`toJob` and
`committedIds`, which decide whether a customer's address reaches a contractor's
browser), compliance state (`docState`, including the stale-`status` case), and
the FIN→PG finish mapping. 105 in total.

Each of those was checked by breaking the code and watching the test fail:
removing the redaction fails 2 privacy tests, and reintroducing the date bug
fails 6.

**Playwright** (`npm run test:e2e`, never part of `npm test`) drives a real
browser against the real database, so it is deliberately opt-in and takes its
logins from the environment — the config carries no credentials.
`contractor-portal.spec.ts` passes today and includes the standard that
contractor HTML never carries customer money, asserted against the raw response
body including the RSC payload. It matches this codebase's own field names
(`marginCents`, `subtotalCents`) rather than the bare word "margin", which
appears in framework CSS — the same false positive the audit itself hit.
`offer-accept.spec.ts` covers the critical path end to end but **has not been
run**: it needs a staff login, which the session that wrote it did not have.

---

## R4 — upload limits, the bank-change alert, and two small things

**2026-08-17 · `lib/uploads/validate.ts`, `supabase/migrations/20260905000000`
–`20260907000000`, `app/(app)/contractors/`, `app/join/[token]/page.tsx`**

Four independent audit findings, none of which needed the others.

**Uploads are constrained by the bucket, not the file input (C5).** All six
upload paths went browser → Storage with only `accept=` between them and the
bucket, which is a UI hint. Each bucket now declares `file_size_limit` and
`allowed_mime_types`, so Storage refuses an oversized or wrong-typed file
whether or not a browser was involved. `lib/uploads/validate.ts` holds the same
rules for the pre-flight message, so a painter is told *before* pushing 200 MB
up a phone connection. SVG is on no list anywhere: it can carry script.

**Bank changes raise an alert (S10).** `contractor_set_bank` has always written
a `bank_changed` event; nothing read it. The event now records what the details
changed *from*, and only fires when they actually moved. `/contractors` opens
with a queue of unacknowledged changes — old account → new — that staff clear
with "I've checked this" (`acknowledge_contractor_event`). This is the
invoice-redirection control; encryption and masking were already in place.
`contractor_events` lost all client write access in the process: every event is
written by a SECURITY DEFINER function, and an audit trail its subject can edit
is not one.

**`/join/<unknown>` 404s (S2).** It rendered a friendly 200, which told a
guesser the difference between "no such invite" and "one that was revoked".
Real-but-dead invites (revoked, used, expired) keep their friendly page — the
painter holding one deserves to know which it is.

**`work_orders.contractor_id` is indexed (S4)** — it sits in the portal's RLS
policy, so it was evaluated on every contractor read of the table.

---

## R3 batch 1 — work orders through the server (recorded late)

**2026-08-17 · `supabase/migrations/20260904000000`, `app/quote/workOrderActions.ts`**

R2 revoked `wo_snapshot`, `contractor_payment_cents`, `status`, `issued_at`,
`contractor_id` and `start_date` on `work_orders` from client roles — correctly,
since they are money and state — but the builder still wrote them directly, so
"Issue to contractor", the contractor dropdown and the start-date field had been
broken on the live database since that migration ran.

`issue_work_order` takes no document and no amount: the server reads both from
the estimate's saved work-order document, the same source `accept_estimate`
uses, so restoring the button cannot reopen the hole R2 closed.
`set_work_order_schedule` handles the contractor and start-date controls and
refuses to reassign underneath a live offer (`conflict:live_offer`) rather than
silently desyncing the work order from the offer. Hand-edited content — colours,
crew notes, hours overrides — still writes directly under RLS; it is neither
money nor state.

---

## R2b — the server boundary for estimate send and accept

**2026-08-17 · `supabase/migrations/20260903000000`, `app/quote/actions.ts`,
`lib/validation/estimate.ts`**

Two holes closed.

**Accepting a quote no longer trusts the browser's total.** `accept_estimate`
took `p_total_cents` from its caller, and that caller is the customer's browser
on a public token page — anyone with the link could accept a $9,800 quote for
$1, and the deposit invoice is raised from that figure. It now derives the total
from the estimate's own stored snapshot and ignores what it is handed. The
parameters stay for compatibility; `estimate_events` records the figure the
client claimed alongside the one actually used, so an attempt is visible.

**Sending is a guarded transition.** `send_estimate` refuses to send an accepted
(locked) quote and returns `conflict:<status>` if the screen's idea of the state
is stale. `estimates.status`, `sent_at`, `accepted_at`, `accepted_name` and
`accepted_signature` are revoked from client roles; everything the builder
legitimately saves stays writable.

**Still open, and it needs a decision:** `estimates.subtotal_cents` and
`total_cents` are still written by the builder on save. Recomputing them
server-side needs `SUPABASE_SERVICE_ROLE_KEY` in the server environment —
permitted by CLAUDE.md, but the app has no such key today. Until then those two
columns remain client-written. Flagged rather than half-done.

---

## R2 — the server boundary for booking money and state

**2026-08-17 · `supabase/migrations/20260902000000`, `lib/validation/booking.ts`,
`app/(app)/schedule/actions.ts`**

Booking writes no longer come from the browser. Each transition is one
SECURITY DEFINER function = one transaction (`send_offer`, `withdraw_offer`,
`reassign_offer`, `move_booking`), fronted by a server action that zod-validates
its input and checks the caller is staff.

Three properties worth stating plainly:

1. **No amount crosses the wire.** `send_offer` reads the payment from
   `work_orders.contractor_payment_cents`, which the server wrote from
   `lib/pricing` — the reason R1 came first. The zod schemas have no field for
   an amount, deliberately.
2. **Every transition takes the expected current state** and returns
   `conflict:<actual>` if the row has moved on. A stale tab can no longer
   withdraw an offer the contractor already accepted; it gets "refresh".
3. **The back door is shut.** `revoke insert, update, delete on booking_offers
   from authenticated`, and `work_orders` keeps write access only to the
   hand-editable columns (crew notes, colours, access notes). Calling
   supabase-js directly with the anon key is refused by the database, not just
   discouraged by the UI.

Contractor-side responses (`respond_to_offer`, `resolve_proposed_offer`,
`cancel_booking`) already had this shape and were left alone.

**Deferred to R2b:** estimate send/accept still write status directly, and
`accept_estimate` still takes a total from the caller. Invoices and variations
don't exist yet, so their RPCs wait for the features.

---

## R1 — estimate pricing extracted to `lib/pricing/`

**2026-08-17 · `lib/pricing/estimate.ts`, `app/quote/QuoteBuilder.tsx`**

All estimate arithmetic moved out of the builder component into
`lib/pricing/estimate.ts` as pure functions: plain typed objects in, integer
cents out, no React, no Supabase, no clock. `QuoteBuilder` now assembles inputs
and renders results — it computes nothing. 135 lines lighter.

Why it matters beyond tidiness: the server can now reproduce any amount. That is
the precondition for the server boundary (R2), where a booking offer's payment
must be derived server-side rather than accepted from the browser.

The safety net is `lib/pricing/golden.test.ts`: it reprices every estimate in the
dev database and asserts the result matches what the ORIGINAL in-component code
stored — an independent check, since those figures were produced by the code
being replaced. Fixtures live in `__fixtures__/golden-estimates.json` and carry
no customer data (only the fields that affect a cent).

One case needed an override: an estimate whose stored total predates a reference
price change. The value the original code produces *today* was read from the
running app and recorded with provenance in `__fixtures__/golden-overrides.json`
rather than the fixture being quietly re-recorded.

`npm test` now runs the whole pricing suite — 42 tests.

**Still non-compliant here:** money is still written to the database from the
browser; that is R2's job, not this phase's.

---

## Estimates are snapshots, and staff read the same one the customer does

**2026-08-17 · `app/quote/QuoteBuilder.tsx`, `app/quote/page.tsx`, `app/e/[token]/`**

An estimate is published as a **snapshot** (`estimates.sent_snapshot`, built by
`buildCustomerDoc`). Both the customer's token page and the staff view render
*that* snapshot, so the two can never show different numbers.

Opening a saved estimate lands on the **ESTIMATE** view — the customer's copy,
read-only. Changing it is a deliberate act: **Edit estimate** switches to the
builder and shows a standing warning that saving republishes the customer's
copy. A brand-new estimate opens straight into the builder, because there is
nothing published yet.

The snapshot is held in component state and refreshed from the value written
during `save()`, so republishing updates the screen without a page reload.

This replaces the previous "staff see a live rebuild of current form state"
behaviour, which could disagree with what the customer was looking at and
breached the standard that token surfaces render snapshots, never live drafts.

**Since fixed:** `save()` used to write `estimates.status` directly instead of
going through a state-transition function (C3 in the audit) — R2b replaced that
with `send_estimate` and revoked the column. The pricing-in-component problem
was fixed in R1.

---

## Contractor portal, scheduling and onboarding

**2026-08-16 · `app/portal/`, `app/(app)/schedule/`, `app/(app)/contractors/`,
`lib/contractor/`, `lib/scheduling/`**

Contractor-facing surfaces (`/portal`, `/w/[token]`) render the work-order
snapshot only, with the customer's address and contact redacted **server-side**
until the contractor accepts the booking — not hidden with CSS.

Booking offers are a Postgres enum state machine (`offer_state`). Contractor
responses go through `respond_to_offer`; staff resolution through
`resolve_proposed_offer` / `cancel_booking`. Two rules are enforced in the
database rather than the UI: one live offer per job (partial unique index), and
24-hour expiry re-checked server-side on every response.

Compliance: `contractors.offerable` is computed by trigger and requires an
insurance document that exists in storage **and** has been verified by staff.
`offerable`, `tier`, `active` and the bank columns are withheld from client
writes by column privileges.

**Since fixed:** the staff scheduling board used to write
`work_orders`/`booking_offers` directly from the browser, with the offer amount
supplied by the client. R2 moved every booking transition into a transactional
RPC and R3 did the same for the work order; the client no longer sends an
amount at all.

---

## Internal wizard (Step 7, W1–W3)

**2026-08-18 · `app/wizard/`, `lib/wizard/`, `app/api/wizard/submit/`,
`app/api/estimates/[id]/wizard-edit/`, `lib/pricing/context.ts`**

The five-page wizard (`/wizard`, staff-gated, dark scoped `wizard.css` per the
approved mockup) collects ANSWERS into one zod-validated state object — never
a room, a quantity or a price. Page-1 uploads start the existing plan-reader
pipeline in the background (one read per page at upload time); the submit
route rebuilds the tree from the STORED readings (or, no-plan, from a starter
list synthesised through the same `buildDraft` stage 5 and downgraded to
`ai_assumed`), then `lib/wizard/merge.ts` applies the answers: page-2 ticks
filter surfaces, the condition tier sets coats, and the "mostly" door/window
styles resolve the reader's deferred openings ("not sure" stays deferred —
never guessed). The estimate lands as `source='wizard'` (migration 20260915;
graceful fallback with a staff-visible warning until it runs) with the full
wizard state snapshotted in `builder_state.wizard` for the editor's add-room
re-merge and the Step 8 customer layer.

The editor reprices EVERY edit server-side via `wizard-edit` (confirm height /
confirm room / add / remove) and shows the dollar-weighted accuracy score
(`lib/wizard/accuracy.ts`) over the provenance model. The shared `RoomCard`
is consumed, not forked. `lib/pricing/context.ts` now owns the
PricingContext/Adjustments assembly that previously lived inline in the
capture page and rooms route.

**Known gaps, recorded not faked:** plan↔card region-highlight sync needs room
outlines the extraction schema doesn't report; listing scrape still returns no
address/photos/m² (Step 8); exterior-only jobs create an empty estimate
carrying the site-check deferral until E2 wires the envelope drafting.

---

## Exterior envelope E2 (Step 6)

**2026-08-19 · `lib/extract/elevation.ts`, read-route fork, wizard submit,
`scripts/score-envelope.ts`**

The envelope now has eyes. `readElevationPhoto` reports cladding bands with
REFERENCE-BASED measurements only — door heads, counted brick/board courses,
storey lines, unit sizes injected from the `measurement_units` Settings table
— and `readSitePlan` reports footprint edges from printed dimensions or a
scale bar only. `mergeSitePlanWidths` fills photo-unmeasured widths from the
matching side's edge (the photo's own reference wins). `/api/extract/:runId/
read` forks on `page_class`, so elevation and site-plan runs get their own
readers instead of failing through the floorplan prompt. The wizard's submit
assembles the envelope, appends priced `Exterior` nodes via
`envelopeToAreaNodes` (now typed `DraftArea[]`), writes the reconciled
`exterior_envelopes` row and `requires_site_check` (best-effort), and defers
per segment. Proportion is never a basis: the rae276 smoke run correctly
priced NOTHING on a parapeted rendered terrace with no countable reference —
that job defers to a site check by design.

`scripts/score-envelope.ts` scores predicted wall m²/lineal m against the
exterior work-order truth (walls ±10% band); it lists jobs awaiting facade
photos. `score-regression.ts` now routes exterior-SHAPED work orders (cladding
items, no Ceiling — jobs 3000/3087 wore a "mixed" label) out of the interior
gate, which they had been polluting.

---

## Customer wizard — Step 8 (W4)

**2026-08-19 · `app/estimate/`, `app/wizard/CustomerResult.tsx`,
`lib/wizard/policy.ts`, `lib/supabase/service.ts` + `guards.ts`, all wizard
routes, migration 20260916**

The public wizard (`/estimate`) runs the same five-page flow plus an email
gate, in CUSTOMER mode. The architecture is deliberately narrow: a visitor
gets a Supabase ANONYMOUS auth identity but ZERO direct table access — every
read and write goes through the existing server routes, which switch to the
service-role client (`createServiceClient`, server-only) with explicit
ownership checks (`getWizardActor`; a customer touches only their own
`customer_intake` draft, 404 otherwise). The rate card is therefore never
readable from a customer's browser; RLS is unchanged.

`lib/wizard/policy.ts` (pure, Settings-driven) is the safety core, evaluated
server-side BEFORE any price is revealed, most severe first: asbestos +
lead-paint HARD STOPS (no price, ever), service-area postcode check,
commercial/heritage/body-corp HANDOFFS, the $2k floor, then a REVEAL as a
range whose width follows the accuracy band (≥90 ±4 / 70–89 ±8 / <70 ±15).
Acceptance is gated by the walkthrough policy and is impossible for any
`requires_site_check` job — every exterior signs off with a human (Tom's
rule). `customerPayload` strips margin, point price and internal labels;
adversarial tests (`lib/wizard/adversarial.test.ts` +
`scripts/adversarial-wizard.ts`) assert the leaks and bypasses fail safely.
Customer confirmations stamp `customer_stated` (accuracy credit 0.75) —
better than an assumption, always cross-checked in the staff review queue.
The route is OFF behind the `wizard_public` setting until Step 10's launch;
staff preview anytime.

---

## Proving window — Step 9 enablement

**2026-08-19 · `app/(app)/proving/`, `lib/wizard/proving.ts`, submit snapshot**

The proving window (Step 9) is Tom's calendar work — real enquiries through
the wizard — but its exit condition (median staff correction < $150, on a
real sample) needs measuring. Each wizard submit now freezes its first-guess
numbers into `builder_state.wizard.snapshot` (total, accuracy, outcome).
`lib/wizard/proving.ts` (pure) reprices the live estimate and measures the
correction against that baseline; `/proving` (staff nav) shows it per
estimate and in aggregate with the gate verdict. "Is the wizard accurate
enough to switch on?" is now a number, not a feeling — and it's the same
`wizard_public` flag Step 10 flips once the gate holds.

---

## Builder/settings/chat batch (Aug 2026 — Tom's 8-point list)

**Wizard paint page** asks colours-vs-advice after a brand is picked
(`paint.colourHelp`). **Line items** carry a `subcontractorExpense` flag
(carpentry/scaffolding via a 3rd party) — admin invoiced-vs-paid
reconciliation is still to build. **The builder** opens on the builder view,
not the customer view; the **quote name auto-fills** from the first line of
the job address. **Status** is a clickable pill → `set_estimate_status` RPC
(migration 20260917, server-owned column, accepted stays locked); declining
prompts for and stores `declined_reason`.

**Settings**: EditableTable + LineItemsManager save by SECTION (dirty-tracked,
one button); substrates group under their Folder (`sub_category`); the
substrate paint field is a dropdown of products; a secondary
`company_profile.logoUrlLight` is used on the email + quote PDF.

**Estimate chat** (migration 20260918, `estimate_messages` + anon token RPCs):
two-way thread on an estimate. A staff reply (`replyToEstimateChatAction`)
notifies the customer by SMS and email, both linking to `/e/{token}#chat`,
which auto-opens the customer chat. Redesigned bubble UI both sides;
best-effort delivery logged to `estimate_events`, never blocking the message.

**Substrate registry (A2)**: `lib/estimate/substrates.ts` is the ONE source
of the "what's being painted" lists. Each substrate (walls, weatherboards,
fence…) maps to its `rate_items` codes; the Interior/Exterior split is read
from `rate_items.category` at load (`substrateOptionsFromRates`), so the rate
card stays the authority and a substrate with no rate (Brick pre-20260919) is
simply not offered. Wizard pages load the options server-side and pass names
only; page 2 renders Interior, Exterior, or both as grouped sections by job
type, with per-type default ticks (`defaultSurfacesFor`). The exterior
scaffold + envelope lines are filtered by the same ticks
(`filterSurfacesByTicks`), and ticked extras (deck/fence/pergola/garage
doors/balustrade) always arrive as $0 measure-on-site placeholders
(`exteriorExtrasNodes`).

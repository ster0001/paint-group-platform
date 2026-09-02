# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

---

## Tom's 23 Aug batch: settings that save, optimistic deletes, a phone nav, balustrades, allowances

**2026-08-23 · `lib/settings/numeric.ts`, `app/(app)/settings/PricingSettings.tsx`,
`app/(app)/estimates/`, `app/(app)/AppSidebar.tsx`, `lib/estimate/substrates.ts`,
`lib/capture/commit.ts`, `app/api/estimates/[id]/rooms/route.ts`**

**Settings could not be saved at all.** "Pricing & job numbers" took every row
that wasn't one of six named keys — including whole configuration objects
(`wizard_policy`, `wo_loop`, `service_area`) — coerced each with `Number()`, and
got `NaN`. `NaN` serialises to JSON `null`, `settings.value` is NOT NULL, and one
bad value fails the whole upsert. `lib/settings/numeric.ts` now decides by SHAPE
rather than by a list of keys to exclude, so a key added tomorrow is handled
without anyone remembering the folder exists; and a save writes the
`{unit, notes, value}` envelope back whole instead of flattening a lever to a
bare number. Had the old save ever succeeded it would have wiped the units and
notes off every row and replaced the config objects with integers.

**Deletes are optimistic.** The row leaves the list on confirm and the server
action finishes behind it; a row only returns if the database actually refused
it, and then it returns with the reason. The single button no longer deletes —
it asks, and hands the id to the table, which owns the list.

**The staff sidebar is a drawer on a phone.** 224px of a 390px screen left
almost nothing for the page. Off-canvas behind a menu button under `md`, with
the logo and the current page's name in a bar across the top.

**Balustrades are one tick on both sides.** The card files the interior run
under `Balustrades` and the exterior one under `Hand Rails`, so the substrate —
which knew only the exterior code — was invisible indoors and went by a name
nobody searches for outdoors. One key, both codes, one label ("Balustrades &
hand rails"), and it joins the always-offered tiles so it is in the grid rather
than buried in the add panel. Allowances are now excluded from the customer's
add panel: an allowance is an estimator's judgement in hours.

**Plastering and raw timber: hours and a note, on the capture screen.**
`ALLOWANCE_DEFS` in `lib/capture/commit.ts` is one mechanism with two members.
The hours ride `prepHr`, NOT a quantity — pricing charges prep hours at the
charge-out rate whether or not the code matches a rate-card row, so they price
correctly with no new rate rows and no migration to wait on, and can never be
knocked out by a rate row drifting off "one hour per unit". Raw timber stamps
`RAW TIMBER — seal before topcoats.` on the crew note whether or not hours are
added, because the tag is the point. **The e2e caught a real bug here**: the
rooms route's zod schema strips what it does not name, so the allowances reached
the server and were silently dropped — the "compiles and unit-tests" version of
this feature would have shipped doing nothing.

---

## Projects console: the schedule moves in, and site photos finally get read

**2026-08-22 · `app/pc/schedule/` (was `app/(app)/schedule/`), `app/pc/PcNav.tsx`,
`lib/workorder/photos.ts`, `app/components/wo/PhotoGrid.tsx`,
`supabase/migrations/20261024000000`**

Four changes, one theme: the office screens now show what the job actually is.

**Scheduling is a step in the workflow, not a separate app.** The board moved
under `/pc/schedule` and became the FIRST tab of the console, which the sidebar
now calls **Projects** rather than "Live jobs"; the standalone Schedule sidebar
entry is gone and `/schedule` permanently redirects. The tab rail became a client
component (`PcNav`) so the current tab can light up — the `.on` style was already
in the stylesheet with nothing setting it. `schedule.css` widens the console
shell only on a page that actually contains a board (`:has(> .sb)`), so the rest
of the console keeps its 1060px measure.

**The lane column pins.** `.cinfo` (and the two header cells above it) are
`position: sticky; left: 0` inside the timeline scroller, with the `.tl` left
padding removed — a gutter there is a strip the pinned names do NOT cover, and
blocks scrolled through it and read as debris. The day header now stacks the
weekday over the date at every zoom level instead of dropping the name below
44px per day.

**The job sheet reads the ticks, not the frozen copy of the scope.**
`wo_snapshot` carries a `status` per surface, written once at issue and never
again, so every job sheet said "Not started" over work the painter finished.
`WorkOrderDoc` now takes a `ticks` map keyed by the document's own surface key
(`lib/workorder/surfaces.ts` → `ticksBySurfaceKey`): the builder's Work order tab
gets it from `wo_surfaces` in the page query, and `/w/[token]` — anon, so RLS
rightly refuses it the table — gets it from the new security-definer
`get_work_order_ticks_by_token`, degrading to the frozen statuses if the
migration has not been applied yet.

**Site photos exist on screen.** `wo_photos` rows had been written since the loop
shipped and read by exactly one query ("has this elevation got a before
photo?"). `lib/workorder/photos.ts` is the read side — one place that signs a
batch of paths into the private bucket, shapes and groups them, and drops a row
whose object has gone missing rather than rendering a broken tile.
`PhotoGrid` renders them with no hooks, so the same component serves the Server
Components and the builder's client tree. They now appear on the console job
screen (grouped by kind, and again under the variation each one justifies), on
the job sheet, and as a "Latest from site" strip on the Projects dashboard.

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
**Plan uploads (A3)**: files stage straight to storage via signed URLs
(`POST /api/extract/upload-url` → `incoming/{userId}/…`, ownership-checked by
`lib/uploads/incoming.ts`), then `/api/extract/floorplan` ingests the staged
paths as JSON — the serverless multipart path (still supported for small
files) hit the platform's ~4.5 MB body cap and failed silently. Magic-byte
validation runs on the staged bytes as before. HEIC converts to JPEG at
ingest (`lib/extract/heic.ts`, heic-convert WASM) with the original kept;
the wizard pre-validates client-side (`checkUpload`), shows per-file
progress, and background read failures surface as a visible note instead of
being swallowed.

**Damage photos → prep lines (A7)**: the pipeline was broken in three places
that were each silent. The defect reader now gets a damage-purpose prompt
(`readPropertyPhoto(bytes, "damage")` — the generic doors/windows ask framed
"no defects" as the expected answer); each matched defect becomes ITS OWN
"Prep — …" surface line with hours (`lib/extract/draft.ts`, previously folded
invisibly into walls.prepHr); a defect with no `defect_prep_rates` row raises
an amber "needs pricing" deferral instead of being dropped. The photos route
accepts staged signed-URL uploads (same A3 staging), skips bad files per-file
instead of aborting the batch, converts HEIC, tags damage evidence
`kind: "defect_photo"`, and the submit route claims photo sources onto the
estimate. The wizard shows "ANALYSING THE DAMAGE PHOTOS…" during the read and
surfaces per-photo failures as warnings. `npm run seed:extraction` seeds the
rates table.
**Capture opens any estimate (A5)**: capture is a view over the area tree
regardless of author. Provenance is derived (`room_loop` / `assisted` for
AI-drafted or customer-stated / `builder`), every room card opens, and a
recommit merges instead of replaces (`lib/capture/recommit.ts`): builder-only
detail (products, colours, photos, rate overrides) carries onto matched
surfaces, absolute overrides survive only when the surface was untouched, and
lines no tile can express are preserved verbatim. Wizard exterior nodes'
`roomType "exterior"` aliases to capture's `exterior_elevation`; the server
derives Interior/Exterior from the node, not the client's vocab toggle. Null
`storey_heights` pre-fills the confirm prompt from the blocks themselves
(`storeyHeightsFromBlocks`) so a double-storey wizard job keeps both storeys;
recommitted rooms prune their own aiDeferred entries. Parity is tested:
an untouched wizard room prices identically after a capture round-trip.
**Fast removals (A4)**: profiled with the two kept specs
(`e2e/perf-removals.spec.ts`, `e2e/perf-wizard-editor.spec.ts`). The /quote
builder was already fast (32–49 ms, zero network per removal — pricing is
client-side, save is manual). The real cost was the wizard editor: every
action awaited the full `wizard-edit` round trip (~820 ms dev) before the row
disappeared, serially. The editor now renders a DERIVED payload — the last
authoritative server response with pending optimistic transforms re-applied —
so removals vanish instantly (33–45 ms measured), requests queue strictly
serially in the background (the server never races itself on builder_state),
failures drop their transform (the row returns) with a message, and the
route loads its pricing context in parallel with the mutation (~200 ms off
every action). No refetching anywhere: the action's response IS the payload.
**Window sizes (A6)**: window surface rows carry `size` (small/medium/large,
absent = medium = unchanged pricing — goldens hold). `lib/pricing`
(`windowSizeMultiplier`) applies it as a multiplier on the window rate's
hours, tunable via settings "Window size — small" (0.8) / "Window size —
large" (1.2), surfaced in Settings → Pricing & job numbers. Builder rows and
the capture review screen get compact S/M/L controls (capture's placeholder
hours apply the same multiplier for parity); the rooms route accepts a
bounded `sizes` map. The wizard always writes medium. The model is ONE
window rate × size — legacy separate small/large window rate items keep
pricing as-is and are flagged superseded in Settings.
**Address autofill (A1)**: wizard page 1's first field autocompletes AU
addresses via server-proxied Places (New) routes — `/api/places/autocomplete`
+ `/api/places/details`, key in server-only `GOOGLE_MAPS_API_KEY`, Melbourne
location bias, session-token billing. Picking a suggestion names the estimate
("street, suburb"), stores the structured address in wizard state
(`state.address`) → `builder_state.jobAddress` at submit, and for customers
fills suburb/postcode and runs the service-area check immediately (the
details route evaluates the same `service_area` setting as the policy
engine; out-of-area shows the polite message before any other question).
`AddressField` degrades to a plain input on the first failed lookup — no
key, no problem.

**Customer scope editor — B1, interior + shared** (`/estimate/scope?id=…`,
per `design/reference/customer-scope-editor-mockup.html`): customers get
full control of WHAT is painted and none of hours/rates/allowances,
enforced at the wizard-edit route's action whitelist — the only
customer-reachable mutations are `toggle_surface`, `set_count` (1–12),
`rename_room`, `add_note` (→ amber estimator deferral, never silently
priced), `flag_geometry` (→ requires_site_check + deferral) plus the
existing add/remove room. Pure logic in `lib/wizard/scope-editor.ts`
(tiles derived from room_type_scope_rules + the A2 substrate registry;
toggles add lines at the wizard-answered style as customer_stated with
assumed ["style"]; tested that no hour/rate/cent ever serialises).
Responses return `customerPayload` (ranges only) + rebuilt `scopeRooms`.
UI matches the mockup: tile grids + steppers, "More surfaces…",
skirting pairing advice (Keep/Leave), per-room notes, delta toasts +
live range flash (Settings `scope_editor.liveRange`, default ON ⚑),
sign-off ladder framing from the policy decision. Telemetry:
`estimate_events` type `scope_edit`. Entry: "Open the editor" on the
customer result screen. STILL TO COME (B2): exterior element-first view,
real accept + visit booking with prep pack, capture verify-mode handoff.

**Customer scope editor — B2, exterior + ladder**: exterior renders
element-first (Body with Whole house / Front only / Front + sides — extent
parks out-of-scope elevations as `isOption`, outside the total, reversible;
Trims & openings; Roofline pre-ticked with the note; Extras off by default,
fence takes metres via `measureL` or "not sure" → amber). Exterior toggles
apply across every elevation (`applyExteriorToggle`); geometry chips are
read-only with "Not right? Tell us" → flag. The sign-off ladder is
Settings-driven (`scope_editor`: selfServeInteriorCapCents $6k ⚑,
selfServeExteriorCapCents $12k ⚑, selfServeMinAccuracy 90, visitSlots):
self-serve → `accept_intent` (event + desk-check deferral); visit tier →
`book_visit` with server-validated slots (`offeredVisitSlots`), which writes
the PREP PACK into builder_state (kind, slot, customer-removed substrates
from telemetry, flags/not-sures) and capture shows it as the verify-mode
banner — rooms pre-filled (A5), confirm-as-you-walk flips provenance to
human_confirmed (capture's commit semantics).

## Wizard rebuild R0–R4 (19–20 Aug 2026)

The customer estimate flow was rebuilt to the four reference mockups
(`design/reference/`: floorplan-wizard, customer-review-confirm interior,
customer-review-confirm-exterior-v2-SIDES, scope-editor workflow), per
`docs/briefs/wizard-rebuild-plan-v2.md` + the confirm-loop addendum.
R1.1: wizard-edit's payload follows an explicit `view=customer|staff`
(never the caller's role) — `lib/wizard/contract.ts` throws in dev on a
wrong shape. R1.2: unsure door/window styles price at default rates
(ai_assumed, amber "style to confirm"), never a silent $0. R1.3: one
floorplan (replace-not-add), condition photos never require a plan
(run-less `/api/extract/photos` keeps them), exterior has no floorplan
field. R1.4: ONE confidence function (`accuracy.ts:roomConfidencePct`)
feeds header, cards and bands; unverified trees cap at 65%. R2: pure
exterior branches at job type into its own five pages (state.exterior →
`exteriorSurfaceKeys`). R2b: the exterior editor is a BY-SIDES confirm
loop (`lib/wizard/sides.ts`, meta in builder_state.sidesLoop) — wall
%-mix with a served 100% rule, window groups with S/M/L bands, skipped
sides = isOption (outside totals AND accuracy). R3: the interior editor is
a room-by-room confirm loop (`lib/wizard/rooms-loop.ts`, meta in
builder_state.interiorLoop) — L×W size questions, cupboard questions by
room type (cabinetry rate items, migration 20260920), custom surfaces as
unpriced amber flags that route to the visit tier. R4: the v2 sign-off
ladder in `policy.ts` (interior ≤$6k @≥90 / straightforward exterior
≤$12k @≥85, $15k rule deleted, all Settings values); QuoteBuilder saves
now SPREAD loaded builder_state (the fixed key list silently dropped
wizard/prepPack/loop state). The journey suite `e2e/customer-journey/`
drives all of it as the definition of done.

## Work-order completion loop — step 1: the seven-stage machine (2026-08-21)

WO v1's `status` (draft | issued | in_progress | complete) is now DERIVED, never
typed. `work_orders.stage` (`wo_stage`: offered → pre_start → in_progress → qa →
completion_prep → walkthrough → closed) is the single source of truth for the
loop, and `public.wo_derive_status(stage, issued_at)` recomputes `status` inside
every transition so the contractor link, the schedule board and the v1 chips keep
working with nothing rewritten. The legal moves live in a TABLE,
`wo_stage_transitions` (from, to, label, actors), because the RPC, the UI and the
tests all need to agree about them; `lib/workorder/stages.ts` mirrors it for the
browser and `stages.test.ts` parses the migration and diffs the two, so the
mirror cannot drift silently. Ten moves are legal, the other 39 pairs are not,
and both failure paths (QA fail, walkthrough flag) return to `in_progress` — one
tick list, always.

Every change of stage goes through `wo_set_stage`, which validates the move,
writes a `wo_events` row and re-derives `status` in one transaction; the public
`wo_advance_stage` RPC works out whether the caller is staff, the assigned
contractor or the job's customer **from the session** and checks that actor
against the transition's `actors` — `'system'` is not reachable from outside.
`wo_gate_blocked()` is the hook each later step fills with its own readiness gate
(all surfaces ticked, QA passed, pack delivered); today it is deliberately open.
A trigger on `booking_offers.state` keeps the stage honest when a booking is
accepted, cancelled, declined, expired or withdrawn, rather than reopening three
working scheduling functions. Client UPDATE on `stage`/`stage_entered_at`/
`blocked_reason` is revoked at the database.

Migration 20260927 creates the rest of the loop's tables — `wo_checklist_items`,
`wo_surfaces`, `wo_photos`, `wo_variations`, `wo_updates`, `wo_qa_checks`,
`wo_signoff` — each RLS'd three ways (staff all, contractor assigned-only,
customer own-job-only) and write-revoked for every client role, plus the private
`wo-photos` bucket. Surfaces carry no history columns: tick history is
`wo_events` rows, because the report and the console already read that log.
20260928 lands the ⚑ business decisions in `settings.wo_loop` — including the two
sign-off switches, `clockEnabled: true` (the clock and nudge ladder may run) and
`deemedEnabled: FALSE` (deemed execution waits on the ACL/UCT legal review), a
deliberate departure from the brief's default.

## WO loop — step 2: surfaces, ticks and the photo gate (2026-08-21)

The tick list is an INDEX into the work-order document, not a second copy of the
scope: `wo_surfaces` holds one row per surface, seeded by `wo_seed_surfaces` from
the document the builder already computes (`lib/workorder/surfaces.ts`
`seedRowsFromDoc`), carrying labels and headings only — no money, no
measurements it could contradict. Seeding runs on issue and is idempotent:
re-issuing refreshes wording and order but never resets state, so it cannot wipe
a day's ticks off a painter's phone. Heading meta is derived from what the
document actually knows ("3 surfaces · 2 coats · PG-3") rather than the mockup's
measurements, which live in the estimate's sides loop and aren't in the frozen
snapshot; `seedRowsFromDoc` takes a `metaFor` hook for when they are.

`wo_tick_surface` is the only way a surface moves. It establishes the actor from
the session, refuses a job that isn't in `in_progress`, and enforces the
before-photo rule: **the first tick on an elevation is refused unless that
elevation has a `before` photo** (`error:before_photo_required:<heading>`). The
UI prompts for the photo ahead of the tap so a painter meets the rule as an
instruction, but the rule is server-side and a direct RPC call hits it — proven
in `e2e/wo-ticks.spec.ts`, which calls the RPC outside the browser. Ticks move
in any direction because a mis-tap on a phone needs an undo, and every move
writes a `wo_events` row of type `surface_tick` with `{from, to, heading}` — the
same log the console, the daily update and the completion report read.

Photos take the remediated two-stage path (`app/api/wo/photos`): POST signs an
upload into the private `wo-photos` bucket, the phone PUTs the bytes, PUT
ingests — reading the signature from the STAGED BYTES, because a signed URL is
permission to store bytes and never a statement of what they are. A file that
fails the sniff is deleted rather than left as an orphan.

Step 2 also fills its arm of `wo_gate_blocked`: leaving `in_progress` now
requires every surface `done`, reported as "N of M surfaces still to tick off".
A job with no tick list at all is deliberately exempt, so work orders issued
before this step aren't stranded behind a gate they cannot pass.

## WO loop — step 3: variations, both-sided (2026-08-21)

`wo_variations` carries one variation from raise to accepted, and the order is
enforced by the database. `wo_raise_variation` refuses without photos
(`error:photos_required`) — evidence is what stops a variation becoming an
argument later. `wo_price_variation` is staff-only and takes the customer price
from `app/quote/variationActions.ts`, which computes it on the server through
`lib/pricing`'s `chargeOutCents` (hours × the active card's charge-out for the
trade, plus any materials figure staff enter). The engine's inputs are stored in
`priced_inputs` beside its output so any figure can be recomputed later.

**The contractor's side is computed in SQL and cannot be supplied by a caller**:
`round(hours × wo_contractor_rate_cents())`, reading the `Contractor rate`
setting, with the rate stamped onto the row so an approved variation cannot
silently reprice. Change the rate in Settings and the next variation follows it.

Nothing reaches `contractor_accepted` without both approvals recorded, in order:
`wo_customer_respond_variation` (token-only, like the quote) writes
`customer_responded_at`, `wo_release_variation` is the PC's human step between
the two money events (⚑2, `variationRelease` defaults to `pc`, `auto` skips it),
and the accept refuses with `customer_not_approved` or `not_released` otherwise.
Declined variations are kept, never deleted — they belong on the completion
report as raised-and-declined. The customer surface is `/v/[token]`: unknown
token → 404, and the contractor's rate and delta are absent from the HTML, not
hidden.

Photos live in the private `wo-photos` bucket at `wo/<work_order_id>/<file>`,
and `20261003` gives `storage.objects` the policies that path implies — staff,
the assigned contractor, or the job's own customer. Without them the bucket
existed but every upload failed at the signed-URL step; the lesson is that
creating a bucket in a migration is only half of it.

Step 3 also extends `wo_gate_blocked`: no forward stage move while a variation
is `raised`, `priced` or `customer_approved`. The surfaces gate answers first.

## WO loop — step 4: drafted updates and the silent site (2026-08-21)

`lib/workorder/updates.ts` composes the day's customer update from `wo_events`
rows of type `surface_tick` — grouped by elevation, latest state per surface
winning, in plain English rather than Australian ("we have prepped the left-hand
side", not "knocked that over"). It is a pure function taking `now`, so the
greeting is testable. **No ticks means no draft**: it returns null rather than
writing filler, and the console gets a flag instead.

Storage and the gates are `20261004`: `wo_draft_update` (staff or the service-key
sweep), `wo_approve_update` (staff; the edit and the approval are one action, so
there is no edited-but-unapproved window), `wo_send_update` (refuses anything not
already approved). `source_tick_ids` is stored with the draft so any sentence
traces to the events behind it, and a later sweep never rewrites an update a
person has approved. Delivery itself is a later phase — this records that it went.

`wo_zero_tick_sweep()` flags a job that is `in_progress`, whose start date has
arrived, and which logged no tick yesterday or today: one `zero_tick_flag` event
per job per day plus a `blocked_reason`, and a trigger clears the reason on the
next tick. It never messages the customer — a silent site is a phone call.

`app/api/cron/wo-sweep` is the first scheduled endpoint in the codebase. It is
guarded by `Authorization: Bearer $CRON_SECRET` and refuses everything when the
secret is unset rather than falling back to running unauthenticated, because it
writes. `vercel.json` schedules it at 08:00 UTC = 6pm Melbourne, end of the
working day. Composition happens in the route (TypeScript), storage in the RPC —
the same split the rest of the money/state boundary uses. **CRON_SECRET must be
set in the Vercel project env for the schedule to do anything in production.**

## WO loop — step 5: QA, prep, walkthrough and sign-off (2026-08-21)

QA checks are auto-scheduled only for contractors inside their first N finished
jobs (⚑1). `wo_record_qa` records pass/fail; a **fail appends rectification rows
to `wo_surfaces` and returns the job to `in_progress`** — the same tick list, with
`rectification = true` the only thing marking them out. Photo minimums (⚑5) set
`thin_record` and never block a pass. The completion-prep checklist is seeded per
Settings (the rubbish line changes with `rubbish.organisedBy`) and gates
`completion_prep → walkthrough`.

The customer surface is `/s/[token]`: area-by-area approve or flag, then
type-to-sign. A flag becomes a rectification row and sends the job back, and —
found by the e2e — **a flagged area must be re-reviewable**, or a job can never
close after being put right. Views are recorded because a viewed-but-silent pack
is what makes a deemed sign-off defensible later.

`wo_sign` is one transaction: warranty (2 years from the sign-off date, ⚑4,
deemed included), the review-request `follow_ups` row, the completion report
built from `wo_events`/surfaces/photos/variations/QA — **declined variations
included** — and the draft invoice stub for the invoicing phase.

The clock is split into two switches per Tom's ruling: `clockEnabled` (on) runs
the 0/24/48h ladder, `deemedEnabled` (**off**, pending ACL/UCT review) would
execute the sign-off. **`wo_nudge_copy(rung, deemed_enabled)` is where the
compliance lives** — while deemed is off the copy must not mention deemed
signing, automatic sign-off, invoices or payment, and `signoff.test.ts` asserts
exactly that. Each rung fires at most once; a late sweep sends one late nudge,
never the whole ladder. An unanswered extension request pauses the clock.

## WO loop — step 6: the PC Command console (2026-08-21)

`/pc` is the approved mockup as real routes — Command, The flow, Updates, and a
work-order view — staff-gated in the layout (a contractor is redirected to
`/portal`). `lib/workorder/console.ts` holds the logic as pure functions:
`buildQueue` turns rows into the §6.1 cards, `rankQueue` orders them
critical→warning→info and oldest-first inside each, `pulseTiles` counts **from
the queue it was given** so a tile can never disagree with the cards below it,
and `headline` is written from those same counts. `consoleData.ts` loads it in a
fixed set of parallel queries — never one per card.

Two date bugs were caught by the TZ-pinned suite and are worth keeping in mind
for anything else that buckets by day: `toISOString().slice(0,10)` is the **UTC**
date, so before 10am Melbourne it silently reports yesterday — `melbourneDate()`
is the fix, and `melbourneDayStartUtc()` derives the day's start from the zone
rather than a hardcoded `+10:00`, which would be an hour out from October to
April. The cron sweep now uses both.

The console is also where the PC surfaces deferred from steps 3–5 landed:
pricing a variation (hours in, money worked out on the server — `lib/pricing`
for the customer's side, SQL for the contractor's), releasing the adjusted
offer, and reviewing/editing/sending a drafted update.

**A grant, not a policy, was the bug worth remembering** (`20261007`): with a
`zero_tick_flag` row present and `is_staff()` true, a staff session read zero
rows from `wo_events`. RLS was never involved — a policy only filters rows a
role may already select, and the table-level `GRANT SELECT` was missing, so the
console rendered "nothing needs you" over a database that had something to say.
Every table this module adds now states its read access outright rather than
relying on the project's default privileges.

## WO loop — step 7: hardening, and what the full story found (2026-08-21)

`e2e/wo-full-loop.spec.ts` runs one job all the way round in every role that
touches it — offer accepted (through `send_offer`, which is what puts the
contractor on the work order), pre-start, ticks gated on before-photos, a
variation through both approvals, the day's update drafted by the cron sweep and
sent by a person, a QA fail and its rectification, QA pass, the prep checklist
gate, the customer flagging an area, the fix, and the signature. It then asserts
the downstream artefacts exist and that **every stage the job passed through is
reconstructable from `wo_events` alone**, both loops back into `in_progress`
included.

`lib/workorder/boundary.test.ts` is the brief's §7.6 grep audit as a test, since
a grep somebody has to remember is a grep that stops being run: no client write
to a money or status column on a loop table, no hard-coded contractor rate
outside the engine, no hours×rate arithmetic outside `lib/pricing`, no service
key in a client component, and none of the date traps above. It **strips
comments before matching and matches within a statement rather than a file** —
its first version flagged three files, and all three were the prose explaining
the rule.

Known and unchanged from before this phase: `estimates.subtotal_cents` /
`total_cents` are still written from the builder client. That predates the loop
and is on the audit list; the loop's own tables are all RPC-only.

## Booking → work order: the calendar comes first (2026-08-22)

`send_offer` used to write only `contractor_id`; the dates lived on
`booking_offers` and reached the work order when `respond_to_offer` copied
`start_date` across on acceptance. So a job the office had scheduled showed no
dates on its own work order, and `work_orders` had no `end_date` column at all.

`20261011` adds `end_date` and moves the booking→work-order glue into
`wo_stage_follows_offer`, which now fires **on INSERT as well as UPDATE**:
offering a job puts its requested dates on the work order immediately, and
releasing the last live offer clears them. The four booking functions are
untouched — they work, and reconstructing one from memory is how `send_offer`
lost its compliance check.

**Requested vs confirmed is derived, not stored.** `wo_booking(work_order_id)`
reads the live offer's state; a second column would be a second thing to keep
true. `lib/workorder/booking.ts` turns it into words and a tone — amber while it
waits on the contractor, emerald once accepted — and the work-order header says
which it is rather than showing a bare date.

The contractor's calendar opens the job when a booked day is tapped, and a job's
span now comes from the booking's real `end_date` instead of a `hours ÷ 8` guess.

**Known limitation, surfaced by a test collision:** the contractor calendar keys
jobs by date (`Map<date, job>`), so when two jobs fall on the same day only the
last one is shown and tapping it opens that one. Fine while a contractor runs
one job at a time; it needs a real answer before they run two.

## Stages 1–4 completed against the lifecycle mockup (2026-08-22)

`design/reference/work-order-lifecycle-mockup.html` defines each stage **by
lane**, and three stages had machinery but no face. Now built:

**Pre-offer / pre-start checklists** (`20261012`–`20261014`). Labels and
captions are the mockup's, not paraphrased. Colours and QA are DERIVED, not
ticked — colours read the builder's per-product chips, QA reads whether checks
are scheduled — because a checkbox that can disagree with the data is a lie
waiting to happen; those rows say `auto` and explain where to change them.
Colours block "Materials ordered" per the mockup, and gate the START, never the
offer ("the contractor accepts with the TBC chip visible").

Two bugs worth remembering came out of it. The seeder was staff-gated, so the
SQL editor's own backfill was refused silently AND a **contractor accepting an
offer** — which moves the stage under their session — never got the pre-start
list on the job they had just taken. Seeding is machinery, not a privilege; the
guard is gone. And `wo_colours_confirmed()` answered false for a job whose
document listed no materials, which would have stranded it at pre-start for
ever; with nothing to confirm the step is vacuously done.

**Completion prep** moved to the contractor's lane, where the mockup puts it —
the person who did the work is the one who can say the site is clean.

**QA standards** (`20261015`–`20261016`) are tickable lines, seeded per check by
a trigger: cut lines, coverage, prep evidence, site. A PASS is refused until
every one is ticked (`standards_outstanding:N`); a FAIL is not, because its job
is to record what was wrong and put rectification on the painter's own list.

**Deliberately not built:** the closed/completion-report view. The report is
generated and stored at sign-off, but rendering it staff-only would be half a
feature — it ships with the customer portal, where the customer gets it beside
their warranty and job history.

## Reoffer, job kind, and staff-side ticking (2026-08-22)

**Reoffer** (`20261018`) is one transaction: withdraw the lapsed offer, write an
`offer_lapsed` event for the contractor whose it was, then create the next offer
by **calling `send_offer`** rather than reimplementing it — `send_offer` carries
the compliance check that a contractor without current insurance cannot be
offered work, and the reoffer path is the worst place to lose it. If it refuses,
the whole thing rolls back, so a job can never be left with the old offer
withdrawn and no new one. The courteous wording lives in the migration so its
tone has one home, and the spec asserts it carries no blame words.

**job_kind** (`20261017`) — `residential | commercial | body_corporate` on
estimates, with its own column-level UPDATE grant (R2 granted `estimates` UPDATE
column-by-column, so a later column is silently unsavable without one). SWMS
becomes a required pre-start item for commercial and body corporate, and the
`required` flag is reconciled on every seed so changing a job's kind after the
checklist exists updates it.

**Staff tick the same list as the painter.** `TickList` moved to
`app/components/wo/` and takes a `surface` prop switching class names only —
never a forked copy. The console renders it interactive while a job is in
progress, read-only at other stages, and the office meets the same before-photo
gate the painter does.

## Moving a job forward, and starting on time (2026-08-22)

**The control did not exist.** The stage machine, its gates, `wo_advance_stage`
and its server action were all built and tested, and nothing in the UI called
them — a job could reach pre-start and stop there for ever. Every e2e drove the
RPC directly as staff, so the whole suite passed while the button was missing.
*A test that calls the API cannot tell you a screen is unreachable.*

`app/pc/wo/[id]/StageAdvance.tsx` is that control. Its buttons come from the
transition table, so the console can never offer a move the database would call
illegal — only not-yet-ready, which it reports in the gate's own words. Forward
moves only; going back is a QA fail or a customer's flag, which are their own
actions. Prep → walkthrough routes through `wo_deliver_evidence_pack`, because
delivering the pack is what mints the customer's link and starts their clock.

**Starting on time** (`20261019`): `system` may make the `pre_start →
in_progress` move, and `wo_autostart_sweep()` — run from the 6pm cron — starts
every job whose date has come and whose list is true. The gate still decides.
`wo_start_now()` covers "they got on site today" and **moves the start date with
it**, so the silent-site catch is not measuring against a date that is no longer
true. The console asks before starting early, naming the booked date.

The transition table is re-seeded canonically in `20261019`, and
`stages.test.ts` diffs the mirror against that file — one list, still.

## Invoicing Step 1 — the job money ledger (24 Aug 2026)

Each job now has a **ledger**, and one function owns its arithmetic:
`public.invoice_ledger` in SQL (the runtime authority inside transactions)
and `lib/invoicing/ledger.ts` in TypeScript (the golden-tested twin; a
contract test pins the two to the same rule). Adjusted contract = the
accepted snapshot total (frozen into `estimates.accepted_total_cents` at
acceptance) plus approved variations, minus approved credits. Invoices are
the only "payment request" concept — deposit / progress / final / variation /
standalone are all rows in `invoices` with a `kind`. The §3.2 state machine
(draft → issued → sent → viewed → partially_paid → paid, with void and
written_off off the issued+ states) is a seeded matrix table enforced by a
BEFORE UPDATE trigger for every writer, so an issued invoice is immutable at
the database: money edits raise, only drafts delete, the PDF path writes
once, and a variation can appear on at most one non-void invoice (partial
unique index — double-billing is a constraint violation). GST has one
rounding rule (⚑14) in `lib/invoicing/gst.ts` mirrored by SQL twins:
line-built invoices sum ex-GST lines and compute GST once; ledger-anchored
invoices (deposit/progress/final) carry the promised inc figure and split it.
`accept_estimate` drafts the deposit invoice in its own transaction;
`wo_sign` / `wo_close_without_walkthrough` draft the final invoice
(replacing the old $0 stub) via `invoice_draft_final`, which seeds lines
from the snapshot by source refs. All mutations are SECURITY DEFINER RPCs
(`invoice_issue/send/mark_viewed/record_payment/void/write_off/extend_due/
delete_draft/request_payment/create_final`); direct client writes to
`invoices`/`payments` are revoked. `overdue` is derived, never stored.
Migrations `20261111` (enum, alone) + `20261112` (core); Tom's script:
`docs/manual-tests/invoicing-step1.md`.

## Invoicing Step 2 — the three money screens (24 Aug 2026)

`/invoicing` is the business-wide dashboard, `/invoicing/job/[estimateId]` one
job's ledger, `/invoicing/inv/[id]` one document — three altitudes over the
same `lib/invoicing` functions and `invoice_events`, never a second store.
`lib/invoicing/derive.ts` owns every screen figure (tiles, aged buckets, stage
rail, ages) and is golden-tested against the dashboard mockup's own numbers;
components only format. The §7.3 editor round-trips every edit through the
20261113 RPCs (line edits recompute totals server-side; deposits amend by
inc-anchored re-split) and the reconciliation banner makes silent drift
impossible: the server-computed drift either becomes a recorded one-off
adjustment event or a staff-override variation on the existing wo_variations
machinery, which moves the adjusted contract so the document reconciles. The
PC console links in (nav tab + per-job "Money view →"), and
`e2e/invoicing.spec.ts` walks accept → deposit → issue → pay in a real
browser as staff, including the database-level immutability proof.

## Invoicing Step 2 — the three money screens (24 Aug 2026)

The §7 surfaces are live at three altitudes over one ledger: `/invoicing`
(the business-wide dashboard — pulse tiles, filterable receivable rows with
payment-stage dots, aged buckets, cross-job activity feed; filters are query
params), `/invoicing/job/[estimateId]` (one job's money view — stage rail,
money strip, Payments/Invoices/Costs tabs, the request-payment sheet and
invoice-in-full), and `/invoicing/inv/[id]` (the document editor — the
editor IS the customer-facing document; drafts edit through server
round-trips, the amber reconciliation banner shows any drift from the
ledger with two one-tap resolutions, and issue locks it). Every figure is
derived in `lib/invoicing/derive.ts` (goldens pinned on the mockup's own
numbers) or the `invoice_ledger_staff` RPC; components format and never
compute. Draft editing is migration `20261113` (line RPCs recompute totals
server-side; `invoice_set_draft_total` for inc-anchored amends;
`invoice_record_drift_as_variation` writes a staff-override wo_variation so
the ledger moves by exactly the drift; the same file hardens
`invoice_draft_final` against object-shaped selected_options). The PC WO
view's money strip links to the money view and the console rail carries
"Invoicing". Proven by `e2e/invoicing.spec.ts` — accept → deposit draft on
both surfaces → issue (DB refuses edits after) → bank payment → surfaces
update → 25% claim server-computed → amend → banner with both resolution
paths writing events — 6/6 against the live schema, plus the sign-off and
full-loop suites re-run green.

## Invoicing Step 3 — PDF, send pipeline, customer token view (24 Aug 2026)

One document, three faces: `/i/[token]` renders the customer's invoice as a
white professional A4 sheet on a dark shell; the print stylesheet IS the PDF
(the pipeline in `lib/invoicing/pdf.ts` drives headless Chromium at
`/i/[token]?print=1`, so screen, paper and file can never disagree); staff
download via `/invoicing/inv/[id]/pdf` (heal-if-missing → signed URL). PDFs
live in the private `invoice-docs` bucket, written with the service key and
read only through short-lived signed URLs; `invoice_attach_pdf` /
`payment_attach_receipt_pdf` write the path exactly once (regeneration is
refused in the RPC, the trigger and the pipeline — three layers). Receipts
render from `lib/invoicing/receiptHtml.ts` behind `after()` so recording a
payment never waits for Chromium. Sending rides the existing lib/messaging
provider interface (⚑16): configured → Resend email with pay link + bank
details in ENGLISH tone; not configured → the log driver, and issuing
proceeds regardless. `invoice_by_token` (migration 20261114) returns exactly
one invoice's customer-safe payload — drafts only for staff preview,
unknown tokens are nothing; customer visits write `viewed` (staff previews
and the PDF printer are recognised and skipped). ATO tax-invoice fields per
§6.7 are on the document; ⚑11/⚑12 entity + bank come from Settings.

## Invoicing Step 4 — Stripe (24 Aug 2026)

§5 exactly, over plain REST (the Resend/Twilio pattern — no SDK, no PCI
surface): the customer's "Pay now" POSTs to `/i/[token]/checkout`, which
mints a FRESH Checkout Session per click against the invoice's exact current
balance plus the ⚑4 surcharge as its own disclosed line
(`lib/invoicing/stripe.ts`, rate from Settings via
`lib/invoicing/surcharge.ts`). The webhook
(`app/api/webhooks/stripe/route.ts`) is the SOLE writer of card-payment
success: signature verified first (`lib/invoicing/stripeSig.ts`, real-HMAC
unit tests), then the three-state idempotency door (`stripe_event_insert`:
new/retry/done — a dispatch crash before "processed" reprocesses on Stripe's
retry instead of being waved through as a duplicate), then the
service_role-gated RPCs of migration `20261115`: `record_stripe_payment`
(intent-unique, receipt allocated, status derived), `payment_set_stripe_fee`
(balance-transaction fee behind after()), `record_stripe_refund` (payment
flips, invoice status deliberately untouched — refunds never silently
un-pay; the event carries needs_credit_note), `record_stripe_failure`
(feed only). The return page polls the read-only `/i/[token]/status` and
never claims success the database can't back. No keys configured → the card
path vanishes cleanly (bank transfer only, 503s with friendly copy) — and
per Tom's C1 ruling, test keys and the test-card e2e live only in the
dedicated test project. Settings gained an Invoicing folder (entity, bank,
money defaults); banking now has ONE editor that writes both
company_profile (estimate header) and invoicing_bank (invoices) in
lock-step.

## Invoice-builder addendum A1 — drawn variation signatures + the working scope (24 Aug 2026)

Ruling 1 made law (migration `20261116`): a variation is APPROVED only by
`wo_customer_sign_variation` — name + drawn PNG (data URL, stored on
`wo_variations.signature/signed_name/signed_at`, the estimates.accepted_signature
pattern); the old one-tap approve in `wo_customer_respond_variation` now answers
`error:signature_required` (decline stays one tap). The pad itself is ONE shared
component now — `app/components/SignaturePad.tsx` — used by `/e` acceptance and
`/v` approval; `/v` also renders the credit sign, the engine's `priced_lines`,
old → new job total (from `invoice_ledger` via the token RPC), and the signed-by
record; the signer's name travels to the invoice line detail
(`app/invoicing/inv/[id]`) and the completion report. Rulings 2–3 machinery: a
signed CREDIT strikes its `wo_surfaces` rows (`removed_from_scope`, never
deleted; tick RPC refuses them, the stage gate no longer counts them, reseeds
keep them) — but only `todo` surfaces; any started/done surface flips
`needs_manual_deduction` and the PC sets `deduction_cents` by hand via
`wo_set_variation_deduction` (⚑10 stands — deductions are never computed).
Contractors ACKNOWLEDGE credits (`wo_contractor_acknowledge_variation`, no veto,
refuses while a manual deduction is unset); additions keep release → accept.
The estimate side is now DB-frozen: trigger `estimates_frozen` refuses changes
to builder_state/sent_snapshot/money columns while status='accepted'
(service_role exempt), and post-acceptance edits live on
`public.wo_working_scopes` — accepted_state (immutable baseline, trigger-guarded)
+ working_state, written only by `wo_open_working_scope` (clone-on-first-open) /
`wo_save_working_scope`, both staff-gated. Contract tests:
`lib/workorder/variationSign.contract.test.ts`.

## Invoice-builder addendum A2 — builder mode "revision" (24 Aug 2026)

`QuoteBuilder` gained `mode="revision"` (shared component + mode prop — no
fork): `/quote?id=<estimate>&mode=revision` opens the SAME builder over the
job's working scope (clone-on-first-open via `wo_open_working_scope`), priced
with the estimate's OWN `rate_card_id` — never the active card, so a signed
job cannot silently reprice. Saves go to `wo_save_working_scope` only; the
send/status/template controls disappear; an amber "Revision · working scope"
badge replaces the status pill. The DIFF against the accepted baseline is
`lib/revision/diff.ts`: a CHAIN of whole-estimate re-prices (one changed block
swapped in at a time, adjustments last) so sundries/discount/GST rounding ride
along and Σ deltas = working − accepted TO THE CENT by construction (unit-
pinned). `RevisionPanel` previews the changes live and "Save & draft
variations for signature" calls `draftRevisionVariationsAction`, which
RECOMPUTES server-side and writes through `wo_draft_revision_variation`
(migration `20261117`): one live draft per change (`revision_block_ref` +
partial unique index), re-draft updates the same row/token, zero-delta
retires it, contractor delta = hours × settings rate stamped in SQL, and
already-SIGNED revision variations for a block subtract so a second round
drafts only the increment. Zero-site-work variations auto-advance past the
contractor at signing (`variation_no_site_work`). e2e:
`e2e/revision-builder.spec.ts` (5 scenarios incl. the byte-identical
accepted-row proof); contracts: `lib/workorder/revisionDraft.contract.test.ts`.
C1 seed now provisions an active rate card + items so pricing paths run on the
test project.

## Invoice-builder addendum A3 — the contractor loop + WO sync (24 Aug 2026)

Rulings 2–3 on every surface. CREDITS: the portal card says **Acknowledge**
(scope owner is the customer — no veto) via
`wo_contractor_acknowledge_variation`; the pay figure is the engine's
hours-delta unless the removal hit started work, in which case
`needs_manual_deduction` routes it to the PC — a `SetDeduction` card on the
job page plus a `variation-deduction` warning card in the /pc queue — and
`wo_set_variation_deduction` records the person's figure (acknowledge REFUSES
`awaiting_pc_deduction` until then; the contractor is told, not asked).
ADDITIONS keep release → accept. Struck surfaces render struck-through with a
"Removed from scope" chip on the portal TickList, the PC read-only list AND
the anon /w job sheet (migration `20261118` adds the flag to
`get_work_order_ticks_by_token`); `progressOf` excludes them so "N of M" and
the finish gate mean live scope. The one pay rule lives in
`lib/workorder/contractorPay.ts` (offer + accepted additions − acknowledged
credits, manual deduction winning; only `contractor_accepted` counts) and the
invoicing job money view's Costs tab reads it. e2e:
`e2e/revision-contractor.spec.ts` (5 scenarios AS CONTRACTOR/PC).

## Invoice-builder addendum A4 — the reconciliation proof (24 Aug 2026)

`e2e/revision-reconcile.spec.ts` is the addendum's acceptance, run in real
roles and real UIs on the C1 stack: accept → revision (one add, one credit)
drafted from the real builder → both signed on /v with the drawn pad →
contractor accepts + acknowledges → then the arithmetic: the ledger's
adjusted contract equals `priceEstimateTotals(workingScope)` TO THE CENT
(accepted + Σ signed variations = the engine's working total, by the diff
chain's construction); `invoice_create_final` drafts to exactly that figure,
inc-anchored GST, each signed variation its own line at
`variationLineExCents(price)` with the credit sign flipped, all lines summing
to the document's ex total; `invoice_final_drift_staff` answers 0; contractor
deltas are hours × the stamped rate and `contractorAdjustedCents` nets them;
and the accepted estimate row is byte-identical before and after the whole
journey. No figure in the spec is typed — every expectation comes from
lib/pricing, lib/invoicing and lib/workorder, the modules production uses.

## Invoicing Step 5 — contractor invoicing v2 (24 Aug 2026)

The 20261112 `contractor_invoices` table got its machinery (migration
`20261119`). ONE money rule, twinned: total (inc) = offer + Σ accepted
addition deltas − Σ deductions, where a deduction is the engine's figure for a
clean removal and ONLY the PC's `deduction_cents` on started work —
`contractor_invoice_amounts` in SQL, `lib/workorder/contractorPay.ts` in TS,
contract-tested against each other. INC-ANCHORED (⚑14): GST registration
changes the document (Tax Invoice + GST backed out vs Invoice + GST 0), never
what we pay — accountant flag. Sign-off AUTO-DRAFTS it (both tails — `wo_sign`
and `wo_close_without_walkthrough`, re-issued BODY BASIS 20261112, which also
put the drawn-signature record into the frozen completion report);
`wo_reopen_signoff` drops the draft. The contractor reviews it at
`/portal/money/[id]` — LIVE figures while draft, deduction lines named and
noted pre-submit — and `contractor_invoice_submit` validates (entity fields,
11-digit ABN, bank, no pending manual deduction), recomputes, pins entity +
GST registration, allocates `CI-…` (ci_no_seq) and freezes the row (guard
trigger: draft→submitted→approved→paid, RCTI shortcut draft→approved only
with `rcti_agreement_signed_at` — staff record it via `contractor_set_rcti`,
toggle on the contractors page). PC approves and marks paid (bank reference +
date) from the dashboard's Payables tab (`payablesTiles` in derive.ts, rows
with inline Approve/Mark paid); paying allocates `REM-…`, renders the
remittance advice (`remittanceHtml.ts` → `ensureRemittancePdf`, invoice-docs
bucket, attach-once) and emails it to the contractor's login email behind
`after()` (⚑16 log-driver). The job money view's Costs tab shows the CI chip.
e2e: `e2e/contractor-invoicing.spec.ts` (7 scenarios — all three §8.5 accept
criteria) + the full-loop's sign-off assertion now covers the auto-draft;
`ciStateMachine.ts` mirrors the guard. Loop fixtures delete contractor
invoices in teardown (work_order_id is RESTRICT).

## Revision builder = THE invoice surface (24 Aug 2026, Tom's follow-up)

Five rulings in one pass. (1) The money view's "Revise scope" is now a
prominent amber button under the header (crumb link stays). (2) The invoice
document editor takes NO manual lines any more — the add-line control is gone,
replaced by a link to Revise scope; every change to an invoice is measured,
engine-priced and customer-SIGNED (amend/remove on existing lines and the
reconciliation banner remain as the safety net). (3) In revision mode the
customer tab is labelled INVOICE and always renders LIVE from the working
scope — "the final invoice, previewed" — with a View invoice button on the
RevisionPanel flipping to it. (4) Signing links go out through the messaging
rails: `sendVariationForSignatureAction` (email via the branded shell + SMS,
recipient from the estimate's own contact, ⚑16 log-driver), with per-variation
"Email & text to customer" buttons beside Copy on both fresh drafts and
standing ones. (5) Signing lands the customer back on THEIR page: migration
`20261120` adds `estimate_changes_by_token` (signed + awaiting variations,
adjusted total — customer-safe) and `estimate_token` on the variation token
read; /v's approved state auto-redirects (4s) to `/e/<token>#changes` and /e
renders "Changes to your job" — each signed change, sign-links for pending
ones, and the ledger's updated total to the cent. e2e: revision-builder 7/7
(the new customer-journey test walks /v → /e for real).

## Two money tabs + contractor payment claims (24 Aug 2026, follow-up #2)

Navigation: **Invoicing** (`/invoices`, estimates-tab layout — one row per job,
the ADDRESS opens the revision builder, every invoice's status chips on the
row, filters active/all/draft/awaiting/overdue/paid) and **Payments**
(`/invoicing`, the renamed ledger dashboard, now desktop-width `.invx .wrap`
1080px; phones keep the fluid column). Invoicing left the PC Command nav.

Contractor claims (migration `20261121`): `contractor_invoice_request` lets a
contractor invoice AT ANY TIME — percent of adjusted pay or fixed dollars,
SQL-bounded to what remains uninvoiced, born SUBMITTED with the same
validation as the one-tap submit; the sign-off FINAL now drafts only the
REMAINDER (`previously_invoiced_cents` on its face; submit/approve recompute
the same way). Every submitted contractor invoice renders a PDF under THEIR
entity, billed to Paint Group (`contractorInvoiceHtml.ts` →
`ensureContractorInvoicePdf`, attach-once, heal-on-view routes
`/portal/money/[id]/pdf` + staff `/invoicing/ci/[id]/pdf`). Portal Money tab:
"Invoice Paint Group" card (job picker, 25/50/custom % chips or $, live
remaining preview) + Download-PDF buttons; the detail page shows claims as
their own line and "less previously invoiced" on finals. Payables rows carry
the job's PC stage, a claim tag, and the Invoice PDF button; **Mark paid asks
for the bank reference AND the payment date**, and the paid state (with
remittance) reads straight back in the contractor's portal. e2e:
contractor-invoicing 12/12 (claims journey incl. bounded fixed claim,
remainder final, dated payment); revision-builder 8/8 (the /invoices door).

## Close-off batch (24 Aug 2026, night)

Variation signing links now send by CHOICE — Email / Text / Both segmented
buttons on each link row (`via` on `sendVariationForSignatureAction`; a
channel with no contact detail names itself instead of silently skipping).
Contact hygiene: `lib/validation/contact.ts` — a mobile only saves as a full
Australian mobile (04xx/+614), an email only as a whole address; enforced on
BOTH ContactModal exits (Save to Contacts and Use on estimate), empty stays
allowed. The revision builder's INVOICE tab now renders the customer document
headed "Invoice EST-…" (CustomerEstimate `docLabel` prop — eyebrow + footer
drop the 60-day validity line), so what staff preview is the invoice the
customer will see, live from the working scope.

## Cost capture 6a — one pipeline, four doors (25 Aug 2026)

Every cost now enters through `cost_intake` (migration `20261122`): the
bills@ email webhook (`app/api/inbound/bills` — svix-signed, 3-state
idempotency door keyed on message_id, raw email + attachments stored in the
private `cost-docs` bucket), the Airtable/Zapier transition webhook
(`app/api/inbound/airtable`, Bearer secret, idempotent per record_id), and
staff manual entry ("+ Add cost" on the job money view — document required,
staged through a signed upload URL and byte-sniffed before the row exists).
Reading is `lib/costs/`: `rules.ts` (deterministic field extraction, always
runs), `extractBill.ts` (Anthropic forced-tool reader, proposes only, with
per-vendor `extraction_hints` injected), `match.ts` (the ladder: exact
`PG-<job_no>` order ref → single-winner address match → vendor sender-domain
memory → unmatched). Work orders gained a sequential `job_no` — the `PG-0087`
job code (⚑A3/⚑21) that makes supplier matching exact. Nothing becomes a
cost row until a person confirms in the intake queue on the Payables tab
(`app/invoicing/PayablesCosts.tsx`); the duplicate guard (same
vendor+invoice-no, or same total+date+sender inside the Settings window)
flags instead of writing; unreadable documents park as "couldn't read this",
never $0. Confirmed rows land in `job_costs` (recorded → approved → paid,
inline on Payables) or `material_costs` (null WO = unmatched queue, one-tap
assign) with the source document attached and proposed-vs-confirmed kept —
the accuracy readout on the queue header is the evidence for ⚑A1
(auto-confirm, seeded OFF and inert). Settings → Cost intake carries the
window/threshold/toggle. e2e: `cost-intake.spec.ts` 9/9 on C1.

## 25 Aug 2026 — the small-things batch (Tom's list)
Contractor portal: live offers on Home with the 24h countdown; OfferBar pins
clock + accept/decline atop an offered job; server-side suburb-only redaction
now covers the job TITLE and the offers payload; Money→Invoicing; claimable
jobs fall back to wo_snapshot.contractorPaymentCents; StartJob card moves
pre_start→in_progress via wo_contractor_start (migration 20261124, gate
unchanged). PC: attention cards dismissible (wo_dismiss_card → card_dismissed
events, filtered in buildQueue); accepted-job card fires day zero; reschedule
proposals raise a queue card; schedule detail opens /pc/wo/[id]; checklist
ticks optimistic. Variations: PC card's primary is the revision builder,
quick-price secondary; priced variations email/text the signing link from the
card; pricing auto-emails. Customer updates: UpdateComposer on the PC job page
(text + up to 8 photos) delivers email+SMS with the /e token link via
lib/workorder/sendUpdate; the Updates tab delivers too. WO snapshots carry
`inclusions`. Customer invoice sheet says "Payment request" for progress kind.

## 26 Aug 2026 — Portal 3a-1: the customer identity layer (accounts)
Migration `20261128_customer_accounts`: `accounts` (residential|trade,
email-unique on lower(email), flags jsonb) + `account_users` (verified logins
only — never created from an unverified wizard email) + `properties` joined
to accounts (customer_id now legacy-optional; per-account dedupe on
`address_norm`); `estimates.account_id` / `invoices.account_id` FKs, all
RESTRICT. Every invoice inherits its estimate's account via a BEFORE INSERT
trigger (structural S2 fix — no insert site can forget). RLS: staff all;
members SELECT accounts/membership/properties; estimates and invoices stay
customer-unreadable (margins live in builder_state — rendered views only,
the standing role-view rule). `lib/accounts/identity.ts` owns the two
identity keys (normalised email, address dedupe key); `lib/accounts/link.ts`
find-or-creates account+property (schema-missing = inert no-op); the wizard
submit route links every customer save. Backfill:
`scripts/portal/backfill-accounts.mjs` (dry-run default, report-and-confirm).
Proof: `e2e/account-rls.spec.ts` 7/7 on C1 through real customer sessions.
Resolves the linking half of `docs/briefs/customer-identity-link.md`.

## 27 Aug 2026 — Portal 3a-2: magic-link sign-in + the portal shell
`/account` is the customer portal (no migration). Sign-in is passwordless
(⚑3): `lib/portal/auth.ts` mints a Supabase magic-link token server-side
and emails OUR link (/account/auth?token_hash=…) through lib/messaging —
no Supabase SMTP or redirect-allowlist dependency; `/account/auth`
verifies (verifyOtp) and only THEN joins the login to its account
(`ensureMembership` — first login = owner; the 3a-1 verified-auth ruling).
Shell: `app/account/` — scoped `account.css` from the approved mockup
(call chip in the header of every page, bottom tabs phone / sidebar
desktop via one responsive stylesheet, base type ≥18px), state-aware Home
(`lib/portal/home.ts`, pure + unit-tested precedence: walkthrough >
underway > booked > ready > saved > welcome) with exactly one primary
action, honest not-yet stubs for Project/Colours/Money/Messages.
`lib/portal/data.ts`: memberships/accounts/properties via the caller's
session (RLS is the authority); estimates/work_orders via the service
client scoped to proven account ids, customer-safe columns only; company
contact (name/phone/logo only) via service because `settings` is
staff-RLS'd. Customer logins land on /account; /dashboard redirects.
Wizard saves email a sign-in link (real addresses only — `isTestEmail`
guard protects deliverability). Proof: `e2e/portal-shell.spec.ts` 4/4 live
— wizard → save → magic link → portal with no registration form anywhere.

## 27 Aug 2026 — Portal 3a-3: Money in the portal
The /account/money tab renders the invoicing phase's rows read-only (no
migration): lib/portal/money.ts is the pure customer view-model — visible
statuses only (issued/sent/viewed/partially_paid/paid; drafts, voids and
write-offs never render), chips derived through lib/invoicing/derive (the
one-source rule with the staff dashboard), GST via the inc-anchored
gstFromIncCents, per-job "balance on completion" remainder = accepted
contract − issued. Reads ride lib/portal/data.getPortalMoney (service
client scoped to proven account ids, safe columns only — no surcharge or
Stripe internals). Invoice rows deep-link to the existing /i/[token]
surface (PDF + pay — one component, no fork); receipts get
/account/receipt/[paymentId] (ownership via payment→invoice→estimate→
account chain, 404 otherwise, ensureReceiptPdf + signed URL).
account.css gained a real print stylesheet (white paper, no chrome).
Proof: e2e/portal-money.spec.ts 3/3 live + 9 unit tests on the view-model.

## 27 Aug 2026 — Portal 3a-4: the Project Timeline
/account/project renders the job from WO-loop data (no migration).
lib/portal/timeline.ts = the pure feed builder: SENT updates only, photos
grouped to their Melbourne day and attached to that day's leading card,
milestones (deposit/underway/qa-pass/walkthrough/ready/signed), variation
cards reusing the /v token flow, area rollups in the four customer words.
Rulings encoded: QA renders only as a pass milestone (fails and qa-kind
photos are never fetched — Tom, 23 Aug); declined variations stay on
record kindly; no +10:00 literals (UTC-noon day anchors). Photos:
lib/portal/photos.ts signs 640px/1600px RENDITIONS via storage transforms
(verified live: ~14% of original bytes) — a phone feed never downloads an
original (§10.3). getPortalProject picks the customer's current WO by
stage precedence and reads safe columns only; painter surfaces as first
name. PhotoGrid client component = grid + full-screen lightbox. Proof:
e2e/portal-timeline.spec.ts on live + 8 unit tests.

## 27 Aug 2026 — Portal 3a-5: colours register, Documents, warranty
Migration 20261129: company_documents (+ private company-docs bucket,
staff-only storage policies) and warranty_issues (photo-first reports;
account_id RESTRICT; written only by the server action after an
account-chain ownership check). Settings → Documents (DocumentsManager):
upload certs with expiry, active toggle, and the warranty-terms approval
flag (settings key warranty_terms). PC console: loadConsole returns
expiringDocs (≤30 days) rendered as an amber banner (⚑13), and open
warranty_issues become warning cards (buildQueue warranty-issue:<id>,
clearing when handled). Portal: /account/colours = the permanent register
(lib/portal/colours.ts — snapshot areas × materials × live match codes;
TBC honest, never invented; print = the PDF), /account/documents = live
warranty card per job (warranties table dates + countdown), report-issue
form (lib/uploads validation, photos to wo-photos/warranty/), credential
downloads via /account/document/[id] (active-only, signed URLs, 404
otherwise), completion-report link (/s token), and the full §2 terms
DRAFT-watermarked until approved. Proof: portal-aftercare 3/3 on C1.

## 27 Aug 2026 — Portal 3a-6: the embedded builder + multi-property
No migration, no fork: the portal links to /estimate — the ONE wizard —
with a `prefill` prop (email from the verified session, address from the
chosen property, read through the caller's RLS). getWizardActor now
admits signed-in customers (role customer + real email) as the customer
actor with `verifiedEmail`; the submit route trusts the session email
over the typed one, skips the saved-email for members, and consults the
account's gates: lib/portal/limits.bypassesWizardLimits (trade unlimited
— decided; flags.unlimited = office unblock ⚑1; residential standard,
⚑12 account-wide). The email gate page is absent for members (lastPage
5); signed-in members also bypass the wizard_public holding page (B4).
Multi-property: ensureProperty extracted as the one dedupe rule (shared
by wizard save + the add-address action); /account/addresses/new (shared
AddressField, portal-styled wz-* classes); Home gains the property
switcher at 2+ (filters by estimates.property_id), the builder card and
the add-address link. Proof: portal-builder e2e 3/3 live + the no-fork
contract test.

## 27 Aug 2026 — Portal 3a-7: the commercial workspace
No migration — trade is aggregation over the same customer-safe rows
(§6). lib/portal/portfolio.ts = the pure view-model (tiles, attention
queue reusing the shared overdue rule, underway bars).
AccountTabs/Home branch on account_type: trade gets Home(portfolio)/
Properties/New estimate/Money. Properties carries register + warranty
lines and the one-tap rebook; /estimate gained `rebook=` — ownership via
the account chain, the prior wizard state re-validated through
wizardStateSchema AFTER stripping every file/run reference (a state that
only made sense with its floorplan falls back to address-only), then
seeds WizardApp via `prefillState` (surfaces kept, no defaults reset).
getRebookCandidates exposes only a wizard-presence marker — builder_state
never reaches the client. Money: trade header + /account/statement/[month]
(white printable statement; ⚑5 display-only 14-day terms). Settings →
Trade accounts (⚑2 office-side granting + the ⚑1 unblocked flag).
Proof: portal-commercial e2e 4/4 live incl. the seeded rebook.

## 27 Aug 2026 — Portal 3a-8: the volume gate
Seeded C1 with the ⚑14 dataset (25k accounts/60k estimates/20k WOs/500k
photo rows — scripts/portal/seed-volume.mjs, generate_series, ~70s) and
measured the portal against it (e2e/portal-volume.spec.ts →
test-results/volume-gate.json). Findings fixed: member RLS policies were
per-row is_account_member() calls (559ms/1006ms bare selects at seed) —
migration 20261130 rewrites them to the invertible IN-subquery shape with
init-plan-wrapped staff quals (now 3–7ms; account-rls re-proven); Home's
five-query waterfall collapsed to two (embedded chain reads); timeline
photo signing cut from 2×fetched to thumbs-only for at most 12 rendered
(full-screen minted on demand via /account/photo/[id], ownership + kind
re-proven); pagination caps swept. Numbers: Home p95 1012→324ms ✓,
timeline 1483→648ms (median 457; co-located lands under the 500 target —
runner sits ~50ms from Sydney; strict assert behind VOLUME_GATE_STRICT).
RLS plans all hot paths <10ms (scripts/portal/volume-plans.mjs).
e2e/portal-full-loop.spec.ts = the whole journey, both personas, phone +
desktop. Report: docs/manual-tests/portal-3a8-volume-gate.md.

## 27 Aug 2026 — Phase 3a close-out: staff saves join the account chain
linkEstimateAccountAction (app/quote/actions.ts): after a successful
builder save with a contact email, the estimate joins the customer's
account through the same lib/accounts identity rule the wizard uses —
fire-and-forget, staff-session RLS, test emails refused, frozen-estimate
refusals tolerated. Called from QuoteBuilder.save(). With this, every
path creates/joins accounts on its own (wizard, portal builder, staff
builder, verified login) and backfill re-runs are history. Proof:
e2e/builder-account-link.spec.ts as staff on live. 20261130 policy
migration RUN LIVE (account-rls 7/7 re-proven on prod).

## 27 Aug 2026 — Warranty certificate + cert on display + demo customer
/account/warranty/[woId]: the per-job warranty CERTIFICATE (holder,
property, sign-off and expiry dates, plain-language cover summary, ACL
statement, entity ABN/address footer; DRAFT-watermarked until approved;
Download as PDF via the print pattern), linked from the Documents
warranty card. Tom's real $20M certificate of currency uploaded to
company-docs (expires 2026-09-30 — the console goes amber ~31 Aug).
scripts/portal/seed-demo-customer.mjs: the showcase customer on live
(pg.alice.customer@gmail.com → /login → /account): two properties, a
day-3-of-6 live job with photos/updates/variation, paid deposit +
receipt, closed job with register + warranty. Idempotent; demo photos
are generated PNGs under demo/.

## 27 Aug 2026 — Google Calendar sync for contractors (lib/gcal)
Portal → Calendar gains a "Connect Google Calendar" card (OAuth, modelled
on the MYOB dance in lib/myob). Scope is calendar.app.created ONLY: the
app creates a "Paint Group Jobs" calendar in the painter's account and can
never read their personal events. Tokens live in contractor_gcal_connections
(migration 20261201000000; RLS with NO policies + grants revoked —
service-client-only, like warranty_issues), pushed-event ids in
contractor_gcal_events. There is no "push one change" path: every trigger
calls reconcileContractorCalendar (lib/gcal/sync.ts), which diffs ACCEPTED
bookings (committedIds — the same rule that gates addresses, so unaccepted
offers with trigger-written start_dates never leak into Google) against the
pushed set and inserts/patches/deletes the difference; spans mirror spanOf
so Google matches the portal calendar. Triggers: client pingGcalSync
(lib/gcal/ping.ts, fire-and-forget POST /api/gcal/sync) after the
browser→RPC transitions (OfferCard, OfferBar, ScheduleBoard cancel/resolve
— staff pass the offerId and the server resolves both contractors a
reassign touches — and quote OfferPanel resolve); after() hooks in
moveBooking/reassignOffer actions and setFinishDate; the nightly wo-sweep
reconciles everyone connected as the backstop. Setup: docs/gcal-setup.md;
manual script docs/manual-tests/gcal-sync.md; unit tests lib/gcal/gcal.test.ts.

## Wizard batch — Tom's nine items (31 Aug 2026)

The customer wizard's contact page (name/email/phone) is the LAST page before
the AI builds (WizardApp lastPage; trade/portal members with all three details
on their account skip it entirely) — NOTE this narrows the drop-out funnel to
people who reach that page. Condition prices from the FIRST reveal:
lib/wizard/exteriorAnswers.applyConditionPricing (shared by submit and the
draft pricer) maps exterior "weathered"→EXT-WEATHERED, ticked access→the
Access Allowance row, interior damage tier ≥2→COND-POOR, worst multiplier
winning one Condition slot; the sides loop's Condition card arrives pre-answered
from the wizard (builder_state.sidesLoop seed). In the sides editor a wall mix
may total UNDER 100% (part glass/garage — sides.confirmSide refuses only >100%
or 0), a ticked freestanding extra IS the extras answer
(scope-editor.hasFreestandingExtras; "Nothing else" no longer demanded on top),
and both sweeps' "+ Something else" opens a text box whose name rides the amber
deferral (loop_sweep/iloop_sweep add). Exterior can build FROM SCRATCH
(exterior.noPhotos in the state schema relaxes the page-1 listing/facades gate;
elevations size from answers as always). Interior listings can be READ:
/api/extract/listing-plan fetches an allow-listed listing, finds the floorplan
image (lib/extract/listing.findFloorplanImages — plan only, the 20 Aug
no-agency-photos ruling stands), stages it, and the client ingests it through
/api/extract/floorplan like any upload. The processing screen is a live step
list + progress bar + rotating tips (PROC_TIPS). vercel.json pins functions to
syd1 — they ran in US East against a Sydney Supabase, which was most of the
wizard's per-tap latency. Manual script: docs/manual-tests/wizard-31aug-batch.md.

## Assistant agent — S1 (2 Sep 2026)

The assistant (briefs `claude-code-brief-assistant-agent.md` + Addendum A;
rulings in `docs/briefs/agent-rulings.md`) lives in `lib/agent/`. It is a
tool-user: the model may only act through the zod tool contract in
`schemas.ts` (25 tools, each marked by mode and by explicit `view=staff`), and
every call is logged to `agent_tool_calls` so any number in a reply can be
reconstructed. `turn.ts` is one pure turn — persist the person's message
first, check the per-conversation and per-account-per-day budgets (exhaustion
becomes a handoff, never an error), run the model/tool loop through the
contract, then three guards: a `hard_stop` script IS the reply, a `$` figure
no tool returned replaces the reply and logs `number_guard`, a refused tool's
reason is relayed. `gateway.ts` (server-only; lint rule keeps it out of
pages/components, reach it from `app/api/agent/**`) binds the Anthropic SDK
client (`model-anthropic.ts`, streaming), the service-role store
(`store-supabase.ts`) and, for now, `NoopTools`; S3 binds the real scope and
pricing tools. Model ids, budgets, support hours, tone, disclosure and the
scripted hard stops are rows in `agent_settings` (migration `20261228`,
seeded for `paint-group`), never code. The seven tables carry RLS: customers
read their own conversations/messages/handoffs via the SECURITY DEFINER
`agent_is_my_conversation`, tool calls are staff-only, no client role can
write the transcript. D19 (`20261227`) adds four cupboard-interior rate rows;
`lib/wizard/rooms-loop.ts` gains `CUPBOARD_INTERIOR_BY_ROOM_TYPE` +
`applyCupboardInterior` and the wizard-edit route the `room_cupboard_interior`
action. Manual script: `docs/manual-tests/agent-s1.md`.

## Assistant agent — S2 question graph (2 Sep 2026)

`lib/agent/question-graph.ts` is the deterministic "what do we ask next"
(assistant brief §4). It is generated, not hand-written: per-area required
questions come from `lib/wizard/required-questions.ts` — a data registry the
editors' own gates (`confirmRoom`, `confirmSide`) now read, so a new required
question added there is asked by the assistant and enforced by the editor
without touching the graph; per-room "what are we painting" confirms come
from `room_type_scope_rules`; cupboard questions are data-driven on the rate
card; globals follow the wizard page order; the sweep mirrors the loop metas.
`gapsFor` returns every open gap ordered stop → required → tightening (by $
swing from price_scope, Addendum A) → recommended → confirm, with hallway
first, sides front→left→right→back, and a both-job's interior questions before
its exterior ones; `nextGap` is the head; `nextBatch` gives one question in
guided mode, up to three sweep confirms, everything in co-work. Known ≠ asked:
plan-read sizes are a one-time confirm, never required. Six fixture jobs pin
the order in `question-graph.test.ts`. The five previously missing reference
briefs (plan reader, site capture, visit booking, inbound calls) and the Brain
v1 seed (`docs/brain/brain-v1.md`) are now committed.

## Assistant agent — S3 scope tools + parity (2 Sep 2026)

The tools are bound. `lib/wizard/build-tree.ts` is the wizard path (starter →
draft → answers → exterior → condition pricing) extracted from the draft pricer
so the draft board, the assistant and the parity test share it. `lib/agent/
scope-doc.ts` is the estimate's builder_state as pure functions: `applyAnswer`
maps every question-graph key onto the same loop function the wizard-edit
route dispatches to (room sizes, cupboards and interiors, custom notes,
confirms, sides, wall mix, the condition card, sweeps), builds the tree with
build-tree once the answers form a complete wizard state (unsure tiles filled
for anything still open), and patches door style / window style / ceiling
height in place afterwards. `lib/agent/scope-tools.ts` binds get_scope,
next_gap, list_gaps, answer_gap, add_area, add_surface (per-item charge-out
pinned), set_count, set_size, remove_item, add_custom_line (always amber +
visit tier), price_scope (editorPayload + guardrails + bands, plus the
Addendum A assumption chips with $ swings priced by diffing the alternative,
and R4's showNumber: trade from the first price, residential only when every
area is confirmed and swept), check_thresholds (the route's self-serve rule
with customer wording), hard_stop, get_support_hours and emit_crm_event;
everything else falls through to NoopTools until its session. Storage is
`ScopeStore` (memory / Supabase service role). The parity suite in
`scope-tools.test.ts` builds six jobs the wizard way and the assistant way
against captured reference data (`lib/agent/__fixtures__/scope-refs.json`) and
asserts identical rows, hours, cents and range.

## Assistant agent — S4 guided mode (2 Sep 2026)

The first screen. `/estimate/assist?c=<conversation>` (or `?estimate=<id>`
to adopt a draft from the scope editor) is the split view: the chat on the
left, the SAME confirm-loop editor (`ScopeEditor` / `SidesEditor`) on the
right, remounted from a fresh `CustomerScopeBundle` after every turn. That
bundle is `lib/wizard/customer-scope.ts` — the editor page's data assembly
extracted so the two surfaces cannot price or gate differently. Every tap on a
chip is a structured answer `{key, value}` carried on the message as an
`[answer key=… value=…]` marker the model turns into `answer_gap`; free text
goes to the model as prose. Routes: `POST /api/agent/start` (creates a blank
customer_intake draft for the actor, or resumes on an owned estimate; seeds
the disclosure + first graph question as the greeting, logs `wizard_started`),
`POST /api/agent/turn` (one turn through the gateway; links the account when
an email lands — the wizard's own `ensureAccountAndProperty`; returns reply,
UI state and the bundle), `GET /api/cron/agent-sweep` (a quiet conversation
with an email and no acceptance emits one `wizard_abandoned`). All server work
sits in `lib/agent/session.ts`; the page and routes never import the gateway
directly (the lint rule). `AGENT_MODEL_STUB=1` (the C1 stack) swaps the
Anthropic client for `lib/agent/model-stub.ts`, a templated phrasing layer
that follows the same tool sequence — everything else is real, which is how
the three journey specs in `e2e/customer-journey/assistant.spec.ts` run
without a live model. The wizard's page 1 offers "Rather chat it through?";
the scope editor offers "Chat it instead". Range card and CTA in the chat
read `price_scope` / `check_thresholds` — R4: no number for a residential
customer until every area is confirmed and swept.

## Assistant agent — S5 co-work mode (2 Sep 2026)

Staff co-work at `/estimates/[id]/assist` (`new` opens a blank staff draft).
`lib/agent/brief-extract.ts` reads pasted text into FACTS (a model tool call
with a zod schema; `heuristicExtract` is the rule-based reader the stub uses)
and always runs an injection regex — instruction-like lines are reported and
never followed. `lib/agent/propose.ts` builds the proposed tree with the
wizard's own drafting code: the starter composition for the bedroom count
reconciled with the rooms the text names (unnamed rooms are assumed and say
so), typical sizes unless stated, only the surfaces stated (ceilings not
stated → not included, chip with its $ swing), coats defaulting to two with a
fill-in, defects priced at the defect rate on an assumed quantity and held
amber (D22), unmapped items as amber custom lines. Every co-work mutation lands
on a PENDING copy of builder_state (`scope-doc.ts` pendingOf/withPending/
applyPending) and `apply_diff` commits it, logging who applied; the customer's
own guided draft has no gate (Addendum A §3.3). `price_scope` says when it
priced the proposal and carries the live total; the staff panel shows the diff
(added/changed/removed with provenance), the fill-ins, the gap batch grouped by
the Settings review gate (`agent_settings.feature_flags.priceImpactGateCents`,
default $150), the two $/hr figures, and Apply (`POST /api/agent/apply`, the
same tool run directly so applying never depends on the model). Tom's
paragraph is the golden in `propose.test.ts` (Addendum A §3.2); the staff
journey is `e2e/cowork.spec.ts`.

## Assistant agent — S6 support mode + Brain (2 Sep 2026)

Support mode lives in the customer portal at `/account/assist/[estimateId]`,
reached from the estimate's message thread ("Ask the assistant"). Ownership
is account membership (`loadMemberEstimate`). Answers come, in order, from
the estimate's own data (`explain_estimate` composes rooms/surfaces/range from
`get_scope` + `price_scope` — a sent estimate always shows its number), the
Brain (`lookup_brain` = Postgres full text over `brain_entries`, approved and
written entries only, audience-filtered, Settings tokens rendered live by
`lib/brain/parse.ts`), and otherwise "no entry yet — want a person?". A change
request on a sent estimate writes an `estimate_events` row (type
`change_request`) that `lib/crm/work-queue.ts` derives into a `change_request`
work item ("Reprice"), closed by a staff reply in the thread; on a draft the
tool points at the editor instead. Visits go through `lib/visits/policy.ts`
— the one visit-policy function from the visit brief (self_serve |
phone_first | manual; lead paint never self-serves) — and
`open_visit_booking` hands into the existing ladder. The Brain seed
(`docs/brain/brain-v1.md`) is parsed by `lib/brain/parse.ts` and imported as
drafts by `scripts/import-brain.ts` (idempotent on slug; [TOM TO WRITE]
entries carry `needs_content` and are never served; approved answers are
never overwritten by a re-import). Tom approves per entry in Settings →
Brain. Migration `20261229` adds `slug` + `needs_content`.

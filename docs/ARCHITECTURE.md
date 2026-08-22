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

# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

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

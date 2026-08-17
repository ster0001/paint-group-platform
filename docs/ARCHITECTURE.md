# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

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

**Still non-compliant here:** `save()` writes `estimates.status` directly
instead of going through a state-transition function (tracked as C3 in the
audit). The pricing-in-component problem was fixed in R1, above.

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

**Still non-compliant here:** the staff scheduling board writes
`work_orders`/`booking_offers` directly from the browser rather than through
transactional RPCs, and offer amounts are supplied by the client instead of
being recomputed server-side. Tracked in the standards audit.

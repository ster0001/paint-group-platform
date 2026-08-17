# Architecture notes

One short entry per change: what changed, and where it lives. Newest first.

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

**Still non-compliant here:** pricing math lives in `QuoteBuilder`
(`surfaceCalc`, `totals`) rather than `lib/pricing/`, and `save()` writes
`estimates.status` directly instead of going through a state-transition
function. Both are tracked in the standards audit.

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

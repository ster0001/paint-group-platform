# Addendum — the Invoice Builder & signed scope revisions

**Status:** APPROVED IN PRINCIPLE by Tom, 24 Aug 2026 (this chat) — rulings §2
are his words; ⚑ flags remain open. Extends
`docs/briefs/claude-code-brief-invoicing-payments.md`; where the two disagree
on data model or invoice immutability, the ORIGINAL BRIEF WINS — this
addendum adds a pricing surface and a signing step, it does not reopen the
ledger's guarantees.
**Position:** built BEFORE brief Step 5 (contractor invoicing) — deliberately,
because engine-priced variations produce the accurate contractor deltas that
Step 5 bills from.

---

## 1. The model (Tom's 5 points, mapped to what exists)

1. **Estimate approved → locked.** Already true: frozen at acceptance,
   `estimates.accepted_total_cents` is the immutable ledger anchor.
2. **Estimate clones to the invoice exactly.** Already true:
   `invoice_draft_final` seeds every line from the accepted snapshot.
3. **The invoice is edited in ITS OWN BUILDER — same dataset, same
   `lib/pricing`, same layout as the estimator.** ← THE BUILD. Scope
   reductions and additions are priced by measuring, not by typing figures.
4. **Changes save only to the invoice side; the estimate stays the signed
   source of truth; the customer SIGNS every variation.** Ledger already
   works this way; the signing step is new (see §2.1).
5. This addendum is how 1–4 joins the existing build.

**The one architectural line held from the original brief:** the builder
FEEDS the invoice, it never IS the invoice. The customer document, PDF,
numbering, immutability at issue, Stripe — all untouched. The builder's
output is a set of engine-priced variations; signed variations flow to the
ledger and the invoice through the machinery that is already live and
e2e-proven.

## 2. Tom's rulings (24 Aug, this chat) — build to these

1. **Physical signature.** Variation approval requires a DRAWN signature in
   a box — reuse the signature pad already used for estimate acceptance
   (`SignaturePad` in `app/e/[token]/CustomerEstimate.tsx` — extract to a
   shared component, never fork). Store signature image + name + timestamp
   on the variation; show on the invoice line detail and completion report.
2. **Removals and the work order.** A signed credit variation strikes the
   matching `wo_surfaces` out — visible, marked "Removed from scope", never
   deleted. The contractor gets an **Acknowledge** card (scope owner is the
   customer — no veto) showing the item and their pay delta. GUARD: if any
   affected surface is already started/done, the card routes to the PC
   instead with a warning and the deduction is set manually (the ⚑10
   "deductions are never automatic" ruling stands).
3. **Additions and the contractor.** Builder-priced additions flow into the
   EXISTING release → contractor **Accept** step (`wo_release_variation` /
   `wo_contractor_accept_variation`), with the pay delta now computed from
   the engine's measured hours × the contractor rate instead of guessed
   hours. Variations that change no site work skip the contractor.

## 3. What gets built

- **A per-job working scope** — a post-acceptance clone of the accepted
  `builder_state`, stored on the JOB side (never touching the estimate row).
  The estimate remains byte-frozen.
- **Builder mode `revision`** — `QuoteBuilder` gains a mode (shared
  component + mode prop, per CLAUDE.md; no fork): loads the working scope,
  prices live with the same rate card and `lib/pricing`, saves to the
  working scope only. The DIFF against the accepted scope IS the variation
  set: additions (+) and credits (−), each carrying the engine's line detail
  and hours.
- **"Send for signature"** — each net change becomes a `wo_variations` row
  (engine-priced `priced_lines`, `credit` flag for removals) with a customer
  token page: what changed, old → new price, the signature box (ruling 1).
  Signed → `customer_approved` (+ signature columns, new migration) → ledger
  moves → the final invoice re-drafts with the variation as its own line —
  all existing plumbing.
- **Contractor loop** per rulings 2–3: accept for additions, acknowledge for
  removals, started-work guard, tick-list strike-through, deltas from hours.
- **The invoice document editor stays** as the final-check surface; the
  reconciliation banner becomes the safety net (an off-ledger figure means
  "there's an unsigned change — go to the builder"), not the main workflow.

## 4. ⚑ Open flags for Tom (ask, don't invent)

1. Signature legal wording on the variation page (same review batch as the
   deposit-cap / deemed-sign-off clauses).
2. May work on ADDED scope start before the customer signs? (Default: no —
   released to the contractor only after signature.)
3. Removal pay rule when work is partially done (default: PC sets the
   deduction manually, contractor sees it before their invoice submits).
4. Does a signed variation email the customer an updated invoice preview
   automatically? (Default: no — staff issue/send as today.)

## 5. Build order (one phase per session, house rituals apply)

    A1  Migration: variation signature columns + working-scope storage +
        wo_surfaces removed_from_scope + acknowledge machinery. Extract
        SignaturePad to app/components/. Signature box on the variation
        token page; e2e AS CUSTOMER (draw, sign, approve; declined keeps
        everything unchanged).
    A2  Builder mode "revision": clone-on-first-open, price, save working
        scope; diff → draft variations (credits included); "Send for
        signature". e2e AS STAFF: remove pergola → −$ variation drafted;
        add garage → +$ variation with engine hours.
    A3  Contractor loop + WO sync per rulings 2–3; e2e AS CONTRACTOR
        (accept addition; acknowledge removal; started-work guard routes
        to PC).
    A4  End-to-end proof: accept → build revision (one add, one credit) →
        both signed → ledger + final invoice reconcile to the cent →
        contractor deltas correct. Then Step 5 picks up the brief.

**Accept overall:** the accepted estimate row is byte-identical before and
after any revision · every invoice delta traces to a SIGNED variation ·
credits strike surfaces without deleting · no second pricing path (grep:
all money from lib/pricing + lib/invoicing) · all three roles e2e-proven.

## 6. Remaining plan after this addendum

1. **This addendum (A1–A4)** — next session(s).
2. **Step 5** — contractor invoicing v2 (brief §6.3/§8.5): auto-draft at
   sign-off, portal submit, GST-registration validation, approve → pay →
   remittance PDF, Payables tab live.
3. **Step 6** — costs (brief §6.4/6.5): vendors, job_costs, materials
   Airtable sync + unmatched queue, Costs tab est-vs-actual.
4. **Step 7** — ⛔ until Tom rules the 5 flags in
   `docs/briefs/acceptance-to-paid-workflow.md` and marks it APPROVED:
   chase ladder, console cards, MYOB CSV export, full-loop e2e.
5. **Tom's standing items:** `setval('invoice_no_seq', …)` before the first
   real invoice · accountant: surcharge GST (⚑5) + legal-entity line (⚑11)
   · RCTI agreement (⚑9) · MYOB codes (⚑18) · G-phases rulings.

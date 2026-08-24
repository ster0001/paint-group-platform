# Build Brief — Invoicing & Payments (end-to-end)

**Status:** design complete · ⚑ decisions listed in §2 · build gated on §0 preconditions
**Buildout position:** item 2 of 7 in `post-wizard-buildout-order.md`. Consumes the invoice stub fired by WO sign-off (item 1); feeds the customer portal (item 3) and job P&L (item 6).
**Rulings already made by Tom (22 Aug 2026) — do not re-ask:**

- Deposit invoice **auto-drafts into the Payments tab when the customer accepts** — amendable before issue.
- After that, staff either **request a payment** (% of job or fixed amount) or **invoice in full** (remaining balance).
- Customers pay by **Stripe card link (surcharged) or bank transfer** (free, details on the PDF).
- Contractor payments are **recorded on platform, paid via bank** — no money moves through the platform.
- Accounting is **MYOB**: CSV export in v1, API sync flagged as a later phase.

---

## 0. Preconditions — check before any session starts

1. **A2 (invoice data model) has landed** per `audit-response-and-actions`: `invoices.estimate_id` is `ON DELETE RESTRICT`, all insert sites set `customer_id`, orphans cleaned. This brief builds on that model and does not modify its rows retroactively.
2. **`docs/briefs/acceptance-to-paid-workflow.md` is approved, its 5 flags settled, and committed.** B1 is ⛔ blocked until then — that doc governs the chase ladder (G-phases). Steps 1–6 below can proceed without it; **Step 7 (chase ladder) cannot.**
3. **`customer-identity-link.md`** blocks the *portal* half only. Interim customer access uses **token links** (the estimate token pattern), so invoices can be sent, viewed and paid before the identity layer lands. Portal wiring is a named follow-up, not a blocker.
4. **C1 (dedicated test Supabase project) should move ahead of Steps 4–7** — the audit already recommended it for exactly this phase. Money e2e against production is how the S7 mess happened.
5. Standing rules apply: migrations between gate runs · migration-window protocol · no `lib/pricing` changes · money server-side always · e2e-first in the real role · missing reference = STOP and report · customer-facing copy in ENGLISH (not Australian) tone.

---

## 1. Reference files — commit these first

    docs/briefs/claude-code-brief-invoicing-payments.md      (this file)
    docs/briefs/acceptance-to-paid-workflow.md               (G-phases — required for Step 7)
    docs/briefs/post-wizard-buildout-order.md                (context)
    docs/briefs/customer-identity-link.md                    (portal dependency)
    docs/briefs/claude-code-brief-wo-loop-pc-command.md      (sign-off → invoice stub contract)
    docs/audits/workflow-audit-2026-08-23.md                 (S1/S2/S3 findings)
    design/reference/invoice-view-mockup.html                (per-job money view mockup)
    design/reference/invoicing-dashboard-mockup.html         (business-wide invoicing dashboard mockup)
    design/reference/invoice-document-mockup.html            (the invoice document editor/viewer mockup)
    design/reference/cost-capture-mockup.html                (intake queue · snap receipt · contractor expenses)
    CLAUDE.md

**Kickoff ritual (law):** commit these files, then confirm the list back in the session before writing code. Missing file = STOP and report.

---

## 2. Business decisions — ⚑ ASK TOM, do not invent

Every one becomes a **Settings value with the stated default**; open ⚑s go in the PR body.

| # | Decision | Default until Tom rules |
|---|---|---|
| 1 | Deposit default % | 10% of adjusted contract inc GST, amendable per job |
| 2 | ⚑ **Deposit legal cap (Vic DBCA)** — domestic building work ≥ $10k has contract/registration requirements and deposit caps (10% under $20k, 5% at/over $20k). Needs the same legal review as the deemed-sign-off clause | Warn (amber) when a deposit exceeds the cap; never silently re-price |
| 3 | Payment terms (due date) | 7 days from issue; final invoice due on sign-off day + 7 |
| 4 | ⚑ Surcharge rate — must not exceed actual cost of acceptance (RBA/ACCC rule) and must be disclosed pre-payment | Pass through Stripe's actual domestic rate (currently ~1.7% + 30¢); shown as its own line at checkout |
| 5 | Is surcharge GST-inclusive on the receipt? | Yes — surcharge on a taxable supply carries GST; ⚑ confirm treatment with the accountant |
| 6 | Mid-job variation invoicing | Approved variations fold into the final invoice; PC can explicitly raise a standalone variation invoice at any time |
| 7 | Can a job be **scheduled to start** with the deposit unpaid? | Allowed, but amber "deposit unpaid" card in the PC console N days before start (N=3) |
| 8 | Contractor payment terms | 7 days after sign-off; timer starts at `wo_signoff.signed_at` |
| 9 | ⚑ **RCTI** (recipient-created tax invoice) — platform issues the contractor invoice on their behalf under a signed RCTI agreement. Cleaner (platform already knows offer + variation amounts) but needs the agreement template drafted | ON per contractor once agreement signed; until then contractor submits through the existing self-invoicing flow |
| 10 | Defect/rectification deductions from contractor invoices | Never automatic — PC adds a signed-off deduction line with reason; contractor sees it before submitting |
| 11 | Invoice entity — **largely resolved by current practice**: PaintScout invoices today show Paint Group branding, 25/25-35 Bunney Road Oakleigh South VIC 3167, ABN 41 639 780 108. Seed Settings from that header. ⚑ remaining: confirm with the accountant whether a legal-entity line (ENLVN Pty Ltd) must also appear, and note the P&L's Elsternwick-3205 address error must not leak into Settings | Present as today's PaintScout header |
| 12 | Bank details on the PDF — current practice: account in ENLVN Pty Ltd's name at Commonwealth Bank (copy BSB/ACC from the live PaintScout invoice header into Settings) | Settings fields; reference = invoice number |
| 13 | Invoice numbering | `INV-` + 4-digit sequence, allocated **at issue** (drafts have none); separate `RCT-` receipts, `CN-` credit notes, `REM-` remittances |
| 14 | GST rounding | Per-invoice total rounding (sum ex-GST lines, compute GST once, round half-up) — one rule, in `lib/invoicing`, tested |
| 15 | Chase ladder timings | Governed by `acceptance-to-paid-workflow.md` G-phases — its 5 flags, not new ones |
| 16 | ⚑ Email (and SMS) provider — invoices must be *sent*, and no provider has been chosen platform-wide | Step 3 builds the send pipeline behind an interface; provider decision blocks live sending only |
| 17 | Write-off / bad-debt authority | Tom only; requires a reason; writes an event |
| 18 | MYOB CSV mapping (account codes for sales, GST, surcharge income, card fees, contractor costs, materials, pass-through costs) | ⚑ get the chart-of-accounts codes from the bookkeeper before Step 7 |
| 19 | Auto-confirm exact order-ref intake matches (no human tap)? | OFF for the first month; the intake accuracy readout (§6.5) decides |
| 20 | When to retire the Zapier/Airtable materials path | After one clean month of bills@ — Tom flips the switch |
| 21 | Order-reference scheme on supplier accounts | `PG-<job number>` on every order, added when trade accounts are pointed at bills@ |
| 22 | ⚑ GST treatment of contractor expense reimbursements (registered vs not) | At-cost, itemised on the invoice and remittance; accountant confirms before the first payment run |
| 23 | Contractor claimable categories + pre-approval threshold | materials top-up, sundries, parking, tip fees, other · $100 · both Settings |
| 24 | Who may confirm intake documents | Any staff; approval of the resulting payable stays PC/Tom |

---

## 3. Core model — the job money ledger

One mental model everywhere: **each job has a ledger.**

    adjusted_contract = estimate snapshot total (at acceptance, immutable)
                      + Σ customer_approved variations (from wo_variations.priced_lines)
                      − Σ approved credit/descope variations
    invoiced  = Σ issued invoices (excl. void), net of credit notes
    paid      = Σ succeeded payments (excl. surcharge — surcharge is not job revenue)
    balance   = adjusted_contract − paid

**The variation-recompute rule lives here — write it once.** `lib/invoicing/ledger.ts` exports the single function that computes `adjusted_contract` from the snapshot + variation events, with golden tests. Nothing else in the codebase may compute it (this is the rule whose absence deferred S5b — writing it unblocks the board denormalisation later). The estimate is never edited after acceptance; the invoice never re-reads the live estimate builder.

**Invoices are the only "payment request" concept.** Deposit, progress claim, invoice-in-full, standalone variation invoice — all are rows in `invoices` with a `kind`, each a proper tax invoice. The Payments tab is a view over the ledger, not a second store.

### 3.1 Data model (migrations — Tom pastes SQL between gate runs)

All money integer cents, ex-GST and GST stored separately. RLS three ways (staff, customer = own job via token/identity, contractor = never sees customer invoicing) with explicit `view=` param.

    invoices           (extends A2 model) + job_id/wo_id, kind: deposit |
                       progress | final | variation | standalone,
                       status: draft | issued | sent | viewed | partially_paid |
                       paid | overdue* | void | written_off   (*derived, see §3.2)
                       number (unique, allocated at issue), issue_date, due_date,
                       subtotal_ex_cents, gst_cents, total_inc_cents,
                       pdf_path, token (customer link), voided_reason
    invoice_lines      invoice_id, sort, source: estimate_snapshot | variation |
                       manual | adjustment, source_ref (variation id etc.),
                       description, qty, unit, amount_ex_cents, gst_cents
                       — UNIQUE partial index: a variation id may appear on at
                       most ONE non-void issued invoice (double-billing is a
                       database error, not a code review hope)
    payments           invoice_id, job_id, method: stripe_card | bank_transfer |
                       cash | other, amount_cents, surcharge_cents,
                       stripe_fee_cents, stripe_payment_intent_id (unique),
                       status: pending | succeeded | failed | refunded,
                       received_at, recorded_by, receipt_number, receipt_pdf_path
    credit_notes       invoice_id, number, reason, lines jsonb, totals, pdf_path
    stripe_events      event_id (unique), type, payload jsonb, processed_at
                       — the idempotency ledger; insert-or-skip before processing
    invoice_events     invoice_id, type: drafted | issued | sent | viewed |
                       payment_received | nudge_sent | extension | voided |
                       written_off | exported, actor, at, meta
                       — chase ladder, activity feed and console cards all read
                       from events, same pattern as wo_events
    contractor_invoices (extends existing v1) + auto_draft_source: signoff,
                       offer_cents, variation_delta_cents, deduction_lines jsonb,
                       status: draft | submitted | approved | paid,
                       gst_cents (0 unless contractor gst_registered),
                       paid_at, bank_reference, remittance_pdf_path, rcti bool
    contractors        + abn, gst_registered bool (validated at onboarding),
                       rcti_agreement_signed_at
    vendors            name, abn, gst_registered, default_category,
                       sender_domains text[] (vendor memory — first confirmed
                       email links the sender; every later one prefills),
                       extraction_hints jsonb (per-vendor reading notes, e.g.
                       {"invoice_no_label": "Docket #"} — staff-set, injected
                       into the extraction prompt for that vendor only)
    job_costs          job_id, vendor_id, category: scaffold | render | carpentry |
                       rubbish | equipment_hire | permit | traffic_mgmt | other,
                       description, amount_ex_cents, gst_cents, doc_path
                       (photo/PDF of their invoice — remediated upload path),
                       estimate_line_ref (nullable → links to the pass-through
                       line it was estimated against), status: recorded |
                       approved | paid, paid_at, recorded_by,
                       paid_with: company_card | personal | account,
                       reimburse_to (staff member, nullable — personal
                       payments feed the reimbursement queue), intake_id
    material_costs     job_id (nullable = unmatched queue), supplier, brand,
                       order_ref, address_text, amount_cents, invoice_date,
                       source: airtable | email | manual,
                       airtable_record_id (unique — idempotent sync),
                       matched_by: auto | manual, matched_at, intake_id
    cost_intake        source: email | photo | contractor | airtable | manual,
                       raw_doc_path (original email/PDF/photo — remediated
                       upload path), message_id (unique — email idempotency),
                       extracted jsonb {supplier, abn, invoice_no, invoice_date,
                       subtotal_ex_cents, gst_cents, total_cents, job_hints[]}
                       + per-field confidence, proposed_vendor_id,
                       proposed_job_id, match_reason: order_ref | address |
                       vendor_memory | none, status: pending | confirmed |
                       rejected | duplicate, confirmed_by/at, resulting_row
                       — proposed vs confirmed is kept per row: that delta IS
                       the accuracy readout (§6.5) and the evidence for ⚑19
    contractor_expenses wo_id, contractor_id, category (⚑23 Settings list),
                       amount_cents, gst_cents, receipt_path (REQUIRED — no
                       photo, no claim), note, preapproval_id (nullable),
                       status: draft | submitted | approved | rejected | paid,
                       invoice_line_ref (set when it rides their invoice)
    expense_preapprovals wo_id, contractor_id, description, cap_cents,
                       status: requested | approved | declined, decided_by/at
    settings           + keys for every §2 value + entity details + bank details
                       + stripe key references (env, never DB) + bills@ inbound
                       config + expense threshold & claimable categories +
                       duplicate window + intake auto-confirm toggle (⚑19)

### 3.2 Invoice state machine (RPC-enforced)

    draft ──issue──▶ issued ──send──▶ sent ──customer opens──▶ viewed
    issued/sent/viewed ──payment (partial)──▶ partially_paid ──▶ paid
    draft ──delete──▶ (gone — drafts may be deleted, issued invoices NEVER)
    issued+ ──void──▶ void (requires reason; number is burnt, not reused)
    issued+ ──write off──▶ written_off (Tom only)

Drafts are **fully editable documents** — the §7.3 editor is the only mutation surface, and every edit round-trips through the server. `overdue` is **derived** (due_date passed ∧ balance > 0), computed in `lib/invoicing`, never stored — no second source of truth to drift. Illegal transitions throw. Every legal one writes an `invoice_events` row. **Issued invoices are immutable** — amounts wrong after issue = void + reissue, or credit note. The PDF is generated at issue and never regenerated.

---

## 4. Server rules (non-negotiable)

1. Every money mutation — issue, send, record payment, void, credit, approve contractor invoice, match a material cost — is a **SECURITY DEFINER RPC** with zod-validated input. No client writes to any table in §3.1. Grep-auditable, same as the WO loop.
2. **No amount ever reaches the server from the browser as the source of truth.** "Request 30%" sends `{kind, percent: 30}`; the server computes cents off the ledger. "Record bank transfer of $5,000" is the one legitimate operator-entered amount — zod-bounded (> 0, ≤ outstanding balance × 1.05 to allow small overpayments, else reject with a message) and logged with `recorded_by`.
3. Stripe secret key and webhook secret are **server env only**. The webhook is the *sole* writer of card-payment success — the redirect page never marks anything paid (§5).
4. GST arithmetic lives in `lib/invoicing/gst.ts` — one rounding rule (⚑14), golden tests including the 1-cent rounding cases and the surcharge-GST case.
5. Deposit auto-draft: `accept_estimate` (already transactional) additionally drafts the deposit invoice inside the same transaction — ledger snapshot + ⚑1 percentage. Sign-off (`wo_customer_signoff`) already fires an invoice stub: that stub becomes the **draft final invoice** = adjusted contract − previously invoiced, lines pulled by source refs.
6. Overdue/chase sweep rides the **existing** cron infra (`/api/cron/wo-sweep` pattern, CRON_SECRET, the N2 UTC-naming lesson applies). Nudges are drafted for PC approval until the G-phases doc says otherwise — nothing auto-sends money chasers in v1.
7. Token invoice links reuse the estimate-token machinery: scoped to one invoice, read-only payload + pay action, view tracking writes `invoice_events.viewed`.

---

## 5. Stripe integration (⚑4, ⚑5)

**Shape: Stripe Checkout (hosted page), one session per payment, webhook-driven truth.** No Stripe UI components in the app, no PCI surface, no publishable key needed.

1. **Create:** `create_invoice_checkout` server action → validates invoice is payable (issued+, balance > 0) → creates a Checkout Session: `mode: payment`, currency AUD, line 1 = invoice balance, line 2 = card surcharge (server-computed at ⚑4 rate, labelled "Card payment surcharge — avoid this by paying via bank transfer"), `metadata: {invoice_id, job_id}`, success/cancel URLs into the token view. Session id stored. The customer's "Pay now" button and the emailed link both resolve to a **fresh session at click time** (sessions expire; the link must not).
2. **Webhook** `/api/webhooks/stripe`: verify signature → insert `stripe_events` (unique event_id; conflict = already processed, exit 200) → on `checkout.session.completed` call `record_stripe_payment` RPC: writes `payments` (amount, surcharge split from line items, `stripe_fee_cents` fetched from the balance transaction), advances invoice status, writes events, queues the receipt PDF + email. On `charge.refunded`: writes the refund, flips payment status, opens a "credit note needed?" console card — refunds never silently un-pay an invoice.
3. **Redirect page** shows "Confirming your payment…" and polls the invoice status (read-only). If the webhook hasn't landed in 60s: "Your payment is processing — your receipt will arrive by email." Never a success claim the database can't back.
4. **Partial payments:** Checkout always charges the exact current balance (server-computed at session creation). Bank transfers may be partial → `partially_paid`.
5. **Failure/timeout paths:** expired sessions are inert (no DB writes ever happened); a `payment_intent.payment_failed` writes an event for the activity feed only.
6. **Keys:** test keys + Stripe CLI webhook forwarding in dev; live keys only in Vercel env. E2e uses Stripe test cards **against the C1 test project** (§0.4).

---

## 6. The nine asks, answered

**6.1 Stripe** — §5.

**6.2 Variations: estimate vs invoice** — the estimate snapshot is frozen at acceptance; approved variations are *append-only deltas* (§3). The final invoice lists each approved variation as its own line — description, approval date, who approved — under a "Variations" heading, so the customer sees exactly why the total moved from the quoted figure. Declined/cancelled variations never touch the ledger (they live on the completion report). A variation approved *after* the final invoice is issued raises a supplementary `kind: variation` invoice. The DB uniqueness rule (§3.1) makes double-billing a constraint violation.

**6.3 Contractor invoicing (through their app)** — the existing self-invoicing flow becomes the submission layer on a platform-drafted invoice. At sign-off, auto-draft: offer amount + Σ accepted variation deltas (hours × 6000¢, already server-computed) − any ⚑10 deduction lines. Contractor opens it in the portal, checks it, submits one-tap (their entity details + GST if `gst_registered`, else GST 0 and the document is headed "Invoice" not "Tax Invoice" — validated, not hoped). PC approves → pays via bank → marks paid with date + reference → remittance advice PDF auto-emails. With ⚑9 RCTI signed, the submit step collapses: the platform issues on their behalf and the contractor just sees "Invoice raised for you — $X, payment due <date>".

**6.4 Off-platform trades** (scaffolders, renderers, carpenters, rubbish, equipment) — `vendors` + `job_costs` (§3.1). Snap a photo of their invoice or attach the PDF, pick vendor + category, amounts ex-GST + GST, link to the estimate pass-through line it was quoted against. Linked costs give est-vs-actual per pass-through; **unlinked costs are the scope-creep signal** on the Costs tab. recorded → approved → paid mirrors the contractor flow without the portal.

**6.5 Cost capture — one pipeline, four doors** (rulings made 24 Aug — do not re-ask: bills@ address · snap-receipt with who-paid · contractor pre-approval over $100):

    DOORS                                   PIPELINE                        DESTINATION
    bills@ email (supplier/trade) ──┐
    Staff snap-receipt (phone)  ────┤   cost_intake row: raw doc +      ┌─▶ material_costs
    Contractor expense claim ───────┤─▶ AI-extracted fields + proposed ─┤─▶ job_costs
    Airtable sync (transition) ─────┘   job match → human confirms      └─▶ contractor expense

**The AI reads, a human confirms, the ledger records.** Extraction is model-read, not template-read — per-field confidence, no layout templates to break; low-confidence fields render as uncertain, never silently guessed; unreadable documents fail loudly into the queue, never to $0. Nothing becomes a cost row without a confirm tap (until ⚑19 earns exact-ref auto-confirm). Same provenance discipline as the plan reader: `ai_extracted` until `human_confirmed`.

- **Door 1 — `bills@paintgroup.com.au`.** The ⚑16 email provider must include **inbound parsing** (Postmark and Resend both qualify). MX/forwarding → provider → signed webhook `POST /api/inbound/bills` → `cost_intake` keyed by message_id, raw email + attachments stored. Suppliers' trade accounts (Haymes/Dulux) and regular trades are pointed at bills@; staff forward the rest. Email content is data to extract from, never instructions. Matching ladder, in order: exact order-reference (⚑21, deterministic, never degrades) → address fuzzy-match against active jobs → vendor memory (sender seen before ⇒ vendor + category + GST habits prefill) → unmatched. Everything lands in the **intake queue** on the Payables tab — one card per document, extracted fields with confidence, proposed job, [Confirm] [Change job] [Reject]; duplicates (same vendor + invoice number, or same total + date + sender within the Settings window) are flagged, never written twice.
- **Door 2 — staff snap-receipt** (Bunnings et al.). Global "+ Add cost" on the console and job money view, camera-first: photo → AI reads store/total/GST → job from a shortlist (scheduled-today first, then active by recency) → category chip → **who paid: company card | my own money** → save. Target ≤ 4 taps after the photo. Personal payments open the **staff reimbursement queue** on Payables (recorded → approved → paid, like everything else). E-receipts forwarded to bills@ work too.
- **Door 3 — trade invoices** (scaffold, boom, skips) ARE door 1 plus vendor memory: after the first SkyReach confirm, every later one arrives pre-filled with the job proposed from the address in the PDF — one tap. Paper dockets use door 2 with a vendor picked instead of a store. Confirmed trade costs land in `job_costs` linked to their estimate pass-through line (§6.4).
- **Door 4 — contractor Expenses** (new section in the contractor app's money tab). Camera-first claim: receipt photo required, amount, category, job (defaults to their active job), note. **Over the ⚑23 threshold the app requires Ask-first**: a one-tap pre-approval request that lands as a PC attention card, approved with a cap the contractor sees; an over-threshold claim without pre-approval can still be submitted but shows amber to the PC. Approved expenses append to the contractor's invoice as clearly-labelled **at-cost reimbursement lines** (itemised on the remittance, ⚑22 GST treatment) — one payment run, no second rail — and they land on the job's Costs tab as job costs, counted in est-vs-actual.
- **What learns (and nothing else):** order refs propagate → exact-match share grows; vendor memory (sender_domains + default_category + extraction_hints) prefills; every intake row stores proposed vs confirmed, and an **accuracy readout** on the intake-queue header (last 30 days: % exact-ref · % confirmed-unchanged · % corrected) is the evidence that rules ⚑19. No invisible self-training — every match is inspectable.
- **Transition:** Airtable sync writes through the same pipeline (`airtable_record_id` idempotent) with cross-door duplicate detection; the Zap retires per ⚑20. Materials est-vs-actual per job stays the calibration feed that corrects the known ~26% materials over-estimate.

**6.6 Payments tab** — §7 layout. Deposit auto-drafts on acceptance (amendable), Request payment (% or $ → draft → preview → issue → send), Invoice in full (remaining balance), Record manual payment, per-invoice actions (send / copy pay link / download PDF / void), activity feed from `invoice_events`.

**6.7 PDF** — one HTML invoice template (Switzer/Martian Mono, white print stylesheet — the estimate pattern) rendered server-side to PDF at **issue time** via headless Chromium (`@sparticuz/chromium` + `puppeteer-core` on Vercel), stored in a private bucket, served by signed URL, immutable thereafter. Same pipeline for receipts, credit notes, remittances. ATO tax-invoice requirements on the template: the words "Tax Invoice", identity + ABN (⚑11), issue date, description/qty, GST amount shown, total inc GST; customer identity shown for invoices ≥ $1,000. Footer: bank details + "reference: invoice number" (⚑12), payment terms, and the Stripe pay link as a short URL/QR. Customer downloads from the token view/portal; staff attach the same PDF to sends.

**6.8 What was missed** — credit notes & refunds (§3.1, §5.2); overpayments (small tolerance then operator decision: refund or hold as credit — event-logged); write-offs (⚑17); **deposit compliance** (⚑2 — same legal review batch as the deemed-sign-off clause); surcharge legality + GST (⚑4/5); invoice entity + the Elsternwick postcode error (⚑11); numbering discipline (⚑13); GST rounding rule (⚑14); MYOB CSV export (⚑18) with API sync later; view tracking on invoices; email provider dependency (⚑16); commercial customers running multiple jobs will eventually need a **statement of account** — out of scope here, named for the portal phase; and the **test-database rule**: money e2e waits for C1.

**6.9 Layout** — §7 + the two mockup files: the per-job money view (§7.1) and the business-wide invoicing dashboard (§7.2) where every invoice across every job is visible with its stage.

---

## 7. Screens — one ledger, three altitudes

Invoicing lives at three levels and all of them read the same `lib/invoicing` functions and `invoice_events` — the dashboard aggregates the job ledgers, the job money view shows one ledger, the invoice document is one entry in it. Never a second store.

**Navigation map (how the screens link):**

    /invoicing (dashboard, §7.2)
      row tap ────────────▶ invoice document (§7.3) — the breakdown, checked/edited/sent here
      job-address tap ────▶ job money view (§7.1) — the whole job's ledger
    job money view (§7.1)
      invoice card tap ───▶ invoice document (§7.3)
      Request payment / Invoice in full ─▶ creates a draft ─▶ opens as §7.3
      crumb ──────────────▶ PC Command work-order view (money strip links back the other way)
    invoice document (§7.3)
      customer token link renders THIS SAME document, read-only, with Pay now
      crumbs ─────────────▶ back to §7.1 and /invoicing

### 7.1 The job money view (mockup: `invoice-view-mockup.html`)

Lives as the money view of a job — reachable from the PC console work-order view's money strip and as its own route. Phone-first, same shell as PC Command: title row, **payment progress bar**, then **tabs: Payments · Invoices · Costs**.

- **Progress bar** — the job's payment stages as segments: Deposit → Progress → Final → Paid in full. Emerald = paid, cyan = issued/awaiting (with amount), amber = draft awaiting action, clay = overdue. Mirrors the WO stage rail so the two read as one system.
- **Money strip** — Adjusted contract (inc GST) · Variations (+/−) · Invoiced · Paid · **Balance**. Every figure from the ledger function; Martian Mono; no typed numbers anywhere.
- **Payments tab** — the ledger feed (payments + issues + views + nudges interleaved from events), the deposit draft card front and centre when unissued, and the two primary actions: **Request payment** (sheet: % chips 10/25/50 + custom % + fixed $, live preview of cents, drafts an invoice) and **Invoice in full**. Record-manual-payment lives behind the invoice card's ⋯.
- **Invoices tab** — one card per invoice: number, kind chip, status chip (colour rules above), total, paid/balance, due date, actions (Send · Copy pay link · PDF · Void). Void asks for the reason.
- **Costs tab** — three groups with est-vs-actual bars: Contractor (offer + variations, invoice status), Materials (estimate allowance vs Σ actuals, unmatched-queue count badge), Other trades (job_costs by category, unlinked = amber "not in estimate" chip). Bottom line: simple job margin preview (revenue − costs) labelled *estimate until item 6 builds real P&L*.
- **Console integration** — new attention-queue cards: invoice overdue (clay, "Chase" primary action), deposit unpaid N days before start (amber ⚑7), payment received (info, auto-clears), refund landed (amber, "Raise credit note?"), contractor invoice submitted (info, "Approve"). The "Deposit paid" pulse tile (WO brief ⚑9) now reads this module — swap the source.

### 7.2 The invoicing dashboard (mockup: `invoicing-dashboard-mockup.html`)

The business-wide money screen — its own route (`/invoicing`), reachable from the PC console. Where PC Command answers "what needs me today", this answers **"where is every dollar, and what stage is it at"**. Same shell language: headline tiles, then **tabs: Dashboard · Receivables · Payables · Activity**. Phone-first. Dashboard is the default tab.

- **Pulse tiles (4)** — **Outstanding** (Σ balances on issued+ invoices, all jobs) · **Overdue** (clay, with count) · **Due this week** · **Collected this fortnight** (emerald, with sparkline from payment events). All derived; the PC Command money tile deep-links here.
- **Dashboard tab (first, default)** — the money attention queue: what needs a human, ranked, one primary action per card — NOT a feed of everything (Activity is that). Cards derive from the same queries as everything else and **auto-clear the moment the underlying condition resolves**. Triggers and severity:

  | Trigger | Severity | Primary action |
  |---|---|---|
  | Invoice overdue (any kind) | critical (clay), oldest first | Approve chase (draft ready) + tel: link |
  | Deposit unpaid within N days of job start (⚑7, N=3) or overdue | critical | Send reminder / Call |
  | Payable overdue — approved contractor invoice or job cost past due | critical | Mark paid |
  | Final invoice drafted at sign-off but unissued >24h ("money on the table") | warning (amber) | Check & issue |
  | Variation sent to customer, **not viewed** within 24h | warning | Resend via SMS |
  | Variation **viewed but unapproved** >24h | warning | Nudge customer |
  | Contractor invoice submitted, awaiting approval | warning | Approve |
  | Deposit draft unissued >24h after acceptance | warning | Review & issue |
  | Refund landed | warning | Raise credit note? |
  | Payment received today | info (cyan), clears on the nightly sweep | View |
  | Cost intake queue non-empty (bills@/receipts awaiting confirm) | info | Review queue |
  | Contractor pre-approval requested (over-threshold expense) | warning | Approve / decline |

  Ranking is the PC Command rule: critical oldest-first → warning oldest-first → info. The variation view/sent states read the existing variation token-link tracking (same machinery as estimate/invoice view events). **One source rule:** these money cards and the PC Command attention queue share one query module (`lib/invoicing/attention.ts`) — PC Command shows the money-domain subset inline; the two surfaces must render from the same rows so they can never disagree. The tile counts derive from the same query.
- **Receivables tab** — filter chips **All · Overdue · Awaiting · Partially paid · Draft · Paid**, counts on each. One row per invoice across every job: job address, invoice number + kind, amount and balance, status chip (standard colours), and the ageing figure ("6 days overdue" clay / "due in 2 days" amber / "viewed yesterday" cyan). Default sort = the chase order: overdue oldest-first, then due-soonest. Each row also carries the job's **payment-stage dots** (deposit/progress/final — filled emerald as paid) so the stage of the whole job is readable without opening it. Tap-through = that job's money view (§7.1). Below the list, the **aged receivables bar**: current / 1–7 / 8–14 / 15–30 / 30+ days, amounts per bucket, clay weighting as the buckets age.
- **Payables tab** — the other direction of money, same shape: tiles for **To approve** (submitted contractor invoices) and **To pay** (approved, by due date per ⚑8); then the **intake queue** (§6.5 — one card per pending document, with the accuracy readout in its header), rows for contractor invoices (Approve / Mark paid actions inline), approved-unpaid job costs, contractor expense claims awaiting approval, and the **staff reimbursement queue**. Nothing here moves money — it records and reminds (per the rulings).
- **Activity tab** — the cross-job `invoice_events` feed (payments in, invoices sent/viewed, nudges, refunds), newest first. This is where "did anything land today?" gets answered without opening MYOB.
- **Rules** — every figure from `lib/invoicing` aggregations; filters are query params (shareable); the dashboard renders from the same derived `overdue` logic as the chase ladder so the two can never disagree; RLS scopes it staff-only.

### 7.3 The invoice document view (mockup: `invoice-document-mockup.html`)

The estimate-style document for one invoice — the same pivot as the estimate builder: **the editor IS the customer-facing document.** This is where staff do the final check before sending, exactly as they do with an estimate today (PaintScout's invoice editor is the reference for scope, ours for design).

- **Seeded, not typed.** Lines arrive grouped the way the estimate reads — by elevation/area with the substrate description under each heading ("Front elevation — weatherboard 75% / render 25%, 12 × 2.6 m, 2 coats · 3 windows (2M, 1L) · entry door") — pulled from the accepted-estimate snapshot. Approved variations render as their own group, each line carrying its customer-approval date. A final invoice also shows "less previously invoiced" against the named prior invoices, then subtotal / GST / balance due.
- **Editable while draft — locked at issue.** The accepted estimate is frozen, so the draft invoice is where post-acceptance reality gets expressed: amend a description, adjust an amount, remove a line from this claim, add a manual line. Two guardrails keep the ledger honest: **(a)** every figure still computes server-side (edits submit intent, `lib/invoicing` returns the document); **(b)** if edits move the invoice total away from the job ledger, an **amber reconciliation banner** shows the exact difference and offers one-tap "record as variation" (PC-entered, override-logged — the existing wo_variations machinery) or "keep as one-off adjustment" (an `adjustment` line, event-logged). Silent drift is impossible; the emerald "reconciles to the job ledger" line is the resting state. Issue = number allocated, PDF generated, document immutable (§3.2).
- **Payments section on the page** — the job's payment rows (amount, method, date, receipt ref, surcharge shown) with Record payment and Request payment, mirroring the Payments tab so the document view is self-sufficient during a phone call.
- **Actions** — Save draft · **Issue & send** (primary) · Preview as customer · Copy pay link · Download PDF · Void (issued only, with reason). No delete on issued invoices and no "edit issued" — PaintScout's Delete/Duplicate become our void + new-draft-from-ledger, which the audit rulings already require.
- **Customer side** — the token link renders this same document read-only (dark online, white print stylesheet) with Pay now; what staff previewed is byte-for-byte what the customer sees and what the PDF locks.

---

## 8. Build order — copyable steps

One phase per Claude Code session. Gate green before moving on; migrations between gates; diff approval before commit.

### Step 1 — Ledger, schema, state machine

    Read docs/briefs/claude-code-brief-invoicing-payments.md fully. Confirm the
    reference list back (kickoff ritual). Build §3.1 migrations (SQL output for
    Tom), lib/invoicing/ledger.ts (adjusted-contract rule — THE single
    computation, golden tests incl. credit variations), lib/invoicing/gst.ts
    (⚑14 rounding, golden tests), and the §3.2 invoice state machine as
    SECURITY DEFINER RPCs with zod. Numbering allocated at issue, drafts
    unnumbered. Deposit auto-draft inside accept_estimate's transaction;
    sign-off stub becomes the draft final invoice. The variation single-billing
    unique index must exist and be tested. No UI beyond a raw list.

**Accept:** transition matrix + illegal transitions tested · ledger golden tests cover snapshot + approved + credited variations · issued invoice mutation fails at the DB · double-billing a variation is a constraint violation.

### Step 2 — Job money view + invoicing dashboard (receivables)

    Build BOTH §7 screens from their mockups, 1:1.
    §7.1 from design/reference/invoice-view-mockup.html: progress bar, money
    strip, Payments/Invoices/Costs tabs (Costs shows contractor group only for
    now). Request-payment sheet (% chips + fixed $ — server computes cents per
    §4.2), invoice-in-full, record manual payment (bounded per §4.2), void
    with reason.
    §7.2 from design/reference/invoicing-dashboard-mockup.html: /invoicing
    route, four pulse tiles, Dashboard tab (the money attention queue —
    lib/invoicing/attention.ts, triggers/ranking per the §7.2 table; cards
    whose triggers depend on later steps — payables, refunds, materials —
    simply don't fire yet) as the default tab, Receivables tab (filter chips
    with counts, chase-order sort, payment-stage dots per row, aged buckets
    bar, tap-through per the §7 navigation map) and the Activity tab.
    Payables tab renders as a labelled empty state until Steps 5-6 fill it.
    Filters as query params. Staff-only RLS.
    §7.3 from design/reference/invoice-document-mockup.html: the draft invoice
    document editor — lines seeded from snapshot + variations grouped by
    elevation with substrate descriptions, edit/remove/add-line with server-
    computed figures, the amber reconciliation banner with record-as-variation
    and one-off-adjustment paths, payments section, save draft. (Issue/send/
    PDF/token view are Step 3; the editor must leave the document ready for
    them.)
    Every figure from lib/invoicing aggregations. E2e AS STAFF: accept
    estimate → deposit draft appears on the job AND on the dashboard → amend →
    issue → record bank payment → progress bar, strip, tiles and aged buckets
    all update from data alone.

**Accept:** visual parity with all three mockups on a phone · zero client-computed money (grep clean) · deposit draft appears on acceptance without a page-specific write · dashboard totals reconcile to the sum of job ledgers on the e2e data · dashboard overdue derives from the same lib function the chase ladder will use · an edit that moves a draft off the ledger always raises the reconciliation banner, and both resolution paths write events · every live Dashboard trigger produces exactly one card, and resolving the condition clears it without a manual dismiss.

### Step 3 — PDF, issue & send pipeline, token view

    Invoice HTML template (white print stylesheet, ⚑11/⚑12 entity + bank
    details from Settings, ATO tax-invoice fields per §6.7). Server PDF render
    at issue (chromium on Vercel), private bucket, signed URLs, immutable.
    Receipts on payment. Send pipeline behind a provider interface (⚑16 —
    log-to-console driver until the provider is chosen), token invoice view
    reusing estimate-token machinery with view tracking. Customer copy ENGLISH
    tone. E2e: issue → PDF exists and downloads → token view renders → viewed
    event written.

**Accept:** PDF meets the §6.7 field list · regeneration after issue is impossible in code, not just unlinked · token exposes exactly one invoice's payload.

### Step 4 — Stripe

    Build §5 exactly: checkout session creation (fresh at click), surcharge
    line server-computed (⚑4 Settings rate) and disclosed, webhook with
    signature check + stripe_events idempotency, record_stripe_payment RPC,
    fee capture from balance transaction, refund handling with console card,
    confirming-not-claiming redirect page. Test keys + Stripe CLI. E2e with
    test cards on the C1 project: pay in full, expired session inert,
    duplicate webhook delivery processes once.

**Accept:** only the webhook marks paid · replayed webhook = one payment row · surcharge recorded separately from job revenue · refund never silently un-pays.

### Step 5 — Contractor invoicing v2

    Extend the existing self-invoicing flow per §6.3: auto-draft at sign-off
    (offer + accepted variation deltas − ⚑10 deductions, all server-side),
    contractor review/submit in portal, GST-registration validation (0 GST +
    "Invoice" heading when unregistered), PC approve → mark paid (date + bank
    ref) → remittance PDF emailed. RCTI switch per contractor (⚑9), inert
    until agreement_signed_at. Wire the dashboard's Payables tab (§7.2):
    To-approve / To-pay tiles + contractor rows with inline Approve and Mark
    paid. E2e AS THE CONTRACTOR and AS PC.

**Accept:** drafted amount reconciles to offer + variations to the cent · unregistered contractor cannot produce a document saying Tax Invoice · deduction lines visible to the contractor pre-submit.

### Step 6 — Cost capture (three sessions: 6a / 6b / 6c)

Builds §6.4 + §6.5 to `design/reference/cost-capture-mockup.html`. One session each; gate green between them.

**6a — Pipeline + intake queue**

    Build the cost_intake pipeline per §6.5: migrations (cost_intake +
    vendors/job_costs/material_costs extensions per §3.1), the
    /api/inbound/bills webhook (signature verify, message_id idempotency,
    raw storage via the remediated upload path), extraction behind an
    interface (rule-based fields + AI extraction — AI proposes only, per-field
    confidence, extraction_hints injected per vendor), the matching ladder
    (order-ref → address → vendor memory → unmatched), the intake queue UI on
    the Payables tab with the accuracy readout header, the duplicate guard,
    and the Airtable transition sync writing through the same pipeline.
    vendors + job_costs manual entry per §6.4 (doc upload, pass-through
    linking, recorded→approved→paid) land here too. Build against the email
    provider's webhook simulator if ⚑16 is still open.
    E2e: an emailed PDF lands → proposes → confirms into job_costs with the
    doc attached; the same email replayed is a no-op; an unreadable
    attachment queues as "couldn't read this", never $0; a second invoice
    with the same vendor+number flags duplicate.

**Accept (6a):** no cost row exists without a source document attached · AI values never final without human confirm (⚑19 OFF) · replay-safe on both email and Airtable doors · Costs tab shows source chips that tap through to the original document.

**6b — Snap receipt + reimbursements**

    The "+ Add cost" camera-first flow per §6.5 door 2: photo → extraction →
    job shortlist → category → who-paid → save, ≤ 4 taps after the photo on
    a phone viewport. Personal payments create reimbursement-queue rows on
    Payables (recorded→approved→paid). Costs tab completed: three groups,
    est-vs-actual bars, unlinked-cost amber chips, margin preview line.
    E2e AS STAFF on a phone viewport: receipt → job → save; personal payment
    appears in the reimbursement queue and pays out with an event trail.

**Accept (6b):** ≤ 4 taps after the photo proven in the e2e · who-paid recorded on every receipt cost · est-vs-actual derives from links, not typed figures.

**6c — Contractor expenses**

    The Expenses section in the contractor portal money tab per §6.5 door 4:
    camera-first claim (receipt REQUIRED), category from ⚑23 Settings, job
    default, submitted/approved/rejected/paid states; Ask-first pre-approval
    over the threshold (request → PC attention card → approve with cap →
    visible in the contractor app); over-threshold claims without
    pre-approval submit but flag amber. Approved expenses append to the
    contractor invoice as at-cost reimbursement lines (itemised on the
    remittance, ⚑22) and land on the job's Costs tab as job costs.
    E2e AS THE CONTRACTOR (claim under threshold; ask-first over it) and
    AS PC (approve both; see the line on the invoice + the cost on the job).

**Accept (6c):** no claim exists without a receipt photo · over-threshold without pre-approval is visible amber, never silent · reimbursement lines reconcile to approved claims to the cent · approved claims appear in job est-vs-actual.

### Step 7 — Chase ladder, console cards, MYOB export, full loop
    ⛔ Requires acceptance-to-paid-workflow.md approved & committed (§0.2).

    Chase ladder per the G-phases doc: overdue derived in lib, sweep on the
    existing cron infra (N2 lesson), nudges DRAFTED for PC approval, ladder
    timings as Settings. Console cards per §7. MYOB CSV export (⚑18 account
    codes from Settings): invoices, payments, contractor bills, job costs —
    idempotent, exported event per row. Then the full-loop e2e in real roles:
    accept → deposit draft → amend → issue → card-pay via Stripe test →
    variation approved → progress request 30% → bank-pay recorded → sign-off
    → final invoice auto-drafts with variation lines → pay → paid-in-full →
    contractor invoice auto-draft → approve → paid + remittance → costs and
    materials reconcile on the Costs tab → console cards appeared and cleared.

**Accept:** both payment paths green in CI · every §2 value in Settings · export re-run produces no duplicate rows · grep audits clean (no client money writes; no arithmetic outside lib/invoicing + lib/pricing).

---

## 9. Definition of done

1. Every dollar on every screen traces to `lib/invoicing/ledger.ts` or a `payments`/`job_costs`/`material_costs` row — no typed or client-computed money anywhere (grep-audited).
2. An issued invoice is immutable; correction paths are void+reissue or credit note, both event-logged; drafts are the only deletable money objects.
3. Card payments are recorded exclusively by the signed, idempotent webhook; the ledger reconciles: adjusted contract = invoiced − credits, paid = Σ payments, balance closes to zero on the e2e job.
4. A variation appears on exactly one issued invoice, enforced by the database.
5. Contractor, customer and staff each see only their view (RLS + `view=` param, proven by tests); the customer path works by token link before the identity layer lands.
6. Both screens are their mockups, breathing real data, on a phone: the job money view, and the /invoicing dashboard whose tiles, filters and aged buckets reconcile to the sum of the job ledgers. The WO console's money strip and "deposit paid" tile read this module and deep-link here.
7. All §2 ⚑s are Settings values; the open ones (2, 4, 5, 9, 11, 16, 18, 19–22 at minimum) are listed in the final PR body addressed to Tom.
8. Job P&L (buildout item 6) can be built from this module's tables without another migration touching money.

— End of brief. If anything here contradicts `acceptance-to-paid-workflow.md` on chase-ladder semantics, that file wins; this file wins on data model and build order. Report the contradiction either way.

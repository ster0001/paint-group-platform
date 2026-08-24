# Build Brief Addendum — Cost Capture (Step 6, expanded)

**Status:** ready to build · supersedes the Materials/Airtable paragraph of Step 6 in `claude-code-brief-invoicing-payments.md`; everything else in that brief stands.
**Rulings made by Tom (24 Aug 2026) — do not re-ask:**

- **Dedicated `bills@paintgroup.com.au` inbound address** is the front door for supplier and trade invoices. Suppliers' trade accounts are pointed at it; staff forward anything else. Zapier/Airtable runs in parallel only as a transition safety net, then retires.
- **Staff purchases:** snap-the-receipt phone flow, ~15 seconds, including who-paid (company card vs personal → reimbursement queue).
- **Contractor expenses:** claimable with receipt photo; **pre-approval required over a threshold** (Settings, default $100); under it, buy-then-claim.

---

## 1. One pipeline, four doors

Every cost enters through the same intake pipeline, whatever the door:

    DOORS                                   PIPELINE                        DESTINATION
    bills@ email (supplier/trade) ──┐
    Staff snap-receipt (phone)  ────┤   cost_intake row: raw doc +      ┌─▶ material_costs
    Contractor expense claim ───────┤─▶ AI-extracted fields + proposed ─┤─▶ job_costs
    Airtable sync (transition) ─────┘   job match → human confirms      └─▶ contractor expense
                                                                            (reimbursement line)

**The AI reads, a human confirms, the ledger records.** Extraction proposes supplier, ABN, invoice number, date, totals, GST, and a job match with confidence — nothing becomes a cost row until a person taps confirm (or the match is exact on order reference, ⚑A1). Same provenance discipline as the plan reader: `ai_extracted` until `human_confirmed`. AI never invents an amount; unreadable documents fail loudly into the queue, never silently to $0.

### 1.1 Data model additions (migrations — Tom pastes between gate runs)

    cost_intake        source: email | photo | contractor | airtable | manual,
                       raw_doc_path (original email/PDF/photo, remediated
                       upload path), message_id (unique — email idempotency),
                       extracted jsonb {supplier, abn, invoice_no, invoice_date,
                       subtotal_ex_cents, gst_cents, total_cents, job_hints[]}
                       + per-field confidence, proposed_vendor_id,
                       proposed_job_id, match_reason: order_ref | address |
                       vendor_memory | none, status: pending | confirmed |
                       rejected | duplicate, confirmed_by, confirmed_at,
                       resulting_row (type + id)
    vendors            + sender_domains text[] (vendor memory: once an email
                       sender is linked, future mail prefills), abn,
                       default_category
    job_costs          + paid_with: company_card | personal | account,
                       reimburse_to (staff member, nullable),
                       intake_id (provenance back to the source doc)
    material_costs     + intake_id; airtable_record_id stays for transition dedupe
    contractor_expenses wo_id, contractor_id, category (Settings list),
                       amount_cents, gst_cents, receipt_path (required),
                       note, preapproval_id (nullable), status: draft |
                       submitted | approved | rejected | paid,
                       invoice_line_ref (set when it rides an invoice)
    expense_preapprovals wo_id, contractor_id, description, cap_cents,
                       status: requested | approved | declined, decided_by/at
    settings           + bills inbound config, expense threshold, claimable
                       categories, duplicate window, auto-confirm toggle (⚑A1)

### 2.1 (§1b) How reading and matching work — and what learns

**Extraction is model-read, not template-read.** The AI reads each document fresh (LLM extraction, per-field confidence) — no layout templates to train or break when a supplier redesigns their PDF. A never-seen vendor extracts as well as a familiar one. Low-confidence fields render as uncertain in the queue; they are never silently guessed.

**Matching memory is vendor-level, not layout-level:** (a) order-reference match is exact and deterministic — it grows as PG-refs propagate onto supplier accounts, never degrades; (b) `vendors.sender_domains` + `default_category` + GST habits are written the first time a sender is confirmed and prefill every email after; (c) add `vendors.extraction_hints jsonb` — optional per-vendor notes (e.g. `{"invoice_no_label": "Docket #"}`) injected into the extraction prompt only for that vendor, set by staff when a vendor consistently misreads.

**Corrections are data.** `cost_intake` already stores proposed vs confirmed (job and vendor). Build a small accuracy readout (last 30 days: % exact-ref, % address-match confirmed unchanged, % corrected) surfaced on the intake queue header — this is the evidence that rules ⚑A1 (auto-confirm) on or off. No self-training beyond these three mechanisms; behaviour stays inspectable.

Duplicate guard: same vendor + invoice number (or same total + date + sender within 7 days) → flagged `duplicate`, never a second cost row. Idempotent by `message_id` for email, by `airtable_record_id` for the transition sync.

---

## 2. Door 1 — `bills@` inbound email

1. **Receiving:** the ⚑16 email provider decision now has a second requirement — **inbound parsing**. Choose a provider that does both send and inbound webhooks (Postmark and Resend both do; either satisfies ⚑16). MX/forwarding for `bills@paintgroup.com.au` → provider → signed webhook `POST /api/inbound/bills` (verify signature; insert `cost_intake` keyed by message_id; store the raw email + attachments via the remediated upload path). No email body is trusted as instructions — it is data to extract from, nothing more.
2. **Extraction:** attachments first (PDF/image), body text as fallback. Job hints harvested from order reference, any job/PO code, and address strings.
3. **Matching, in order:** exact order-reference match (§5) → address fuzzy-match against active jobs → vendor memory (sender domain seen before ⇒ prefill vendor + default category, job still proposed) → unmatched.
4. **Queue:** everything lands in the **Intake queue** (dashboard Payables tab badge + attention card when non-empty). One card per document: extracted fields shown with confidence, proposed job, [Confirm] [Change job] [Reject] [Duplicate]. Confirm writes the destination row with the doc attached.
5. **Supplier onboarding (Tom, not code):** set the invoice email on the Haymes/Dulux trade accounts and regular trades (scaffold, boom, skips) to `bills@`. Until they switch, staff forwarding does the same job.
6. **Transition:** Airtable sync stays on with duplicate detection across both doors; retire the Zap once `bills@` has run clean for a month (⚑A2 owns the switch-off).

## 3. Door 2 — staff snap-receipt (Bunnings et al.)

Global **+ Add cost** on the PC console and job money view, phone-first: camera opens → shutter → AI reads store/date/total/GST while the job picker shows a shortlist (jobs the user is scheduled on today, then active jobs by recency, then search) → category chip → **who paid: company card | my own money** → Save. Target: under 15 seconds; the receipt photo is the record, the extraction is convenience.

`personal` payments open a **staff reimbursement queue** on the Payables tab — same recorded → approved → paid shape as everything else, so nobody's Bunnings run dies in a text message. E-receipts can also just be forwarded to `bills@` (door 1 catches them; who-paid asked at confirm time).

## 4. Door 3 — trade invoices (scaffold, boom, skips)

Arrive by email → they ARE door 1. The vendor-memory rule does the heavy lifting: after the first SkyReach invoice is confirmed once, every future one arrives pre-filled (vendor, category `scaffold`, GST split) with the job proposed from the address in the PDF — confirmation is one tap. Paper dockets handed over on site use door 2's camera flow with vendor picked instead of store. Confirmed trade costs land in `job_costs`, linked to their estimate pass-through line where one exists (existing Step 6 behaviour), and flow into Payables for the recorded → approved → paid march.

## 5. Order references (makes matching exact instead of fuzzy)

Materials ordered through the platform's WO materials section get a printed **order reference: the job code** (e.g. `PG-0087`) placed on the supplier order. Suppliers echo it on the invoice → intake matches exactly, zero taps. Current practice already uses the address as the reference; both matchers run. ⚑A3: add the reference to the supplier trade-account instructions when pointing them at `bills@`.

## 6. Door 4 — contractor Expenses (portal money tab)

New **Expenses** section in the contractor app's money tab:

- **Claim:** camera-first, same 15-second shape — receipt photo (required, no photo no claim), amount, category (Settings list: materials top-up, sundries, parking, tip fees, other), job (defaults to their active job), note. Submitted claims show submitted / approved / rejected / paid states.
- **Pre-approval:** over the threshold ($100 default, Settings) the app requires **Ask first** — a one-tap request (description + rough cost + job) that lands as a PC attention card; approve/decline in one tap; approval shows in the contractor's app with the agreed cap. An over-threshold claim without a pre-approval can still be submitted but is flagged amber to the PC — reality on site beats rules, but it is visible.
- **Payment:** approved expenses append to the contractor's invoice as clearly-labelled **reimbursement lines** (at cost, no markup, itemised on the remittance) — one payment run, no second rail. If the invoice is already paid, they queue for the next one or a standalone reimbursement (PC's call).
- **Job costing:** approved contractor expenses are job costs — they appear in the job's Costs tab under their category with the receipt attached, and count in est-vs-actual. ⚑A4 (accountant): GST treatment of reimbursements for registered vs unregistered contractors.

---

## 7. Screens touched

- **Dashboard Payables tab:** Intake queue section (one card per pending document) + reimbursement queue rows. Attention card: "Intake queue: N documents" (info) — plus the existing materials-unmatched card retires in favour of it.
- **Job money view → Costs tab:** every cost row shows its source chip (bills@ / receipt / contractor / airtable) and taps through to the original document.
- **Contractor portal money tab:** Expenses section per §6.
- Mockup: `design/reference/cost-capture-mockup.html` (intake queue · snap receipt · contractor expenses) — build to it.

## 8. Build order (replaces Step 6's materials scope; trade/vendor scope of Step 6 stands)

**6a — Pipeline + intake queue:** `cost_intake` migrations, `/api/inbound/bills` webhook (signature, idempotency, storage), extraction behind an interface (rule-based fields + AI extraction; AI proposes only), matching ladder (§2.3), intake queue UI on Payables, duplicate guard, Airtable transition sync writing through the same pipeline. E2e: an emailed PDF lands, proposes, confirms into `job_costs` with the doc attached; the same email replayed is a no-op; an unreadable attachment queues with a "couldn't read this" state, never $0.

**6b — Snap receipt + reimbursements:** the + Add cost camera flow, who-paid, staff reimbursement queue. E2e AS STAFF on a phone viewport: receipt → job → save in ≤ 4 taps after the photo; personal payment appears in the reimbursement queue.

**6c — Contractor expenses:** portal Expenses section, pre-approval flow + threshold, PC approval cards, reimbursement lines on the contractor invoice + remittance, costs land on the job. E2e AS THE CONTRACTOR (claim under threshold; ask-first over threshold) and AS PC (approve both; see the line on the invoice and the cost on the job).

**Accept (all):** no cost row exists without a source document attached · AI-extracted values are never final without human confirm (or exact order-ref match with ⚑A1 ON) · duplicates cannot create two rows · every queue empties into the same recorded → approved → paid march · grep: no money arithmetic outside lib/invoicing.

## 9. ⚑ Open decisions

| ⚑ | Decision | Default until ruled |
|---|---|---|
| A1 | Auto-confirm on exact order-reference match (no human tap)? | OFF — everything confirmed by a human for the first month, then revisit |
| A2 | When to retire the Zapier/Airtable path | After one clean month of bills@; Tom flips the switch |
| A3 | Order-reference scheme on supplier accounts (job code on every order) | `PG-<job number>`; added when trade accounts are pointed at bills@ |
| A4 | GST treatment of contractor reimbursements (registered vs not) | At-cost, itemised; ⚑ accountant to confirm before first payment run |
| A5 | Claimable expense categories + threshold | materials top-up, sundries, parking, tip fees, other · $100 · Settings |
| A6 | Who may confirm intake documents | Any staff; approval of the resulting payable stays PC/Tom |

— End of addendum. ⚑16 (email provider) must be settled with inbound parsing in scope before 6a can go live; 6a can be built and tested against the provider's webhook simulator in the meantime.

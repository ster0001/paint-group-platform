# Subcontractor agreement in the contractor portal — read, sign, keep (brief Steps 1–7)

The Independent Contractor Agreement lives in the portal. A contractor's trading name, ABN and address fill it in; they read it on their phone, tick, sign with a finger and get the countersigned PDF back by email and under Profile → Subcontractor agreement. Contractors who signed on paper get that copy uploaded by the office and are not asked again. Job offers wait for a signed, unexpired agreement, the way they wait for insurance and the induction. Nothing here is new machinery: it is the induction pattern (document as data, one writer RPC, a definer gate mirrored in TypeScript, the one work queue) applied to one more document.

## What is in it

- **Step 1 — the document as data.** `docs/agreements/subcontractor-agreement-v1.md` is the corrected docx (21 Oct) converted clause by clause with explicit numbering (so "3.5(d)", "clause 13.3" and the rest stay true) and `{{merge}}` tokens where the docx has blanks. The docx and the original as received sit in `docs/agreements/source/`. `lib/agreements/source.ts` parses the loader format into blocks and lifts Schedules A–O out as data; the merge-field set is closed and every field must be used. `source.test.ts` pins the wording by SHA-256: a changed word without a version bump fails CI. `scripts/seed-agreement.ts` loads `agreement_versions` and reads back; it refuses to rewrite a version a contractor has signed.
- **Step 2 — tables, RPCs, the gate** (`20270285`). `contractor_agreements`: one `status = signed` row per contractor (unique partial index), the merge snapshot, the drawn signature's path, IP, user agent, the hash of the wording as read, the countersignature, Schedule D and M. Writers: `agreement_sign` (the contractor's session; profile checked, idempotent per version, countersigned in the same transaction, a renewal supersedes), `agreement_upload` (staff, a paper copy), `agreement_attach_pdf` (once). `agreement_request` starts the grace window. `agreement_gate_of` — ok | agreement_unsigned | agreement_expired — is a definer helper with no grant, mirrored word for word by `agreementGateOf` (test-pinned). `contractor_doc_kind` gains `agreement`.
- **Step 3 — one renderer, the PDF once, the emails.** `render.ts` draws the page and the PDF from the same blocks (the test renders both and compares the text). `pdf.ts` renders once from the snapshot with the drawn PNG and the company signature from private storage; `notify.ts` emails the copy to the contractor and the office through the dispatcher (three registry entries with editable templates).
- **Step 4 — the portal.** `/portal/agreement`: a blank trading name, ABN or address sends them to Profile with the fields named; otherwise the document with their details in, the sign form asleep until the end has scrolled into view, then tick · name · SignaturePad · Sign. Signed: their copy, Download PDF through a session-scoped route (another contractor's id is a 404). Profile's Subcontractor agreement card; Home's reminder tile (Required when offers wait; Renew a month before expiry).
- **Step 5 — the office.** Contractors list: an Agreement line per contractor with Request signature. Record page: the line, the gate word, Download signed copy, Request signature, Add signed agreement (PDF/JPG/PNG + date signed + version or Pre-portal). Unsigned and expiring agreements are work items from the one queue (`buildAgreementItems` over `agreement_statuses`, never stored); the Contractors view carries an **Agreement not signed** tag and the dashboard a `contractors.agreement_unsigned` metric.
- **Step 6 — the gate** (`20270286`). `send_offer` and the `booking_offers` trigger read `agreement_gate_of` after the induction gate, nowhere else. Everyone on the books when `20270285` ran is `agreement_kind = existing`: offers flow until Request signature starts the grace window (`settings.agreement_rules.graceDays`, **14 — ruling 14 pending**). A new contractor's offers wait from the start.
- **Step 7** — help for contractor, staff and PC (`docs/help/agreement/`), the ARCHITECTURE paragraph, `docs/testing/subcontractor-agreement-manual.md`.

## Proof

- Unit: 3,901 tests green, including the wording pin, parse refusals, the page-equals-PDF text comparison, the gate mirror, the words, the work items and the view tag.
- `e2e/agreement.spec.ts` on C1 — **6 of 6 passed, 31 s, 21 Oct 2026**: a fresh contractor — blank ABN → Profile with the field named; reads it with their details in place; the form wakes only at the end; tick, sign, submit → exactly one row (snapshot, audit fields, countersignature, Schedule M = +12 months), one document row, the PDF in the bucket within 30 s and it opens, the `agreement_pdf_sent` event; a second tap → `exists`; `agreement_attach_pdf` → `pdf_immutable`; another contractor's download → 404 and `agreement_status` → null; the office reads it; a customer and anon read nothing. The office: an existing contractor reads *not asked yet*, Request signature → the events and *offers stop [date]*; grace in the past → `agreement_gate_of` = `agreement_unsigned` and a `booking_offers` insert raises the same word; the paper upload → `Uploaded · 3 Mar 2026`, the row (source uploaded, version null, expiry +12 months), the document row, the gate back to ok; the contractor sees **Signed · signed on paper**, downloads it, and is not asked to sign.
- Lint with the CI ceiling, typecheck, `help:index --check` green.

## For Tom — production, in this order

1. **Paste** `supabase/migrations/20270284000000_agreement_versions.sql`, then `20270285000000_contractor_agreements.sql`, then `20270286000000_agreement_offer_gate.sql` (each starts with `set lock_timeout`; each ends with the read-back and its ledger row — compare the `_expect_` columns before moving on). `20270285` marks every contractor on the books as `existing`, so nobody's offers change on the day it lands.
2. **Seed** from the main checkout: `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-agreement.ts --prod` → `1 version(s) on the table · current version 1 · read-back equals the files ✓`.
3. **Read the ledger** (`_prod_migrations` for the three names) before merging — "sql done" is a claim, the row is the proof.
4. **Optional but worth it:** upload a transparent PNG of your signature to the private `contractor-docs` bucket at `company/signature-tom.png`. Until it is there the countersignature is applied as typed text and the PDF footer says so.
5. Then the manual test in `docs/testing/subcontractor-agreement-manual.md`.

## Decisions still yours (⚑, flagged, not invented — the brief's §11)

- **⚑14 grace window** — built as 14 days (`agreement_rules.graceDays`); change the setting if you want longer.
- **⚑3 address** — the one `address` on the profile is printed as Schedule B "of …".
- **⚑4 Key Personnel** — the text still refers to Schedule B for Key Personnel and Schedule B carries none, exactly as the docx; nothing invented.
- **⚑7 GST line** — not added to Schedule B; `gst_registered` is kept in the snapshot for when you decide.
- **⚑8 entity type** — one document, "Pty Ltd" wording, for everyone.
- **⚑9 legal check** — ten minutes with your lawyer on e-signature and the template fixes before go-live.
- **⚑11 paper copies** — who scans and uploads; the Contractors list and the queue show who is missing.
- **⚑12 re-sign on a material change** — not built; a new version is seeded beside v1 and the next signature uses it.
- **⚑13 Attachment B** — Schedule H still names the NSW statement that is not in the document (left as the docx has it).
- Clause 14 cites "8.5", which the document does not have; and clause 9.1 was split across two lines in the docx — joined here as one paragraph (formatting, not wording).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

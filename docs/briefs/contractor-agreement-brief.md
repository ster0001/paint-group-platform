# Claude Code brief — Subcontractor agreement in the contractor portal

**Status:** rulings locked by Tom 21 Oct 2026 (see §11) — ready for Claude Code
**Source document:** `Independent_Subcontractor_Agreement_Pty_Ltd_v1.docx` (the corrected template, 21 Oct 2026 — typos fixed, Schedule E reworded, H&S appendix removed). Copy it to `docs/agreements/source/`. The original as received is `Independant_Subcontractor_Agreement_Pty_Ltd_4_.docx`; keep it beside it for the record.
**Reads with:** `docs/induction/induction-v1.md`, the induction / demo-property brief, the standards / status / call backs brief.

---

## 1. What Tom wants, in one paragraph

The Independent Contractor Agreement (ENLVN Pty Ltd t/as Paint Group ↔ the contractor) lives inside the contractor portal. The details the contractor has already typed into the portal — business name, ABN, address, the person signing — fill the agreement in for them. They read it on their phone, sign it on the screen, and from then on they can see and download their signed PDF in the portal. Contractors who are already on the books and signed on paper get their signed copy uploaded by Paint Group, so everyone ends up with the same thing on file. New contractors do it through the portal whether or not they have "the app" installed — the portal is a web page, so the invite link works in any phone browser.

## 2. How it fits what is already built (read before designing)

Nothing here is new machinery. It is the induction pattern applied to one more document.

| Need | Already in the repo | Use it for |
|---|---|---|
| A document that is data, versioned, with one wording authority | `docs/induction/induction-v1.md` → `scripts/seed-induction.ts` → `induction_versions` | The agreement text becomes `docs/agreements/subcontractor-agreement-v1.md` with merge fields, seeded into `agreement_versions` the same way |
| The contractor's details | `contractors.company_name, abn, gst_registered, address`, `profiles` name/phone/email (portal Profile form, `app/portal/profile/ProfileForm.tsx`) | The merge fields |
| Signing on a phone | `app/components/SignaturePad.tsx`, and `wo_signoff` (`signed_name`, `signature`, `signed_at`) — the customer already signs job completion on the painter's phone | The contractor's signature on the agreement, same component, same storage shape |
| HTML → PDF | `renderHtmlToPdf` in `lib/invoicing/pdf.ts` (headless Chromium; used by `lib/induction/notify.ts` for the induction PDF) | Render the signed agreement once, store once, never regenerate |
| Somewhere private to keep it | `contractor-docs` bucket (private, signed URLs) + `contractor_documents` (`kind` enum: insurance, licence, workcover, other) | Add `kind = 'agreement'`; the PDF sits beside their insurance certificate |
| Showing it to the painter | Portal Profile → Documents (where insurance / WorkCover already show as Valid / Missing) | A "Subcontractor agreement" card: Signed on date · Download PDF, or "Sign now" |
| Staff view and uploads | PC Command → Contractors → `[id]` (documents section) | Upload a scanned signed agreement for an existing contractor; see who has / hasn't signed |
| Gating job offers | `induction_gate_of(contractor)` read by `send_offer` and the `booking_offers` trigger | Add "agreement signed and unexpired" to the same gate (ruled: yes) |
| Telling people something is outstanding | `lib/crm/work-queue.ts` (one work queue, derived from facts) | "Agreement not signed" and "Agreement expires in 30 days" are work items, never a new list |
| Emailing a PDF | `lib/induction/notify.ts` pattern (attach PDF, record a `contractor_events` row) | Email the signed copy to the contractor, cc the office |

## 3. The contractor's experience

### New contractor (portal, phone)
1. Invite text/email → opens the portal link in the browser (no install needed; same as today's `contractor_invites` flow).
2. Account + Profile (already Module 1 of the induction): name, mobile, business name, ABN, GST yes/no, address, bank details, number of painters.
3. **New step — "Your agreement".** One screen: "Read and sign your subcontractor agreement. Your details are already filled in." The agreement renders as a scrolling page with their details in place. The schedules show in plain boxes at the top (Date, Business name, Address, Commencement date, Services, Insurance minimum, Expiry) so the important bits are visible before the legal body.
4. At the bottom, after they have scrolled to the end: a tick "I have read this agreement and I am authorised to sign for [business name]", their name (pre-filled, editable), the signature pad, **Sign**.
5. Confirmation: "Signed. A PDF copy is on its way to [email] and is in your Documents." The PDF is rendered server-side from the same HTML they just read, with signature image, name, date/time (Melbourne), and an audit footer (version, IP, user agent, document hash).
6. Profile → Documents now shows **Subcontractor agreement · Signed 21 Oct 2026 · v1 · Download PDF**.

If they skip it: the Documents card shows **Not signed · Sign now**, the home screen shows the same reminder tile that already nags for missing insurance, and the office sees it in the work queue. **Job offers wait until it is signed** (ruled), exactly as they wait for insurance and the induction.

The Company's side is signed automatically: Tom's signature image, name and title are applied at the moment the contractor signs, so the PDF is final immediately (ruled). The signature image lives in private storage (`contractor-docs/company/signature-tom.png`), never in the repo.

### Existing contractor (already on paper)
- Paint Group scans the signed paper copy and uploads it in PC Command → Contractors → [name] → Documents → **Add signed agreement** (PDF/JPG, date signed, version or "pre-portal"). It lands in the same `contractor_documents` row shape with `source = 'uploaded'`.
- The contractor sees exactly the same card: **Subcontractor agreement · Signed 3 Mar 2026 · Download**. They are not asked to sign again.
- Existing contractors who never signed anything simply get the "Sign now" card — the refresher session (Module 0) is a natural moment to do it on their phone.
- **Invites can also go to contractors who already have the app** (ruled): "Request signature" in PC Command sends the same portal link to an existing account, and the invite date on that request is the Commencement Date for their agreement.

### Renewal
Schedule M says the agreement expires 12 months from Commencement. 30 days before expiry a work item appears for the office and a "Your agreement is due for renewal" card for the contractor; signing again creates a new `contractor_agreements` row against the current version. Old signed copies stay visible as history.

## 4. Data model

```
agreement_versions
  id, version int unique, effective_from date, body_md text,   -- the whole document with {{merge}} fields
  schedules jsonb,                                              -- fixed schedule values (C=VIC, E, F, G, I-O) so they are data, not prose
  created_at

contractor_agreements
  id, contractor_id → contractors, version → agreement_versions.version,
  source text check (source in ('portal','uploaded')),
  status text check (status in ('draft','signed','superseded','void')),
  merged jsonb,                 -- SNAPSHOT of every merge field at signing (name, company, ABN, address, GST, commencement, expiry…)
  signed_name text, signature text (data URL / png in bucket), signed_at timestamptz,
  signed_ip inet, signed_user_agent text, body_sha256 text,     -- audit trail
  countersigned_name text, countersigned_at timestamptz,        -- set by agreement_sign in the same transaction (auto-countersign)
  pdf_path text,                                                -- contractor-docs/<contractor_id>/agreements/v<version>-<signed_at>.pdf
  expires_on date,                                              -- commencement + 12 months (Schedule M)
  uploaded_by uuid, uploaded_at timestamptz,                    -- when source='uploaded'
  created_at
  unique (contractor_id, version, signed_at)
```

- `contractor_documents` gets `kind = 'agreement'` (enum value added, like `workcover` was) and a nullable `contractor_agreement_id` so the Documents card is one query.
- **One writer.** Rows are written only by RPCs: `agreement_sign(p_version, p_signed_name, p_signature)` (contractor session; validates the contractor's profile is complete, takes the snapshot, writes `signed_at = now()`, returns the id) and `agreement_upload(p_contractor_id, p_file_path, p_signed_on, p_version)` (staff). No route sets `status` directly (CLAUDE.md state-machine rule).
- The PDF is attached exactly once (`agreement_attach_pdf`, same immutability as `invoice_attach_pdf`): a failed render is retried, a succeeded one is never replaced.
- RLS: contractor reads own rows; staff reads all; nobody updates a signed row except `status → superseded` by the next signature. Policies ship in the same migration file; the migration ends with the read-back `select` and the `_prod_migrations` insert.
- `expires_on` and "unsigned" are **facts**; the work queue derives items from them — no `agreement_reminders` table.

## 5. The merge fields — what the data has and what it does not

| Agreement field | Where it comes from | Have it today? |
|---|---|---|
| Date of Agreement (Schedule A) | `signed_at`, Melbourne date | ✅ |
| Contractor name / Business name (cover, Schedule B) | `contractors.company_name` | ✅ |
| ABN (cover, Schedule B) | `contractors.abn` | ✅ (validate 11 digits + checksum before signing) |
| Address (Schedule B "of") | `contractors.address` | ✅ — ⚑3 registered vs postal |
| Name in block letters / authorised representative | `profiles.full_name` of the signing login | ✅ |
| Key Personnel (Definitions C, Schedule B) | the contractor's workers (`contractor_users`) | ⚠️ partly — ⚑4 |
| Commencement Date (Schedule D) | the invite date — `contractor_invites.created_at` for new contractors, or the date of the "Request signature" invite for existing ones (ruled) | ✅ |
| Expiry (Schedule M) | commencement + 12 months | derived |
| Contract Fee (Schedule E) | fixed text in the template: "As set out on each work order the Contractor accepts in the Paint Group portal (exclusive of GST)" (ruled) | ✅ |
| Company signatory (Tom), date | applied automatically at signing (ruled) | ✅ |
| GST status | `contractors.gst_registered` | ✅ — not in the template today; worth a line in Schedule B (⚑7) |
| ACN / entity type (Pty Ltd vs sole trader) | — | ❌ ⚑8 |

Everything else in the document is fixed text or a fixed schedule value and comes from `agreement_versions.schedules`.

## 6. Rendering and signing — the mechanics

- `lib/agreements/render.ts`: `renderAgreementHtml(version, merged)` → one HTML string from `body_md` + schedules + merge values. The same function drives the portal page and the PDF, so what they read is what gets locked (the §6.7 principle in `lib/invoicing/pdf.ts`).
- Merge fields are `{{contractor.company_name}}`-style tokens; the renderer **fails** on an unresolved token rather than printing a blank — a blank ABN on a signed contract is worse than an error.
- The portal page is `/portal/agreement`: server component renders the HTML; a small client island holds the scroll-to-end check, the tick, the name field and `SignaturePad`; `agreement_sign` is a server action with zod validation; on success it kicks the PDF render + email (same shape as `lib/induction/notify.ts`), then redirects to Documents.
- Signature stored as PNG in `contractor-docs/<contractor_id>/agreements/signature-<id>.png`, embedded in the PDF; the PDF carries name, date/time, IP, user agent, version and the SHA-256 of the rendered HTML in a footer on the signing page.
- Electronic signatures are recognised in Victoria (Electronic Transactions (Victoria) Act 2000) when the signer is identified, consents, and the method is reliable — the login, the tick, the drawn signature and the audit footer are that evidence. I am not a lawyer; a 10-minute check with yours is worth it before go-live (⚑9).
- Language: the agreement is signed in **English only**. The induction's translated tick wording does not extend to a legal document (ruling I8 keeps the app English). If a contractor cannot read it, that is a conversation at the induction, not a translation feature.

## 7. Staff side (PC Command → Contractors)

- Contractors list: an **Agreement** column — Signed v1 · 21 Oct / Uploaded · 3 Mar / **Not signed** / Expires 12 Feb.
- Contractor page → Documents: the agreement card with Download, plus **Add signed agreement** (upload) for pre-portal contractors, and **Request signature** (sends the portal link by SMS/email — reuse the invite messaging).
- Home dashboard Contractor tiles: count of unsigned agreements reads the same facts (via `lib/painterStatus/contractorsView.ts`-style read model, not a new count).

## 8. Template changes — done in `Independent_Subcontractor_Agreement_Pty_Ltd_v1.docx` (21 Oct 2026, on Tom's instruction)

1. Typos fixed: "for an on behalf of" → "for and on behalf of" (both signing blocks); "Contracto" → "the Contractor" (Attachment A); stray ")" after the ABN on the cover removed; file renamed "Independent".
2. Schedule E now reads: "Contract Fee: As set out on each work order the Contractor accepts in the Paint Group portal (exclusive of GST)".
3. The **Health & Safety and Induction Process** appendix is removed — the induction covers it (ruled). The document is 18 pages.
4. Still to do in the portal render, not the docx: the signing page lists "Date signed" twice and "Name (in block letters)" with no field — the portal replaces that block with Signature · Name · Date for the Contractor, and the Company's auto-applied signature · name · date.
5. Noticed, not changed: Schedule H refers to an **Attachment B (NSW Sub-Contractor's Statement)** that is not in the document. Schedule C is VIC and Schedule O is Melbourne, so either drop the NSW row from Schedule H or add Attachment B before v1 is seeded (⚑13).
6. Attachment A (invoice declaration) stays. Whether the portal invoice should capture it at submit is a separate small feature — not in this brief.

## 9. Build order (one PR per step, each mergeable on its own)

1. **Document as data.** Convert the docx to `docs/agreements/subcontractor-agreement-v1.md` with merge tokens and a `schedules` block; `scripts/seed-agreement.ts`; migration `agreement_versions` + seed. A test fails on an unresolved token.
2. **Tables + RPCs.** `contractor_agreements`, `contractor_doc_kind += 'agreement'`, `agreement_sign`, `agreement_upload`, `agreement_attach_pdf`, RLS, grants, read-back select, `_prod_migrations` row.
3. **Render + PDF.** `lib/agreements/render.ts`, `lib/agreements/pdf.ts` (uses `renderHtmlToPdf`), `lib/agreements/notify.ts` (email + `contractor_events`).
4. **Portal.** `/portal/agreement` page + sign action; Documents card; home-screen reminder tile; onboarding step after Profile.
5. **PC Command.** Agreement column, upload for existing contractors, request-signature button; work-queue source for unsigned / expiring.
6. **Gate.** Extend `induction_gate_of` (or a sibling `agreement_gate_of` read in the same two places) — mirrored in `lib/induction/status.ts` and test-pinned like the induction gate.
7. Help files for painter and staff (`docs/help/agreement/*.md`), `docs/ARCHITECTURE.md` paragraph, manual test script.

## 10. Acceptance criteria

- A new contractor with a complete profile can open `/portal/agreement` on a phone, see their business name, ABN and address already in the document, scroll to the end, tick, sign and submit in under two minutes; a contractor with an incomplete profile is sent to Profile first with the missing fields named.
- Signing writes exactly one `contractor_agreements` row (status `signed`, snapshot populated, audit fields populated) and exactly one `contractor_documents` row (`kind = 'agreement'`); a second tap cannot create a second row.
- The PDF exists in `contractor-docs` within 30 seconds, opens on an iPhone and Android, shows the signature, name, date/time (Melbourne) and the audit footer, and matches the HTML the contractor read (same render function — pinned by a test that renders both and compares text).
- The contractor receives the email with the PDF attached; a `contractor_events` row records it.
- Documents card shows Signed · date · Download for both portal-signed and staff-uploaded agreements; Download uses a short-lived signed URL; another contractor's URL returns 404 (RLS proven through the contractor role in e2e, never the service key).
- Staff can upload a signed PDF for an existing contractor with a signed-on date; it appears to that contractor immediately.
- Unsigned agreements and agreements expiring within 30 days appear as work items from `lib/crm/work-queue.ts`; no separate list anywhere.
- `send_offer` refuses for a contractor with no signed, unexpired agreement with the same error shape as the induction gate, and the e2e `induction-room` spec gains the case.
- A change to `subcontractor-agreement-v1.md` without a version bump fails CI (hash check), the same way the induction wording is protected.
- No demo-property row, no customer, and no worker login can read an agreement (`lib/demo/boundary.test.ts` extended).
- `npx eslint --max-warnings 4 .`, typecheck, unit and the customer-journey e2e stay green; the help files exist for painter and staff.

## 11. Decisions for Tom (⚑ — flagged, not invented)

**Ruled 21 Oct 2026:** ⚑1 offers wait for a signed agreement (yes). ⚑2 Tom's signature is applied automatically. ⚑5 Commencement Date = the invite date; invites can also be sent to contractors who already have the app. ⚑6 Schedule E reworded as above. ⚑10 H&S appendix removed. Template typos fixed on Tom's behalf.

One implementation note on ⚑1: existing contractors are on the books today with no signed agreement in the system, so the gate would stop their offers the day it ships. Give them a grace window (suggest 14 days from the "Request signature" invite) and list them in the work queue — otherwise the first morning is a phone-call storm. **Tom to confirm the grace length (⚑14).**

Still open:
- **⚑3 Address.** The template says "of Address". Is that registered office or postal/trading address? The portal holds one `address` today.
- **⚑4 Key Personnel.** Schedule B lists Key Personnel. Pre-fill from the contractor's workers in the app, leave it to the contractor to type, or drop the schedule (the induction already binds every worker)?
- **⚑7 GST line.** Add "GST registered: Yes/No" to Schedule B so the RCTI / GST-on-top rules and the contract agree?
- **⚑8 Entity type.** The file is the "Pty Ltd" version. Do sole traders get the same document with ACN blank, or a second version? (One document with "Entity: Pty Ltd / Sole trader" is simplest.)
- **⚑9 Legal check.** Ten minutes with your lawyer on e-signature and the template fixes in §8.
- **⚑11 Pre-portal copies.** Who scans and uploads the existing paper agreements, and by when? (Each is a 30-second upload; the work item will list who is missing.)
- **⚑13 Attachment B.** Schedule H names an NSW attachment that is not in the document — drop the row or supply it.
- **⚑14 Grace window** for existing contractors before the offer gate bites (suggest 14 days).
- **⚑12 Versioning.** When the wording changes materially, do existing contractors re-sign (like the induction's "re-tick that module") or only at renewal?

## 12. Reference files

- `docs/agreements/source/Independent_Subcontractor_Agreement_Pty_Ltd_v1.docx` — the corrected template to seed from; `…_4_.docx` is the original as received.
- `docs/induction/induction-v1.md`, `scripts/seed-induction.ts`, `lib/induction/source.ts` — the document-as-data pattern to copy.
- `lib/induction/notify.ts`, `lib/induction/pdfHtml.ts` — PDF + email + event pattern.
- `lib/invoicing/pdf.ts` — `renderHtmlToPdf`, immutability rules.
- `app/components/SignaturePad.tsx`, `supabase/migrations/20261006000000_wo_signoff.sql` — signing on a phone.
- `supabase/migrations/20260822000000_contractor_portal_phase_a.sql`, `20260823010000_contractor_docs_bucket.sql`, `20270160000000_contractor_doc_kind_workcover.sql` — documents table, bucket, enum extension.
- `supabase/migrations/20270270000000_induction_signoff.sql` — `induction_gate_of`, the gate to extend.
- `app/portal/profile/ProfileForm.tsx`, `app/portal/DeferCertificates.tsx` — the fields and the "add later" pattern.
- `app/(app)/contractors/[id]/page.tsx` — where staff upload and see documents.
- `lib/crm/work-queue.ts` — the one work queue.
- `CLAUDE.md` — RLS, one-writer, migration read-back and `_prod_migrations` rules apply in full.

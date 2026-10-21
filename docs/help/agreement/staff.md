---
feature: agreement
role: staff
title: Subcontractor agreements — who has signed, Request signature, upload a paper copy
summary: Contractors sign the Independent Contractor Agreement in the portal with their details filled in; the countersigned PDF is on their record under Documents and the office gets a copy by email. Contractors shows an Agreement line per contractor (Signed v1 · date, Uploaded · date, Not signed, Expires …) with Request signature; the contractor record has the same plus Download signed copy and Add signed agreement for contractors who signed on paper. Job offers refuse (error agreement_unsigned or agreement_expired) until a signed, unexpired agreement is on file. Everyone on the books before the feature keeps their offers until you tap Request signature, which starts a grace window (14 days, Settings → agreement_rules.graceDays) before offers stop.
sources: app/(app)/contractors/page.tsx, app/(app)/contractors/ContractorsManager.tsx, app/(app)/contractors/[id]/page.tsx, app/(app)/contractors/[id]/ContractorAgreement.tsx, app/(app)/contractors/actions.ts, lib/agreements/status.ts, lib/agreements/notify.ts, lib/crm/work-queue.ts, lib/painterStatus/contractorsView.ts, lib/reporting/metrics/contractors.ts, supabase/migrations/20270285000000_contractor_agreements.sql, supabase/migrations/20270286000000_agreement_offer_gate.sql
---

## What this is for
One place to see who has a current subcontractor agreement, to ask a contractor to sign, and to file the paper copies of contractors who signed before the portal existed. The words themselves are version 1 of `docs/agreements/subcontractor-agreement-v1.md` (the corrected docx of 21 Oct 2026); a changed word is a new version, never an edit.

## Before you start
- The contractor has a portal login (an accepted invite). A contractor with a blank trading name, ABN or address is sent to Profile first when they open the agreement.
- For a paper copy: the scan or photo (PDF, JPG or PNG, up to 15 MB) and the date it was signed.
- Settings → `agreement_rules` holds the grace window (`graceDays`, 14), the renewal warning (`renewalWarnDays`, 30), the term (`termMonths`, 12) and the signatory (Tom Roman, Director). Only the office changes these.

## Steps
1. **See where everyone is.** Contractors → each row carries **Agreement: …** under the insurance line. Employed painters have no agreement line; they are covered by Paint Group's own agreement.
2. **Ask a contractor to sign.** Tap **Request signature** on the row (or on their record). They get a text and an email with the portal link; the row reads *asked [date], offers stop [date]*. For a contractor who was on the books before the feature, this is what starts the clock: until you ask, their offers keep flowing. Asking again resets the grace window and the commencement date on the agreement they will sign.
3. **A new contractor** signs it as part of joining: their Home shows the reminder with the **Required** chip, and job offers refuse until it is in. You do not need to ask; you can, if they are slow.
4. **File a paper copy.** Open the contractor's record → **Subcontractor agreement** → **Add a signed agreement (paper copy)**: the date signed, the version (Version 1, or *Pre-portal* when the paper one predates it), the file, then **Add signed agreement**. The row shows **Uploaded · date**, the contractor's Documents card shows **Signed · signed on paper**, and offers flow. It supersedes anything on file; the earlier copy stays as history.
5. **Read or download a signed copy.** Contractor record → **Download signed copy** (a ten-minute link to the private bucket). The portal-signed PDF carries both signatures, the name, time, IP, device and the document hash; an uploaded one is the scan as filed.
6. **The office copy.** Every portal signature emails the PDF to the office address (Automations → *Subcontractor agreement signed (office copy)*) as well as to the contractor.
7. **Renewals.** The agreement runs twelve months from its commencement date. From a month before expiry the contractor is asked in the portal to sign the new term; after the date, offers refuse until they do. The queue carries **Agreement expiring** until it is signed.

## What the colours and labels mean
- **Signed v1 · date** (green) — signed in the portal, current.
- **Uploaded · date** (green) — a paper copy on file, current.
- **Signed v1 · expires date** / **Uploaded · expires date** (amber) — inside the renewal window.
- **Not signed · not asked yet** (amber) — an existing contractor you have not asked; offers still flow.
- **Not signed · asked date, offers stop date** (amber) — the grace window is running.
- **Not signed · asked date · no offers** / **Not signed · no offers** (red) — the gate is on; `send_offer` answers `error:agreement_unsigned`.
- **… expired date · no offers** (red) — the agreement has ended; `error:agreement_expired`.
- **Agreement not signed** — the tag on PC Command → Contractors and the dashboard's *Agreement not signed* count; it reads the same facts as the gate.
- **Agreement not signed** / **Agreement expiring** on Today and PC Command — the work items; Request signature, an upload or the next signature clears them.

## If something goes wrong
- **"They already have a signed, current agreement"** — Request signature only applies to a contractor with nothing current on file. To replace a current one, wait for the renewal window or upload the new paper copy.
- **The upload is refused** — the file is not a PDF/JPG/PNG, is over 15 MB, or the date signed is in the future. Nothing is recorded until the file is stored and the row written in one go.
- **A job offer answers `agreement_unsigned`** — the contractor has no signed, unexpired agreement and their grace window (if any) has run out. Open their record: Request signature, or Add signed agreement.
- **The Agreement line is missing on every row** — the page says *Couldn't read who has signed the subcontractor agreement*. The read failed (reported to the error monitor); reload, and if it persists check migration 20270285 is live (`_prod_migrations`).
- **A contractor says the agreement shows a wrong ABN or address** — it is filled in from their profile at the moment they open it. Fix the profile (theirs or yours on the record), then they reload; the signed snapshot on the row is what they saw when they signed.

## Related
- [Contractor: signing in the portal](./contractor.md)
- [PC Command: the queue items](./pc.md)
- [Finish standards sign-off](../standards/staff.md) and [the induction](../induction/staff.md) — the other two gates on job offers.

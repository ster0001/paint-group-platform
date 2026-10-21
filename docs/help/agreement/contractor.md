---
feature: agreement
role: contractor
title: Your subcontractor agreement — read it on your phone, sign on the screen, keep the PDF
summary: The Independent Contractor Agreement between ENLVN Pty Ltd (Paint Group) and your business lives in the portal. Your trading name, ABN and address are already filled in from your profile. Read it through, tick, sign with your finger and tap Sign; a PDF copy with Paint Group's countersignature is emailed to you and kept under Profile → Subcontractor agreement, where you can download it any time. Job offers wait until it is signed. It runs for twelve months; a month before it ends the portal asks you to sign the new term. If you signed on paper before the portal, the office uploads that copy and you are not asked again.
sources: app/portal/agreement/page.tsx, app/portal/agreement/SignForm.tsx, app/portal/agreement/actions.ts, app/portal/agreement/pdf/route.ts, app/portal/profile/ProfileForm.tsx, app/portal/page.tsx, lib/agreements/render.ts, lib/agreements/status.ts, lib/agreements/pdf.ts, lib/agreements/notify.ts, docs/agreements/subcontractor-agreement-v1.md, supabase/migrations/20270284000000_agreement_versions.sql, supabase/migrations/20270285000000_contractor_agreements.sql, supabase/migrations/20270286000000_agreement_offer_gate.sql
---

## What this is for
Every contractor signs one Independent Contractor Agreement with Paint Group. Instead of a printed document and a scanner, you read it in the portal with your own details already in place, sign it on your phone, and get the signed PDF straight back. Paint Group cannot send you a job offer until it is signed, the same way they cannot until your public liability insurance is on file.

## Before you start
- Your profile has your trading name, your 11-digit ABN and your business address (Profile → Company details). The agreement is filled in from these, so it refuses to open until they are in.
- Your name as it should appear on the agreement. It is pre-filled from your login and you can change it on the signing screen.
- Nothing else. There is no app to install; the portal link in your invite text opens it in any phone browser.

## Steps
1. **Open it.** From Home tap **Read and sign your subcontractor agreement** in the action list, or Profile → **Subcontractor agreement** → **Sign now**.
2. **Check the boxes at the top.** Date of agreement, your business and ABN, commencement date, expiry, the contract fee line, the services and the public liability minimum are shown first, before the legal text.
3. **Read it through.** Scroll to the end. The signing section stays asleep until the end of the document has been on your screen.
4. **Tick** *I have read this agreement and I am authorised to sign for [your business]*.
5. **Your name** is filled in; correct it if it should read differently on the agreement.
6. **Sign** with your finger in the box. Tap **Clear** to start again.
7. **Tap Sign.** The screen says **Signed** and that the PDF copy is on its way to your email. Paint Group's signature is applied at the same moment, so the PDF is final straight away.
8. **Your copy.** Profile → **Subcontractor agreement** shows **Signed** with the date and version, and **Download PDF**. The PDF carries both signatures, your name, the date and time (Melbourne), and an audit line with the document's hash.
9. **Renewal.** The agreement runs for twelve months from your commencement date. A month before it ends, Home shows **Your subcontractor agreement is due for renewal** and the Subcontractor agreement card reads **Due for renewal** → **Renew now**. Signing again works the same way; the earlier copy stays under **Earlier copies**.

## What the colours and labels mean
- **Required** (amber chip on the Home action) — not signed, and job offers are waiting on it.
- **To do** (amber chip) — not signed, but the office has not started the clock yet; sign it this week.
- **Not signed** (amber chip on the Profile card) — nothing on file. **Sign now** opens it.
- **Signed** (green chip) — on file, with the date and version, or *signed on paper* when the office uploaded your paper copy.
- **Due for renewal** (amber chip) — your agreement ends within a month, or has ended. **Renew now** opens the new term.
- **Finish your profile first** — the agreement will not open with a blank trading name, ABN or address. The screen names what is missing; add it under Profile and come back.

## If something goes wrong
- **"Your details changed since you opened the page"** — your profile was edited (by you or the office) while the agreement was open. Reload the page and read it again; the new details are filled in.
- **The Sign button stays grey** — you have not reached the end of the document, or the tick, your name or the signature is missing. Scroll to the very bottom first.
- **No PDF yet** — the card says *Your PDF is being prepared*. It usually takes a few seconds; the email arrives with it attached. If it is still missing after a few minutes, ring the office; the signature itself is already on your record.
- **You signed on paper and the portal says Not signed** — the office has not uploaded your paper copy yet. Ring them; once it is in, the card reads **Signed · signed on paper** and you are not asked to sign again.
- **Cannot read it well enough** — the agreement is in English only. Raise it at your induction or with the office before signing; do not sign something you have not understood.

## Related
- Profile → Insurance & licences — the other document job offers wait on.
- [Your induction](../induction/contractor.md) — Module 1 is where your company details go in.

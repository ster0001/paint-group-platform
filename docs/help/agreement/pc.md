---
feature: agreement
role: pc
title: Subcontractor agreements on PC Command — the queue items and the Contractors tag
summary: PC Command carries two work items from the one queue — Agreement not signed (an active contractor with no signed, unexpired agreement: a new one whose offers wait, an existing one asked or not yet asked, or an expired one) and Agreement expiring (inside the 30-day renewal window). Both link to the contractor's record where the office taps Request signature or uploads a paper copy. PC Command → Contractors shows the Agreement not signed tag on the same rows. A job offer to a contractor without a current agreement refuses with agreement_unsigned or agreement_expired.
sources: lib/crm/work-queue.ts, lib/painterStatus/contractorsView.ts, app/pc/contractors/ContractorRows.tsx, app/(app)/contractors/[id]/ContractorAgreement.tsx, supabase/migrations/20270286000000_agreement_offer_gate.sql
---

## What this is for
So the coordinator sees, before booking, which painters cannot be offered work because their agreement is not on file, and which agreements are about to run out — without a list of their own.

## Before you start
- Nothing. The items are derived from the agreement facts every time the queue builds.

## Steps
1. **Agreement not signed** is a tag on PC Command → **Contractors** (since 27 Oct 2026 it is no longer a card on the dashboard's Needs you now — Tom: "remove subcontractor agreement not signed") for every active contractor with no signed, unexpired agreement. The detail says why: *A new contractor: no job offers until signed*; *not asked to sign yet* (an existing contractor — the office has not started the clock); *Asked [date]; job offers stop [date]*; or *the grace window has ended — no job offers*.
2. **Open their record** (the item's action) → **Subcontractor agreement** → **Request signature** or **Add a signed agreement**. The item clears when a signed, unexpired agreement is on file.
3. **Agreement expiring** still appears on the dashboard from a month before the expiry date with the days left. The portal is already asking the contractor to sign the new term; after the date the item becomes **Agreement not signed** with *expired*.
4. **Booking a job** to a painter on either item answers `error:agreement_unsigned` or `error:agreement_expired`; the Schedule's offer refuses the same way. Clear the item first.

## What the colours and labels mean
- **Agreement not signed** — tag on PC Command → Contractors; the same contractors as the queue items.
- **Overdue** bucket — the grace window has ended, or the agreement has expired.
- **Due today** — a new contractor, or an existing one not asked yet: actionable now, no deadline.
- **Waiting on them** — asked, grace window still running; or expiring, with days left.

## If something goes wrong
- **The item does not clear after an upload** — the queue rebuilds on the next load; reload PC Command. If it stays, the upload did not record (the record page would have said so).
- **A painter with an uploaded paper copy still shows** — the uploaded copy expired (twelve months from the date signed). Ask them to sign the new term in the portal.

## Related
- [Staff: Contractors and the record page](./staff.md)
- [Contractor: signing in the portal](./contractor.md)

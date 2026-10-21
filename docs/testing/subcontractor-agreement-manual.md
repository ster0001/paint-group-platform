# Manual test — the subcontractor agreement in the portal (21 Oct 2026)

Five minutes on a phone and five on the office screen, after the three migrations and the seed are live on production (see the PR body).

## Before
- `select name, applied_at from public._prod_migrations where name like '2027028%' order by 1;` shows 20270284, 20270285, 20270286.
- `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-agreement.ts --prod` printed `read-back equals the files ✓` and `current version 1`.
- Contractors → every existing contractor's row reads **Agreement: Not signed · not asked yet** (they were marked `existing` by 20270285; offers still flow).
- Optional: put `signature-tom.png` (a transparent PNG of Tom's signature, about 600×140) in the private `contractor-docs` bucket at `company/signature-tom.png`. Without it the countersignature is applied as typed text and the PDF footer says so.

## As a contractor, on a phone (use your own practice contractor login)
1. Profile → Company details: blank the ABN, save. Open Home → **Read and sign your subcontractor agreement** → the page reads **Finish your profile first** and names *a valid 11-digit ABN*. Put the ABN back.
2. Open it again. The boxes at the top show your business name, ABN (in 2-3-3-3 groups), address, commencement date and expiry. Scroll: the legal body reads with the business name in place of the blanks; nothing shows `{{`.
3. The tick and Sign are grey until the end is on screen. Scroll to the end: tick, check your name, sign with a finger, **Sign**.
4. Expected within a few seconds: **Signed** screen, *A PDF copy is on its way to …*; Profile → **Subcontractor agreement** reads **Signed [today] · v1** with **Download PDF**; the PDF opens on the phone and shows both signatures, your name, the time (Melbourne) and the hash line at the foot; Home no longer lists the agreement action.
5. The email with the PDF attached arrives at the contractor's address; the office address gets *[name] signed the subcontractor agreement (Version 1)* with the same PDF.
6. Tap Sign again by reopening `/portal/agreement`: it shows the signed copy, not the form.

## As the office
7. Contractors → the row reads **Agreement: Signed v1 · [date]**; the record page → Subcontractor agreement → **Download signed copy** opens the same PDF.
8. Pick a real existing contractor who signed on paper → their record → **Add a signed agreement**: the scan, the date on the paper, version *Pre-portal* → **Add signed agreement**. The line reads **Uploaded · [date]**; their row reads the same; as that contractor, Profile shows **Signed [date] · signed on paper** and Download works. No email goes for an upload.
9. Pick an existing contractor who has NOT signed → **Request signature**. They get the text and the email with the link; the row reads *asked [today], offers stop [today + 14]*. PC Command shows **Agreement not signed** with *Asked …; job offers stop …*.
10. Try to offer that contractor a job before they sign (Schedule → drag a job onto them, or the job page → Offer): it is refused with **agreement_unsigned** only once the 14 days have passed; before that the offer goes through. To see the refusal today, set `agreement_grace_until` on their row to yesterday in the SQL editor, offer again, then put it back.
11. Dashboard → Contractors → the **Agreement not signed** count equals the number of such rows on Contractors.

## Put back
- Any `agreement_grace_until` you edited in step 10.
- Delete nothing else: the signed rows are the record.

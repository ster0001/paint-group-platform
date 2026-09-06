# 6 Sep 2026 — Reschedule keeps the address · Approve moves the whole booking

**SQL first:** paste `supabase/migrations/20270110000000_reschedule_approve_shifts_span.sql`
into the SQL editor (PRODUCTION project — check the ref) and read back ONE row:
`resolve_proposed_offer | shifts_end = true | moves_walkthrough = true | secdef = true`.
Until it runs, Approve still moves only the start date. Fix 1 (the address) is code
only and is live the moment the branch deploys.

## A. Contractor: a reschedule request no longer hides the address

1. Staff: Schedule → drag a tray job onto the test contractor's row → confirm the
   walkthrough date + time → **Send offer**.
2. Contractor (phone): Offers → **Accept — lock it in**. Open the job: the full street
   address and the customer's first name + phone are showing.
3. Contractor: on the job page tap **Request a new start date** → pick a day → **Send
   request**. Expect: the job page STILL shows the street address, the chip reads
   **Waiting on Paint Group**, and the header shows the dates you hold (the original
   ones), labelled "Contractor proposed a change". The jobs list still shows the job's
   title, not the suburb. (Before: "SUBURB ONLY — the full address … unlock once you
   accept", title = suburb, dates "14 Sept – 8 Sept · 1 day".)
4. Staff: **Keep original** → the contractor's page goes back to plain Booked.

## B. Staff: Approve moves the end date and the walkthrough with the start

1. Take a booking of, say, Mon–Fri with the final walkthrough confirmed Fri 15:00
   (the pin "WALK 15:00" on the Friday of the block).
2. Contractor: **Request a new start date** → the following Monday (+7 days).
3. Staff: Schedule → **Needs your decision** → WANTS TO MOVE THE JOB → **Approve**.
   Expect the toast "Approved — the new date is locked in", the green block now
   spans the FOLLOWING Mon–Fri, and the "WALK 15:00" pin sits on the new Friday
   (before: the pin stayed on the old Friday, three days before the new start).
4. Contractor: Offers → the Booked card reads the new Mon – Fri (before: "Mon 14 –
   Fri 8"); Calendar shows five days, not one; the job page's Final walkthrough
   card shows the new Friday, 15:00.
5. PC → the job → Timeline: a "Walkthrough booked" event with the note "Moved with
   the approved start date".
6. Customer: with Settings → Automations → "Booking confirmed" on, the customer gets
   the confirmation email for the NEW start date + an updated walkthrough invite
   straight after Approve (before: only at the nightly sweep). Test addresses are
   skipped by the sender, so use a real inbox to see it.
7. Same with a FIRST-TIME proposal (contractor taps **Propose new date** on an offer
   instead of accepting): Approve books the proposed Mon and the span keeps its
   length; the walkthrough lands on the new last day.

## C. Nothing moves on a refusal

Request a new start date again → **Keep original** → dates and the walkthrough are
exactly as they were after B.

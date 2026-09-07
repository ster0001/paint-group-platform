# Manual test · CRM batch, 7 Sep (Tom's sixteen)

Branch `feat/crm-batch-7sep-tom`. Source: Tom's message of 7 Sep 2026 (evening), sixteen numbered items.
Automated: `e2e/crm-batch-7sep.spec.ts` (4), `e2e/crm-shell.spec.ts` (board default), `e2e/crm-p4-status.spec.ts`
(archive redirect), `lib/notifications/prefs.test.ts`, `lib/agent/handoff.test.ts` (the new wording).
**Migration `20270129000000_crm_batch_7sep.sql`** — paste in the SQL editor, read-back: every column `true`.
No new env.

## Walk

1. **Today (items 1, 2, 14, 15).** Every card: a plain title, a sentence saying what happened, then a BLUE button that
   does the thing ("Answer the chat", "Chase", "Reply", "Decide"…), the customer's phone as a tap-to-call chip, a Log
   button, "Not this one". A live-chat handoff reads "*Name* wants to talk to a person — They asked in the website
   chat (…) and are waiting right now — open the chat and answer them." (was "…is waiting for a person — Claim").
   Click Log on a card near the bottom or the right edge: the box opens fully in view (it used to be clipped by the
   card and could open off-screen).
2. **Customers (item 16).** Click the Customers tab: the BOARD. List / Board toggle is explicit; typing a search opens
   the list (rows are what you want from a search). "N more in the list" still goes to the list. On a cold database a
   lane can time out — it then says "Didn't load in time — refresh the page" (count still right) instead of the whole
   page failing, which is what the first request after a deploy did on C1.
3. **The record (items 7, 8, 13).** TOP RIGHT of the screen, beside the name (Tom's clarification, 7 Sep late): "WHERE
   THEY'RE AT" — the stage in large plain text, the reason
   sentence, then flags (Delayed / Lost, overdue invoices, deposit unpaid, follow-up date, hot/warm/cold, no-marketing,
   tags) and a meta line (opened N×, owner, what they agreed to, what they switched off). The old mono status line is
   gone. Below it a strip: Estimates · Jobs · Invoices · Visits · Messages · History — each jumps to its section;
   Jobs and Invoices always render (empty states say why). An overdue invoice is a solid RED "Overdue · Nd" pill and a
   tinted row; an unpaid deposit a RED "Deposit unpaid" pill; both rules are lib/invoicing/derive, the dashboard's.
4. **Tags (item 9).** Status panel → Tags: Referral, Repeat customer, Strata, Real estate, Heritage, VIP (+ any the
   office added). Insurance job, Difficult access, Sydney partner are gone — from the list, every account and the
   cached facts (the migration does it). The Customers tag filter matches.
5. **Archive (item 10).** Status → Archived → confirm → you're on Customers with "Archived. They're out of every list
   and board now — search still finds them."
6. **Book a visit (item 6).** Record → Visits → + Book a visit. Pick an estimator and date: a dashed "day" box shows
   their hours that day, what's already booked (red chips with customer · suburb) and the free blocks (green chips —
   tap one and the time field takes its start). Change the date or estimator: it re-reads. The note says where the
   visit will land (their Google Calendar, if connected) and that things typed straight into Google are not visible
   here — the app only ever sees the calendar it creates (the privacy scope from 27 Aug; nothing changed there) — with
   a "check the day in Google ↗" link for that date.
7. **The estimate (item 12).** Estimates → open one: in the dark box at the very top, beside the title, a pill:
   "New — not saved" / "Not sent yet" / "Sent · not opened yet" / "Sent · viewed by the customer" / "Accepted" /
   "Declined" / "Lapsed — past its valid date".
8. **The customer's link (items 5, 11).** Open an estimate from the emailed link (no `?portal=1`): top-left "Your
   account →" goes to the portal login with their email filled in. Accept → under the signature note: "…By accepting
   you also agree that Paint Group may send you occasional offers and tips — every one has an unsubscribe link, and you
   can switch them off any time in your account." After accepting, the banner links to their account. In the CRM the
   record's meta line shows "Marketing messages: agreed <date> (accepted an estimate)", the timeline "Customer agreed
   to be contacted", and May-we email/texts flip to Yes **only if they were Unknown** — a No stays No.
9. **The wizard (item 4).** Customer path, contact page: under the fields, "By requesting your estimate you agree to
   receive messages about your project — the estimate itself, visit times, job updates and invoices — by email and
   text. You can change how we contact you any time in your account." Finish → the record shows "Messages about their
   project: agreed <date> (requested an estimate online)".
10. **Notifications & alerts (item 3).** Portal → avatar → My profile → "Notifications & alerts →" (the marketing tick
    moved there from the profile). A grid: Estimates / Visits / Property & job updates / Invoices & payments / Replies
    to your messages × Email / Text, plus "Offers and tips" (the marketing permission, worded as the opt-out). Untick
    invoices-by-text, Save → "Saved — from now on we'll only send what you've ticked." Same page for a trade login.
    Then, as staff, issue that customer an invoice with SMS: Messages on the record shows the text as **suppressed —
    "Customer switched off texts for invoices & payments in their account."**; the email still goes. The send dialog
    on the builder says the same for an estimate. Sign-in links never come here (no `kind` on the send).
    Which sends answer to the settings: estimate send + update, chat reply, invoice email/SMS, receipt, job update
    (email + SMS), pre-start checklist, appointment confirmation, walkthrough invite (customer copy only), sign-off
    report, variation to sign, visit confirmation / cancellation / reminder. Campaigns keep the permission guard.

## What was NOT changed, on purpose

- The Google Calendar scope stays `calendar.app.created` — the estimator's own Google events cannot be read without a
  sensitive-scope consent and Google's unverified-app warning (27 Aug ruling). The day box shows the diary's truth and
  links to Google for the rest.
- Item 7 clarified by Tom: the status block (stage, why, opened ×, owner) moves to the top right beside the name —
  done as a two-column head (`.rtop`) that stacks on a phone.

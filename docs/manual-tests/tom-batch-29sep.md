# Manual test — Tom's 29 Sep batch (14 items)

Branch `feat/tom-batch-29sep`. Automated: `e2e/tom-batch-29sep.spec.ts`, `lib/messaging/forwarded.test.ts`,
`lib/estimate/number.test.ts`; `e2e/estimates-home.spec.ts` updated for the new default tab.

## Migrations to paste (in order, each one converges on a re-run)

1. `supabase/migrations/20270204000000_estimate_numbers.sql` — expect ONE row: `unnumbered 0`,
   `trigger_ok 1`, `unique_ok 1`, `seq_ok true`, `token_page_ok true`, `returns_number true`.
   It drops and re-creates `get_estimate_by_token` (a return-column change). The customer page
   reads the number through it — **paste this before the deploy goes live**, or customer pages
   show the old EST- code until it runs (they do not break).
2. `supabase/migrations/20270205000000_contacts_landline_secondary.sql` — expect `cols 4`, `rls_on true`.

Both end by writing their `_prod_migrations` row; no row means the paste did not finish.

## Walk

1. **Estimates** — the sidebar link opens on **All**. Waiting on you is the first tab, one click away.
2. **Estimate numbers** — open any estimate: `#0042` sits in the dark bar to the left of the address, and
   on the Estimate ID card. The list shows `#0042` before the title. Type `42` in the Estimates search
   box → that estimate. Open its customer link → "Estimate 0042" at the top (after migration 1).
3. **Search as you type** — on Estimates and Invoicing, type into the box and stop: the list filters on
   its own; there is no Search button. Clear takes it off.
4. **Payments** — Views row: press **Final payments outstanding**. The Status row lights Outstanding and
   Milestone lights Final; the sum line reads "N invoices on this view · $X". The URL carries
   `?f=outstanding&k=final` — copy it into a new tab and the same view opens. Try the Due row
   ("Overdue 30+ days"), then **Clear filters**.
5. **Contact card** — Edit Contact: Mobile is before Company; Landline has its own box (03 9555 12 is
   refused, 03 9555 1234 saves; a landline typed in Mobile is refused as before). Secondary contact:
   name, mobile, email. Save → the card shows "Also: name · email · mobile". Send the estimate: the
   dialog offers "Also email …" and "Also text …" ticked. Both people get it (one email, two addresses;
   two texts). Send an issued invoice and a customer update: both people again.
6. **Leave reminder** — change anything, click Estimates in the sidebar → the box. Stay here keeps you;
   Leave without saving drops the edit; Save and continue saves and goes. Also on a brand-new
   estimate before its first save, and in Revise scope (which used to swallow the click entirely).
7. **Scroll** — scroll down to a room low on the page, open it, Done → you are back at that room.
   Same from a substrate (Done returns to the area where you were) and a line item.
8. **Line materials** — open a line item → **Materials for this line** → + Add material → pick a
   product, 10 L. The card shows Cost / charged and the line's price rises by the charged figure.
   Work order view lists the product under Materials; customer view shows it on a paint card with
   the note as the usage.
9. **Chat volume** — open the dock, drag the slider, let go: the chime plays at that level. Reload:
   it is remembered.
10. **Schedule** — light theme: an employee's block reads in dark green like an accepted booking.
11. **Email to info@** — needs `REPLY_DOMAIN` + `MESSAGES_INBOUND_SECRET` live (see
    `crm-v2-p3-messages.md`) AND a Gmail rule on info@paintgroup.com.au: *Forward messages from
    outside paintgroup.com.au to* `crm@<REPLY_DOMAIN>` (any mailbox at the receiving domain lands on the
    same webhook). Then email info@ from a personal address: the CRM record → Messages shows your
    words under your name within a minute; the mailbox does NOT get a second copy. Without the rule,
    replies to CRM-sent emails still arrive (the reply address); a fresh email to info@ does not.

## Left as they were (say so if it matters)

- Invoice numbers keep `INV-0153`: the prefix is Settings → Invoicing → numbering; blank it there for bare
  four digits going forward. Issued numbers are never rewritten.
- Automated reminders (invoice chase, sign-off nudges, appointment and pre-start emails) still go to the
  primary contact only.
- 8A Jupiter Street options: not diagnosed — see the session report.

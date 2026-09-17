# Manual test · Tom's batch of 17 Sep 2026

Branch `feat/tom-batch-17sep`. Automated: `e2e/tom-batch-17sep.spec.ts` (items 1–6, 8–11),
`lib/pricing/estimate.test.ts` (preparation time), `lib/workorder/console.test.ts` (variations for approval).

## Migration to paste (one file, read-back at the end)
`20270166000000_preparation_wording_time.sql` — the Preparation wording inside `invoice_write_snapshot_lines`
and on DRAFT invoice lines. Expect `helper_reworded true`, `old_words_gone true`, `draft_lines_still_old 0`.
Deploy and paste in either order: the app's own wording is a constant; the SQL only affects invoice lines
drafted after the paste.

## Env for item 7 (Vercel → Production)
`REPLY_DOMAIN` (after the receiving domain verifies in Resend) + `MESSAGES_INBOUND_SECRET` (the `email.received`
webhook → `/api/inbound/messages`), optionally `INBOUND_FORWARD_TO` (defaults to Settings → Company email).

## Walk
1. **Invoicing** → the search box top right: type a customer's surname → only their jobs; type part of an address → the job; the customer's name sits under the address; **Clear**. **Payments → Receivables**: the box above the chips narrows as you type.
2. **Estimates → open any draft in the builder.** The first card is **Admin notes · staff only**. Type a note. It is NOT on the Estimate tab (customer copy) or the work order.
3. **Preparation** card reads "Allowance for time/ materials for job site set up, fillers and consumables."
4. On the same card, **Contractor time** → 2 hr. The Preparation row on the right and the Subtotal rise by 2 × the charge-out rate; the hint says "Adds 2 h to the contractor's work order". Save → Work order tab: a **Preparation** area sits first with "Site set-up, fillers and consumables · 2 h". Send an offer: the hours include it.
5. Change anything, then click **CRM** in the sidebar without pressing Save. The estimate saves (the button flashes "Saving…") and the CRM opens. Come back: the change is there. Same on an invoice with a line's editor open.
6. Open a room → the Walls row shows **Room L×W×H | Single wall W×H**. Choose Single wall: W is blank, H is the room height, Coats beside them. W = 3 → the row reads 7 m² (3 × 2.4). Coats 3. Press **Room L×W×H** → back to 34 m². **+ Add Surface → Walls** for a second wall.
7. (Once the env above is set) email a customer from their CRM record → they reply → the reply appears on the record AND arrives in the office mailbox with the customer as reply-to.
8. **CRM → a customer → Follow up on**: tap the date box → a calendar. ‹ › steps months; earlier-than-today is greyed; **Today** at the bottom. Also on Snooze, the Log sheet's "Pick a date", Delay, Book a visit, and the Diary's Move.
9. Set a follow-up for three weeks out → **Set date**. Go to Today, come back: the box shows THAT date (it used to show tomorrow).
10. **Projects (PC Command)** → **Variations for approval** under the tiles: every open variation, yours to price first (amber, **Price it**), then waiting on the customer, then on the painter. Decline one on the job → it leaves the list.
11. On a phone (or a 390-px window), sign in as a customer → **Chat with us** sits above the Money/Jobs tab bar, not on it. On a staff invoice on a phone, the chat dock sits above the action bar.

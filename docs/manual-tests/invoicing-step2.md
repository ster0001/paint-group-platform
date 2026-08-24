# Invoicing Step 2 — the three money screens (Tom's script)

All three migrations (20261111, 20261112, 20261113) are RUN LIVE and the
whole flow is proven by `e2e/invoicing.spec.ts` (6/6 against the live
schema). This script is the eyeball pass on your phone.

## The dashboard — /invoicing

1. Open **/invoicing** (also linked from the PC console's tab rail as
   "Invoicing"). Four pulse tiles: Outstanding · Overdue (clay) · Due this
   week (amber) · Collected 14 days (emerald, sparkline).
2. Filter chips carry counts and are shareable links — try
   `/invoicing?f=draft`. Your three legacy invoices show as drafts.
3. Tap a row → its invoice document. Tap the ADDRESS on a row → that job's
   money view. Aged receivables bar sits under the list.
4. Activity tab = the cross-job event feed; Payables is a labelled empty
   state until Steps 5–6.

## The job money view — tap any address

1. Payment stage rail (Deposit → Progress → Final → Paid in full), money
   strip (Contract · Variations · Invoiced · Paid · Balance) — every figure
   from the ledger.
2. **Request payment** → chips 10/25/50, custom %, fixed $ — the preview is
   a mirror; the server computes and bounds the draft.
3. **Invoice in full** → drafts the final from the ledger (adjusted contract
   minus previously invoiced).
4. On an open invoice card: **Record payment** (bank/cash/other, bounded ≤
   balance × 1.05, RCT receipt allocated) and **Void** (reason required —
   the number is burnt).

## The invoice document — Open any draft

1. Lines are seeded from the accepted snapshot; approved variations carry
   their approval dates; deposit/progress get **Amend the amount**.
2. Edit any line's amount on a FINAL draft → the amber reconciliation
   banner shows the exact drift with two one-tap resolutions:
   **Record as variation** (moves the ledger — the emerald "reconciles"
   line returns) or **Keep as one-off adjustment** (decision recorded as an
   event). Silent drift is impossible.
3. **Issue…** allocates the INV number and locks the document — after that,
   even the SQL editor is refused by the database
   (`invoice_immutable_after_issue`).
4. Note: your old $0 final stub on 2 Beech Rise correctly shows the banner
   ("below the job ledger") — resolve it or just delete that draft and use
   **Invoice in full** for a fresh one.

Pay link / PDF / Preview-as-customer buttons are visible but disabled —
they go live with Step 3 (send pipeline + token view).

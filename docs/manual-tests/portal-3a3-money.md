# Portal 3a-3 — Money in the portal (estimate + money views)

**What this ships:** the Money tab is real — every invoice and receipt
across the account's jobs, read-only over the invoicing rows. NO migration.

- Project header per job: the accepted contract inc GST with the GST
  itemised, and an On track / Overdue chip.
- Invoice rows: number + date, plain kind ("Deposit", "Payment request",
  "Balance on completion"), inc-GST total with the GST line, status chips
  (Paid <date> emerald / Due <date> amber / Overdue clay / Partly paid with
  the balance still owing), and "View & pay" into the existing /i invoice
  page (PDF + Stripe live there — one surface, no fork).
- Receipts ride their invoice with a one-tap PDF
  (/account/receipt/<id> — ownership proven through the account chain;
  anyone else gets a 404, never a 403).
- Customers NEVER see draft, void or written-off invoices.
- The not-yet-invoiced remainder reads "Balance on completion — only due
  once you've walked through and signed off · Not due yet".
- Printing any portal page now produces a clean white document (§7).
- Estimates open through the existing /e customer view (one component,
  the no-fork rule) — the portal is the home that lists them.

## Your 60-second check (after deploy, signed in as tjhroman@gmail.com)

1. Portal → **Money**. Your real jobs appear, each with its project total
   and GST line.
2. The paid invoices from 1/41 Devoy St / 23a Oakdene show emerald "Paid"
   chips; anything due shows amber with its date.
3. Tap **View & pay** on any invoice — the familiar invoice page opens
   with its PDF and pay button.
4. Tap a receipt's **Download PDF** — the receipt lands.
5. Browser print (Cmd+P) on Money — a clean white page.

## Proof in CI

- `e2e/portal-money.spec.ts` 3/3 live: drafts invisible, GST itemised,
  receipt route owner-only (404 for strangers and the signed-out), honest
  empty state.
- `lib/portal/money.test.ts` (9 tests): chip logic reuses the SAME
  overdue/paid rules as the staff dashboard (lib/invoicing/derive), the
  inc-anchored GST split, remainder maths, failed payments never counting.
- Unit 981 green · portal-shell 4/4 re-run · lint + tsc clean.

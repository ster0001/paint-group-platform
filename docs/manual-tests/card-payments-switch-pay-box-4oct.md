# Manual test — card payments switch + the Pay box (4 Oct 2026)

Branch `feat/card-payments-switch-pay-box`. No migration. Automated: `e2e/invoicing.spec.ts`
(the Pay box, the print page, the 503, the Settings button) and `e2e/stripe-live.spec.ts` (C1 only).

## Settings, as staff
1. Open **Settings → Money → Invoicing**. Under **Card payments (Stripe)** the line reads
   "Card payments are **off**" and the button reads **Add card payments**. This is the default:
   Stripe is off on production from this deploy until you press the button.
2. Press it. The line flips to **on**, the button to **Remove card payments**, and a message says
   the customer's Pay box now offers a card option. Reload: still on.
3. Press **Remove card payments**. Back to off. Reload: still off.
4. If the deploy has no `STRIPE_SECRET_KEY`, turning cards on shows an amber note saying customers
   still see bank transfer only.

## The customer's invoice, in a private window
1. Open any open invoice link (`/i/<token>`) with a balance owing. The old grey "How to pay — bank
   transfer" box is gone; in its place is **How to pay** with one button, **Pay $balance**.
2. Press it. A box opens: the due label (**Deposit due** on a deposit, **Payment due** on a progress
   claim, **Final balance due** on a final), the amount, then Account name, Bank, BSB, Account and
   **Reference = the invoice number** with a **Copy** button. Copy puts the number on the clipboard.
3. With card payments OFF there is no card option in the box. **Done** closes it.
4. With card payments ON (and a key on the server) the box also has **Or pay online by card** with
   the surcharge line; pressing it goes to Stripe Checkout as before. Cancel there and you come
   back with the box already open and "No card payment was taken".
5. Add `?print=1` to the invoice URL: the static bank-details box is back and there is no Pay
   button. Download PDF on an issued invoice shows the same — paper keeps the details.
6. The job's Invoices tab, the invoice page's preview and the revision builder's Invoice tab all
   still show the static box (staff previews never get a Pay button).

## Old card links after turning cards off
POST to `/i/<token>/checkout` (or press a card button on a stale tab) answers 503 with
"Card payments aren't offered just now — the bank transfer details are on your invoice."

# Manual test — cancel an unpaid deposit and invoice in full (15 Oct 2026)

Needs migration `20270269000000_invoice_final_in_full.sql` pasted on production
(check the ledger: `select * from public._prod_migrations where name like '20270269%';`).

## 8 Penderel Court (estimate 1569) — the job that started it
1. Payments → search **Penderel** → open the job's address (the panel).
2. Money in shows one card: **Deposit invoice (50%) INV-0052**, $600.05, not paid.
3. Press **Cancel, invoice in full** on that card → the confirm names INV-0052 and **$1,200.10** → OK.
4. Expect: the deposit card reads **Void — Not paid before the job finished; replaced by the final invoice for the whole job**,
   and a new **Final invoice** card for **$1,200.10**, *Not sent yet*.
5. Press **Send** on the final, pick the due date, send. Bronwyn gets the final for the whole job;
   her old INV-0052 link now says the invoice has been cancelled.

## Refused by design
- A job whose deposit HAS a payment on it: the button is not on the card (and the function answers
  *Money has already been paid on it*). Use **Invoice in full** — the final nets the deposit off.
- A job with only a draft deposit: no button (a draft is deleted, not cancelled). **Invoice in full**
  removes the draft and asks for everything on the final.

# Cancel an unpaid deposit and invoice the whole job (8 Penderel Court)

Open from: https://github.com/ster0001/paint-group-platform/compare/main...fix/final-in-full-unpaid-deposit

## What was wrong
8 Penderel Court (estimate 1569, $1,200.10) was signed off on 13 Oct with its 50% deposit INV-0052 ($600.05) sent and viewed but never paid. The final drafted at sign-off netted that deposit off, so no screen could raise ONE invoice for the whole job: **Invoice in full** drafts the $600.05 balance only, and the row keeps offering **✓ Paid** on the deposit (`sent` outranks `uninv`). The job now has no final at all.

## What this does
- **Migration `20270269000000_invoice_final_in_full.sql`** (additive): `invoice_final_in_full(estimate, reason)` — staff only — voids every sent, unpaid deposit or progress claim through `invoice_void` (number burnt, `voided` event, lines' `parent_void` mirror), removes their unsent drafts, then drafts the final through `invoice_draft_final` (whole contract, since a void is not invoiced). One transaction. Refuses `has_payments` (the ordinary final nets paid money off) and `nothing_to_cancel`.
- **Job panel**: a sent deposit/progress card with nothing paid on it gets **Cancel, invoice in full** (confirm names the invoice and the whole-job amount). The final then goes out through the ordinary **Send**.
- e2e `payments-final-in-full.spec.ts` — 4/4 on C1. Typecheck, lint (CI ceiling), unit suite green.
- Help `docs/help/invoicing/staff.md`, `docs/ARCHITECTURE.md`, manual test `docs/manual-tests/payments-final-in-full-15oct.md`.

## SQL for Tom (production `llmrvgdequpmzzuaxdhq`, not the test project)
Paste `supabase/migrations/20270269000000_invoice_final_in_full.sql` whole. The read-back row must show `final_in_full_auth = true`, `final_in_full_anon = false`, `final_in_full_guarded = true`, `final_in_full_keeps_paid = true`, `final_in_full_definer = true`. Then confirm the ledger:
```sql
select name, applied_at from public._prod_migrations where name like '20270269%';
```

## Then, for Penderel Court
Payments → search **Penderel** → open the job → on the **Deposit invoice INV-0052** card press **Cancel, invoice in full** → OK → a **Final invoice $1,200.10** draft appears → **Send**. Bronwyn's INV-0052 link then says it has been cancelled.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

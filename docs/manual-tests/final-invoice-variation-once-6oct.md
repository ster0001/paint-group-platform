# Manual test — final invoice skips a billed variation (6 Oct 2026)

Run `20270216000000_final_invoice_skips_billed_variations.sql`; the read-back row must show
`final_skips_billed = true` and `once_index = 1`. Check `_prod_migrations` has the row.

1. **568 Collins Street**: open the job, log the open quality check as a **pass**. The job closes (no walkthrough
   on this booking) — no "duplicate key" message. The header gains **Final invoice (draft)**.
2. Open that draft: the variation already on the earlier progress invoice is NOT listed again; the
   "Less previously invoiced — …" line nets what that invoice took, and the total equals the ledger's balance.
3. Invoicing → the ledger for the job shows the contract, the progress invoice and the final balance adding up.

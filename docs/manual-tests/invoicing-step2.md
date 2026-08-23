# Invoicing Step 2 — run + verify (Tom's script)

## One paste: `supabase/migrations/20261113000000_invoice_draft_editing.sql`

The §7.3 editor's server surface: line edit/add/remove with server recompute,
the deposit/progress "amend the amount", the two reconciliation-banner paths,
and a hardening of `invoice_draft_final` (object-shaped `selected_options`
no longer crashes the final draft at sign-off).

**Read-backs at the end — expect:**

| Read-back | Expect |
|---|---|
| function list | 9 rows, all `security_definer = true` |
| `options_hardened` | true |
| `authenticated_may_call` | 2 rows (`invoice_final_drift_cents`, `invoice_recompute_draft`), both **false** |

The screens work before this runs — only the edit controls error politely
("Couldn't do that"); nothing else degrades.

## After the paste — the automated proof

```bash
npm run test:e2e -- e2e/invoicing.spec.ts
```

All six tests should pass (today the sixth skips with a message naming this
migration). The suite proves, in a real browser as staff, against the live
database:

1. accepting an estimate makes the deposit draft appear on the dashboard
   **and** the job money view with no page-specific write;
2. issuing allocates `INV-####` and the **database itself** then refuses money
   edits (`invoice_immutable_after_issue`) — even via the service key;
3. a recorded bank payment allocates `RCT-####`, flips the stage rail and
   money strip, and the dashboard row reads Paid in full;
4. "Request payment → 25%" previews and drafts **$4,625.00 of $18,500** —
   computed server-side off the ledger;
5. amending a progress draft re-splits GST server-side;
6. an edit that moves the final draft off the ledger **always** raises the
   amber reconciliation banner, and both resolutions write events — one-off
   adjustment recorded, or a staff-override variation that moves the ledger
   so the document reconciles (emerald).

## Two minutes by hand (real data, read-only unless you choose)

1. PC Command now has an **Invoicing** tab; every work-order view's money
   strip has **Money view →**.
2. `/invoicing` — your live drafts are listed; tiles read $0 until something
   is issued. Filters are shareable links (`?f=draft`).
3. Tap a row → the invoice document; tap a job address → that job's money
   view (stage rail · money strip · Payments/Invoices/Costs).
4. On a money view: **Request payment** — the sheet previews 10/25/50%,
   custom % and fixed $; nothing drafts until you confirm, and the server
   computes the cents.
5. The old `/invoices` list still works unchanged (it stays until these
   screens fully replace it).

## Notes

- The e2e run consumed `INV-0001`/`RCT-0001` from the live sequences (numbers
  burn, never reuse — by design). Set the starting points before real use:
  `select setval('public.invoice_no_seq', <last PaintScout number>);` and the
  same for `receipt_no_seq` if you care about receipt continuity.
- Send · PDF · pay links · the customer token view are Step 3 and their
  buttons say so.

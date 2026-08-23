# Invoicing Step 1 — run + verify (Tom's script)

Two pastes in the Supabase SQL editor, **in this order** (the second uses enum
values the first adds, and they cannot share a transaction):

1. `supabase/migrations/20261111000000_invoice_status_enum.sql`
2. `supabase/migrations/20261112000000_invoicing_core.sql`

## What the read-backs should say

**Paste 1** ends with one select. Expect **8 rows**:
`draft, issued, sent, viewed, partially_paid, paid, void, written_off`.

**Paste 2** ends with seven selects. Expect:

| Read-back | Expect |
|---|---|
| `invoice_status_values` | 8 |
| `transitions` | 18 |
| `indexname` | one row: `invoice_lines_variation_once` |
| trigger names | `t_invoice_guard_delete`, `t_invoice_guard_update`, `t_invoice_lines_guard`, `t_invoice_void_mirror` (plus any pre-existing FK triggers are internal and won't show) |
| `invoices_missing_backfill` | 0 |
| `drafts_final` | two rows (`wo_close_without_walkthrough`, `wo_sign`), both **true** |
| `accept_drafts_deposit` | true |
| RLS table | 9 rows, all `relrowsecurity = true` |

Any deviation: stop and paste the output back into the session. **A migration
running is not the same as its statements applying.**

## Three live probes (safe — errors roll back, nothing changes)

**1. An illegal transition is refused by the database itself:**

```sql
update public.invoices set status = 'paid' where status = 'draft';
```

Expect: `ERROR: invoice_illegal_transition: draft -> paid`. (Your three live
invoices are all drafts, so this tries — and is refused — on real rows.)

**2. Double-billing a variation is a constraint violation:**

```sql
begin;
insert into public.invoice_lines (invoice_id, source, source_ref, description, amount_ex_cents)
select id, 'variation', 'probe-same-variation', 'probe', 100 from public.invoices limit 1;
insert into public.invoice_lines (invoice_id, source, source_ref, description, amount_ex_cents)
select id, 'variation', 'probe-same-variation', 'probe', 100 from public.invoices limit 1;
rollback;
```

Expect the second insert to fail with
`duplicate key value violates unique constraint "invoice_lines_variation_once"`,
then the `rollback` leaves nothing behind. (If the first insert fails instead
with `invoice_lines_locked`, the invoice it picked isn't a draft — that is the
line-lock guard working; tell the session.)

**3. The three live rows were classified, tokened and totalled:**

```sql
select kind, status, number, amount_cents, total_inc_cents,
       subtotal_ex_cents + gst_cents as parts, left(token, 8) as tok
  from public.invoices order by created_at;
```

Expect: the two deposits as `kind = deposit`, the $0 stub as `kind = final`,
every `number` null (all drafts), `parts = total_inc_cents` on every row, and
a token on every row.

## Two optional one-offs (Settings)

- **Align invoice numbering with PaintScout** (⚑13) — if the last real invoice
  was e.g. INV-0152:

  ```sql
  select setval('public.invoice_no_seq', 152);
  ```

  Skip this and numbering simply starts at INV-0001.

- **Bank details on the PDF** (⚑12) — BSB/ACC were deliberately left blank.
  Copy them from the live PaintScout invoice header:

  ```sql
  update public.settings
     set value = value || jsonb_build_object('bsb', 'XXX-XXX', 'acc', 'XXXXXXXX')
   where key = 'invoicing_bank';
  ```

## What changes in the product after this runs

- Accepting an estimate drafts a **deposit invoice** (snapshot's own deposit %
  when the sent document stated one, else the Settings default 10%) with a
  line, a token and a `drafted` event — same transaction as the acceptance.
- Sign-off (both modes, and close-without-walkthrough) drafts the **final
  invoice** — adjusted contract minus previously invoiced, lines seeded from
  the accepted snapshot and each approved variation — instead of the $0 stub.
  Reopen drops that draft; a re-sign drafts a fresh one.
- Nothing else is visible yet: the /invoices list stays read-only. The money
  screens are Step 2 and e2e-verify this whole flow in the real roles.

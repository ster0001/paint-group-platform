-- =====================================================================
-- Invoicing & Payments · Step 1a — invoice_status enum widening.
--
-- ALONE IN THIS FILE ON PURPOSE (the 20261109 lesson): a value added to an
-- enum cannot be USED in the same transaction that added it, and a Supabase
-- SQL-editor paste is one transaction. Run this file first, then
-- 20261112000000_invoicing_core.sql.
--
-- The full machine (docs/briefs/claude-code-brief-invoicing-payments.md §3.2):
--   draft → issued → sent → viewed → partially_paid → paid
--   issued+ → void | written_off
-- 'overdue' is DERIVED (due date passed ∧ balance > 0) and deliberately has
-- no enum value — no second source of truth to drift.
-- =====================================================================

alter type public.invoice_status add value if not exists 'issued' after 'draft';
alter type public.invoice_status add value if not exists 'viewed' after 'sent';
alter type public.invoice_status add value if not exists 'partially_paid' after 'viewed';
alter type public.invoice_status add value if not exists 'written_off' after 'void';

-- ---- readback: expect draft, issued, sent, viewed, partially_paid, paid, void, written_off
select enumlabel
  from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'invoice_status'
 order by enumsortorder;

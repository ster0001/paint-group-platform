-- =============================================================================
-- Trade portal v2 · Session 5 — approvals (Tom's rulings ⚑1/⚑2/⚑3/⚑5/⚑6, 31 Aug)
--
--   ⚑1 accounts.can_approve_for_owner   NULLABLE boolean: NULL = derive from
--      org_kind (real_estate → true, else false). Explicit value wins — the
--      "editable in Settings and on the account" half without a backfill.
--      accounts.owner_referral_threshold_cents: above it, "Send to owner" is
--      the only path offered (app-enforced in the approval strip).
--   ⚑2 is advisory + event-only — NO schema: the warning lives in the strip,
--      the over-limit record is a wo_events row (type 'approved_over_limit')
--      written by the approve action after acceptance creates the WO.
--   ⚑3 accounts.payment_terms_days NULLABLE: NULL = the trade_terms Settings
--      default (seeded 14 below). Deposit rules untouched.
--   ⚑5 accounts.po_required_to_invoice NULLABLE boolean: NULL = derive from
--      org_kind (facilities → true). Enforcement at final-invoice issue is
--      invoicing's (session 6+); the PO itself is stored as the property's
--      "PO" reference so it prints everywhere references print.
--   ⚑6 no schema — approver seats are account_users.role='approver' (exists);
--      the assessor path is the external token link + the sign-off hook.
--
--   external_approvals.decision_note: the approver's own words on decline
--   (or anything they add on approve). Display-only.
-- =============================================================================

alter table public.accounts
  add column if not exists can_approve_for_owner boolean,
  add column if not exists owner_referral_threshold_cents bigint
    constraint accounts_owner_referral_check check (owner_referral_threshold_cents >= 0),
  add column if not exists payment_terms_days integer
    constraint accounts_terms_days_check check (payment_terms_days between 1 and 90),
  add column if not exists po_required_to_invoice boolean;

comment on column public.accounts.can_approve_for_owner is
  'NULL = derive from org_kind (real_estate true, else false). ⚑1.';
comment on column public.accounts.owner_referral_threshold_cents is
  'Above this inc-GST total, sending to the owner is the only offered path. NULL = no threshold. ⚑1.';
comment on column public.accounts.payment_terms_days is
  'NULL = the trade_terms Settings default (14). ⚑3.';
comment on column public.accounts.po_required_to_invoice is
  'NULL = derive from org_kind (facilities true, else false). Enforced at final-invoice issue. ⚑5.';

alter table public.external_approvals
  add column if not exists decision_note text not null default '';

-- ⚑3 default: one Settings row, read app-side; per-account value wins.
insert into public.settings (key, value)
select 'trade_terms', '{"days": 14}'::jsonb
where not exists (select 1 from public.settings where key = 'trade_terms');

-- ---- read-backs (CLAUDE.md law) --------------------------------------------

-- Expect: the four account columns
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'accounts'
  and column_name in ('can_approve_for_owner', 'owner_referral_threshold_cents',
                      'payment_terms_days', 'po_required_to_invoice')
order by column_name;

-- Expect: decision_note present
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'external_approvals' and column_name = 'decision_note';

-- Expect: one trade_terms row, {"days": 14}
select key, value from public.settings where key = 'trade_terms';

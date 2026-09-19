-- =============================================================================
-- Tom, 19 Sep 2026: the company address is 25/25-**27** Bunney Road, not 25-35.
--
-- 20261112000000_invoicing_core.sql seeded `invoicing_entity` from the
-- PaintScout header with "25/25-35 Bunney Road", and it has been on every
-- invoice since. That file is left exactly as it is — it records what actually
-- ran in November, and rewriting an applied migration makes the ledger a lie.
-- This one corrects the value instead, so a project built from the migrations
-- ends up with the right address and the history still reads true.
--
-- TWO rows, because two surfaces read different ones:
--   invoicing_entity — invoices, the portal warranty terms, the certificate
--   company_profile  — the estimate letterhead, and therefore clause 1 of the
--                      warranty attachment on /e/[token]/warranty
--
-- The ABN (41 639 780 108) was already correct in invoicing_entity; it is set
-- here too so company_profile carries it and the two can never disagree.
--
-- Both merge (`value || excluded.value`) rather than replace, so the trading
-- name, tagline, logo, bank details and everything else in those rows survive.
--
-- Estimates already SENT keep the details frozen in their snapshot — that is
-- deliberate, so a customer's document never changes under them. New estimates
-- pick this up immediately.
-- =============================================================================

insert into public.settings (key, value)
values (
  'invoicing_entity',
  jsonb_build_object(
    'abn', '41 639 780 108',
    'address', '25/25-27 Bunney Road, Oakleigh South VIC 3167')
)
on conflict (key) do update
  set value = settings.value || excluded.value,
      updated_at = now();

insert into public.settings (key, value)
values (
  'company_profile',
  jsonb_build_object(
    'abn', '41 639 780 108',
    'addressLine1', '25/25-27 Bunney Road',
    'addressLine2', 'Oakleigh South VIC 3167')
)
on conflict (key) do update
  set value = settings.value || excluded.value,
      updated_at = now();

-- ---- read-back: what this file just made ------------------------------------
-- Both rows must come back with the same ABN and a 25-27 address. A missing
-- row, or a 25-35 still showing, means this did not apply.
select
  key,
  value ->> 'abn' as abn,
  coalesce(value ->> 'address', concat_ws(', ', value ->> 'addressLine1', value ->> 'addressLine2')) as address,
  (coalesce(value ->> 'address', value ->> 'addressLine1') like '%25-27%') as address_corrected
from public.settings
where key in ('company_profile', 'invoicing_entity')
order by key;

insert into public._prod_migrations(name) values ('20270177000000_company_address_correction.sql') on conflict (name) do nothing;

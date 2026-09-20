-- 20270184 · Leave an estimate out of the dashboard (Tom, 20 Sep 2026).
--
-- Two things asked for on the same day, one mechanism:
--   1. "Remove the following accepted jobs from the dashboard data completely,
--      as they were tests: 1/41 Devoy Street, 13 Leamington Crescent."
--   2. The Sales $ / target numbers were wrong: every one of the 35 booked
--      jobs imported from PaintScout (source 'paintscout', 16 Sep) is ALSO in
--      the Airtable history import (source 'airtable') as an accepted
--      estimate with the same total, so each sale counted twice.
-- Deleting is a multi-table purge behind RESTRICT edges and invoice guards
-- (docs: prod-purge-order); a mark is reversible and honest. Every dashboard
-- read drops the marked estimates, their work orders, invoices and payments
-- (lib/reporting/exclusions.ts). Nothing else changes: the estimate, its
-- job and its invoices stay exactly where they are.
set lock_timeout = '15s';

alter table public.estimates
  add column if not exists reporting_excluded_at timestamptz,
  add column if not exists reporting_excluded_reason text;

create index if not exists estimates_reporting_excluded_idx
  on public.estimates (id) where reporting_excluded_at is not null;

-- Staff switch (builder → Job settings). Staff only; the service role too.
create or replace function public.estimate_set_reporting_excluded(p_estimate_id uuid, p_excluded boolean, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_staff() or auth.role() = 'service_role') then return 'error:not_staff'; end if;
  update public.estimates
     set reporting_excluded_at = case when p_excluded then coalesce(reporting_excluded_at, now()) else null end,
         reporting_excluded_reason = case when p_excluded then coalesce(nullif(trim(p_reason), ''), reporting_excluded_reason, 'test job') else null end
   where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  return 'ok';
end;
$$;
revoke all on function public.estimate_set_reporting_excluded(uuid, boolean, text) from public, anon;
grant execute on function public.estimate_set_reporting_excluded(uuid, boolean, text) to authenticated, service_role;

-- The import duplicates, by the rule that found them in the pack: an Airtable
-- history estimate (source 'airtable', accepted) that names the same quote as
-- a PaintScout booked job (external_ref quote_number = quote_no), or, when the
-- history row has no quote number, the same account and the same accepted
-- total. Marks the HISTORY copy — the booked job is the one with the work
-- order, the invoices and the tray card. Re-runnable: already-marked rows are
-- listed with marked=false. Staff or service role.
create or replace function public.reporting_exclude_import_duplicates(p_apply boolean default true)
returns table (history_estimate_id uuid, booked_estimate_id uuid, quote_no text, matched_by text, accepted_total_cents integer, title text, marked boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    raise exception 'not_staff';
  end if;
  return query
  with booked as (
    select e.id, e.account_id, e.accepted_total_cents, e.external_ref->>'quote_no' as quote_no
      from public.estimates e
     where e.source = 'paintscout' and e.status = 'accepted'
  ),
  matches as (
    select distinct on (h.id)
           h.id as history_id, b.id as booked_id, b.quote_no,
           case when h.external_ref->>'quote_number' = b.quote_no then 'quote_no' else 'account+total' end as matched_by,
           h.accepted_total_cents, h.title, h.reporting_excluded_at
      from public.estimates h
      join booked b
        on (nullif(h.external_ref->>'quote_number', '') is not null and h.external_ref->>'quote_number' = b.quote_no)
        or (nullif(h.external_ref->>'quote_number', '') is null and h.account_id = b.account_id and h.accepted_total_cents = b.accepted_total_cents and h.accepted_total_cents > 0)
     where h.source = 'airtable' and h.status = 'accepted' and h.id <> b.id
     order by h.id, (h.external_ref->>'quote_number' = b.quote_no) desc
  ),
  applied as (
    update public.estimates e
       set reporting_excluded_at = now(),
           reporting_excluded_reason = 'duplicate of imported booked job PS-' || m.quote_no || ' (' || m.matched_by || ')'
      from matches m
     where p_apply and e.id = m.history_id and e.reporting_excluded_at is null
     returning e.id
  )
  select m.history_id, m.booked_id, m.quote_no, m.matched_by, m.accepted_total_cents, m.title, (m.history_id in (select a.id from applied a)) as marked
    from matches m
   order by m.quote_no;
end;
$$;
revoke all on function public.reporting_exclude_import_duplicates(boolean) from public, anon;
grant execute on function public.reporting_exclude_import_duplicates(boolean) to authenticated, service_role;

-- Read back: both columns, the index, both functions.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name in ('reporting_excluded_at', 'reporting_excluded_reason')) as columns_present,
  2 as _expect_columns,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'estimates_reporting_excluded_idx') as index_present,
  1 as _expect_index,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('estimate_set_reporting_excluded', 'reporting_exclude_import_duplicates')) as functions_present,
  2 as _expect_functions;

insert into public._prod_migrations(name) values ('20270184000000_reporting_exclusion.sql') on conflict (name) do nothing;

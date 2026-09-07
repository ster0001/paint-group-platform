-- =============================================================================
-- Contractor portal guided tour — seen once per account (help brief Phase C, C3)
--
-- A new contractor's first sign-in opens a short tour of the tabs. Completing
-- or skipping it is recorded here, so it never shows twice on any device; the
-- help centre offers "Show me around again". Per account, not per device
-- (⚑ C-2): a painter's phone and laptop are the same person.
--
-- The column is written only through the RPC below (a contractor may only
-- mark THEIR OWN row): the column-privilege model from 20260824010000 is an
-- allow-list, so a new column is not update-grantable to `authenticated`
-- unless listed, and this one deliberately is not. Staff clear it on request
-- with the same RPC pattern reversed (not built — nobody has asked).
-- =============================================================================

alter table public.contractors
  add column if not exists tour_seen_at timestamptz;

comment on column public.contractors.tour_seen_at is
  'When the contractor finished or skipped the first-sign-in portal tour. NULL = not yet shown to completion.';

create or replace function public.contractor_tour_seen()
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  select id into v_cid from public.contractors where profile_id = auth.uid();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  update public.contractors set tour_seen_at = coalesce(tour_seen_at, now()) where id = v_cid;
  return 'ok';
end $$;

revoke all on function public.contractor_tour_seen() from public;
grant execute on function public.contractor_tour_seen() to authenticated;

-- Read back what this migration made (CLAUDE.md: a migration running is not
-- the same as its statements applying).
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contractors' and column_name = 'tour_seen_at') as tour_column,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contractor_tour_seen') as tour_rpc,
  (select count(*) from information_schema.column_privileges
    where table_name = 'contractors' and column_name = 'tour_seen_at'
      and grantee = 'authenticated' and privilege_type = 'UPDATE') as contractor_can_write_directly_should_be_0;

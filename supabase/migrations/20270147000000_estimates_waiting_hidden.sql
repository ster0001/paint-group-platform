-- Tom, 15 Sep 2026: "Allow to delete items from the waiting tab with a tick
-- box and delete button — this doesn't remove from the CRM directly, just
-- from the waiting screen."
--
-- So this is NOT a work-item dismissal. `work_item_dismissals` (20261217)
-- suppresses a key for the whole queue — Today, the badge, every filtered
-- view — with a reason on the timeline. This table hides a key from ONE
-- screen: Estimates → Waiting on you. CRM Today still shows the item, the
-- badge still counts it, and the evaluator never reads this table.
--
-- Keyed by the deterministic work-item key (kind:subjectType:subjectId:
-- discriminator), so a re-fire under a NEW discriminator — a call request
-- that becomes a visit request — is a new fact and comes straight back.
-- Shared across staff: the waiting screen is the team's list, not one
-- person's, and a row two people both tidied away would otherwise reappear
-- for the second one.

create table if not exists public.estimates_waiting_hidden (
  item_key   text primary key
    constraint estimates_waiting_hidden_key_shape check (item_key ~ '^[a-z_]+:[a-z_]+:[^:]+:[a-zA-Z0-9_-]+$'),
  tenant_id  uuid not null references public.tenants (id) default public.current_tenant(),
  hidden_by  uuid references public.profiles (id) on delete set null,
  hidden_at  timestamptz not null default now()
);

comment on table public.estimates_waiting_hidden is
  'Tom, 15 Sep 2026. A work-item key a staff member took off Estimates → Waiting on you. Hides it from THAT screen only — CRM Today and the badge are untouched (that is work_item_dismissals). Written only through estimates_hide_waiting() / estimates_unhide_waiting().';

alter table public.estimates_waiting_hidden enable row level security;

drop policy if exists ewh_staff_select on public.estimates_waiting_hidden;
create policy ewh_staff_select on public.estimates_waiting_hidden
  for select to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant());

-- No INSERT/UPDATE/DELETE policy for client roles: the two RPCs below are the
-- only write paths, same law as work_item_dismissals.
revoke all on public.estimates_waiting_hidden from anon;
grant select on public.estimates_waiting_hidden to authenticated;

-- ---- the write paths ----------------------------------------------------------

create or replace function public.estimates_hide_waiting(p_item_keys text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_n   integer := 0;
begin
  if not public.is_staff() then
    raise exception 'estimates_hide_waiting: staff only' using errcode = '42501';
  end if;
  if p_item_keys is null or array_length(p_item_keys, 1) is null then
    return 0;
  end if;
  if array_length(p_item_keys, 1) > 200 then
    raise exception 'estimates_hide_waiting: at most 200 keys at a time';
  end if;
  foreach v_key in array p_item_keys loop
    if v_key !~ '^[a-z_]+:[a-z_]+:[^:]+:[a-zA-Z0-9_-]+$' then
      raise exception 'estimates_hide_waiting: that is not a work item key';
    end if;
    insert into public.estimates_waiting_hidden (item_key, hidden_by)
    values (v_key, auth.uid())
    on conflict (item_key) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

create or replace function public.estimates_unhide_waiting(p_item_keys text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not public.is_staff() then
    raise exception 'estimates_unhide_waiting: staff only' using errcode = '42501';
  end if;
  if p_item_keys is null or array_length(p_item_keys, 1) is null then
    return 0;
  end if;
  delete from public.estimates_waiting_hidden
   where item_key = any (p_item_keys) and tenant_id = public.current_tenant();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.estimates_hide_waiting(text[]) from public, anon;
grant execute on function public.estimates_hide_waiting(text[]) to authenticated;
revoke all on function public.estimates_unhide_waiting(text[]) from public, anon;
grant execute on function public.estimates_unhide_waiting(text[]) to authenticated;

-- ---- read-backs ------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'estimates_waiting_hidden') then
    raise exception 'read-back: estimates_waiting_hidden missing';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'estimates_waiting_hidden' and policyname = 'ewh_staff_select') then
    raise exception 'read-back: ewh_staff_select missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'estimates_hide_waiting') then
    raise exception 'read-back: estimates_hide_waiting missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'estimates_unhide_waiting') then
    raise exception 'read-back: estimates_unhide_waiting missing';
  end if;
end $$;

select policyname, cmd from pg_policies where tablename = 'estimates_waiting_hidden';

insert into public._prod_migrations(name) values ('20270147000000_estimates_waiting_hidden.sql') on conflict (name) do nothing;

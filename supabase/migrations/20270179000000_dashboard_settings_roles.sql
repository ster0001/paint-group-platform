-- =============================================================================
-- Home dashboard v2 · session 0d · Settings and roles (Part B7)
--
-- Tom's rulings, 19 Sep 2026:
--   ⚑1 staff roles owner | admin | pc | sales | finance; one person may hold
--      several and sees the UNION of those roles' sections.
--   ⚑2 margins, P&L, targets and marketing spend are owner/admin only; PC and
--      sales see job values but never margin — enforced server-side.
--
-- Built on the staff model that already exists (20270106): profiles.is_owner
-- is the master user and profiles.staff_access hides AREAS of the app. Roles
-- are a second, separate question — which dashboard SECTIONS a person sees —
-- so they are a column beside those two, changed only by the master user
-- through the same guard trigger. The master user holds every role.
--
-- New:
--   · type staff_role; profiles.staff_roles staff_role[] (default none)
--   · dashboard_roles()          — the caller's effective roles (owner = all)
--   · has_dashboard_role(...)    — any of the given roles
--   · dashboard_sees_money()     — owner or admin (⚑2), for RLS and routes
--   · sales_targets (month, target, optional category / salesperson — ⚑9:
--     v1 uses the month total; the optional columns exist for later rows)
--   · marketing_spend (month, channel, spend, note — ⚑5: typed monthly)
--     Both readable and writable by owner/admin ONLY (RLS).
--   · settings: dashboard_silent_contractor_days 3, dashboard_anomaly_
--     threshold_pct 25, dashboard_ageing_edge_days_1 7, _2 30 (⚑7, ⚑8).
--   Lead-source list (⚑4) and payment methods shown wait for CRM Phase 0 and
--   the invoicing session respectively.
-- =============================================================================

-- ---- 1 · roles --------------------------------------------------------------
do $$ begin
  create type public.staff_role as enum ('owner', 'admin', 'pc', 'sales', 'finance');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists staff_roles public.staff_role[] not null default '{}';
comment on column public.profiles.staff_roles is
  'Dashboard roles (owner | admin | pc | sales | finance), union of sections. Set only by the master user. The master user holds every role regardless.';

-- The master-user guard now covers roles too.
create or replace function public.profiles_guard_owner_fields()
returns trigger language plpgsql as $$
begin
  if (new.is_owner is distinct from old.is_owner
      or new.staff_access is distinct from old.staff_access
      or new.staff_roles is distinct from old.staff_roles)
     and auth.uid() is not null and not public.is_owner() then
    raise exception 'only the master user can change who is master, what a staff login sees, or their dashboard roles' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists t_profiles_guard_owner on public.profiles;
create trigger t_profiles_guard_owner before update on public.profiles
  for each row execute function public.profiles_guard_owner_fields();

-- The caller's effective roles. Not staff → none. Master → all five.
create or replace function public.dashboard_roles()
returns public.staff_role[] language sql stable security definer set search_path = public as $$
  select case
    when p.id is null or p.role <> 'staff' then '{}'::public.staff_role[]
    when p.is_owner then enum_range(null::public.staff_role)
    else coalesce(p.staff_roles, '{}'::public.staff_role[])
  end
  from (select auth.uid() as uid) u
  left join public.profiles p on p.id = u.uid
$$;
grant execute on function public.dashboard_roles() to authenticated;

create or replace function public.has_dashboard_role(variadic p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.dashboard_roles() && p_roles
$$;
grant execute on function public.has_dashboard_role(variadic public.staff_role[]) to authenticated;

-- ⚑2: who sees dollars beyond job values.
create or replace function public.dashboard_sees_money()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_dashboard_role('owner', 'admin')
$$;
grant execute on function public.dashboard_sees_money() to authenticated;

-- ---- 2 · targets and spend --------------------------------------------------
create table if not exists public.sales_targets (
  id              uuid primary key default gen_random_uuid(),
  month           date not null constraint sales_targets_month_is_first check (month = date_trunc('month', month)::date),
  target_cents    bigint not null constraint sales_targets_target_nonneg check (target_cents >= 0),
  category_label  text,
  salesperson_id  uuid references public.profiles (id) on delete set null,
  note            text not null default '',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- One target per month per (category, salesperson) — nulls made concrete.
create unique index if not exists sales_targets_unique_idx
  on public.sales_targets (month, coalesce(category_label, ''), coalesce(salesperson_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists sales_targets_month_idx on public.sales_targets (month);
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_money_roles on public.sales_targets;
create policy sales_targets_money_roles on public.sales_targets
  for all to authenticated using (public.dashboard_sees_money()) with check (public.dashboard_sees_money());

create table if not exists public.marketing_spend (
  id          uuid primary key default gen_random_uuid(),
  month       date not null constraint marketing_spend_month_is_first check (month = date_trunc('month', month)::date),
  channel     text not null constraint marketing_spend_channel_shape check (channel ~ '^[a-z][a-z0-9_]{1,40}$'),
  spend_cents bigint not null constraint marketing_spend_nonneg check (spend_cents >= 0),
  note        text not null default '',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (month, channel)
);
create index if not exists marketing_spend_month_idx on public.marketing_spend (month);
alter table public.marketing_spend enable row level security;
drop policy if exists marketing_spend_money_roles on public.marketing_spend;
create policy marketing_spend_money_roles on public.marketing_spend
  for all to authenticated using (public.dashboard_sees_money()) with check (public.dashboard_sees_money());

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists t_sales_targets_touch on public.sales_targets;
create trigger t_sales_targets_touch before update on public.sales_targets
  for each row execute function public.touch_updated_at();
drop trigger if exists t_marketing_spend_touch on public.marketing_spend;
create trigger t_marketing_spend_touch before update on public.marketing_spend
  for each row execute function public.touch_updated_at();

-- ---- 3 · the dashboard's thresholds, as numeric settings --------------------
insert into public.settings (key, value) values
  ('dashboard_silent_contractor_days', jsonb_build_object('value', 3,  'unit', 'days',
     'notes', 'A painter on an in-progress job with no activity for this many calendar days is "silent" (dashboard, ⚑7).')),
  ('dashboard_anomaly_threshold_pct', jsonb_build_object('value', 25, 'unit', '%',
     'notes', 'A period tile this far off its comparison raises an anomaly card in the needs-doing strip (⚑8).')),
  ('dashboard_ageing_edge_days_1',    jsonb_build_object('value', 7,  'unit', 'days',
     'notes', 'Overdue ageing: the first bucket ends here (1–7 / 8–30 / 31+).')),
  ('dashboard_ageing_edge_days_2',    jsonb_build_object('value', 30, 'unit', 'days',
     'notes', 'Overdue ageing: the second bucket ends here (1–7 / 8–30 / 31+).'))
on conflict (key) do nothing;

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from pg_type where typname = 'staff_role')                                     as role_type_expect_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'staff_roles')    as roles_column_expect_1,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('sales_targets', 'marketing_spend'))         as new_tables_expect_2,
  (select count(*) from pg_policies where tablename in ('sales_targets', 'marketing_spend'))      as policies_expect_2,
  (select count(*) from pg_proc where proname in ('dashboard_roles', 'has_dashboard_role', 'dashboard_sees_money')) as functions_expect_3,
  (select prosrc like '%staff_roles%' from pg_proc where proname = 'profiles_guard_owner_fields' limit 1) as guard_covers_roles,
  (select count(*) from public.settings where key like 'dashboard_%')                             as threshold_settings_expect_4,
  (select count(*) from public.profiles where role = 'staff' and is_owner)                        as master_users,
  (select count(*) from public.profiles where role = 'staff' and cardinality(staff_roles) > 0)   as staff_with_roles_expect_0;

insert into public._prod_migrations(name) values ('20270179000000_dashboard_settings_roles.sql') on conflict (name) do nothing;

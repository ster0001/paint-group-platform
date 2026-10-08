-- =============================================================================
-- 20270224 · Finish standards as data (brief: standards / status / call backs,
-- Step 1; rulings S2, S3, S9, S12)
--
-- The approved painter guide (docs/standards/finish-standards-v1.json) lives in
-- tables, not a page: one `standards_checks` row per surface, per level, per
-- check (159 at Version 1), the rule pages as jsonb blocks, and a map from the
-- rate card's codes to the 17 surfaces so a work-order line can open "What we
-- expect" at the job's level. The rows are LOADED by scripts/seed-standards.ts
-- from the file (reference data via a seed script, never hand-typed SQL); this
-- file makes the tables, their policies and the one setting the rule needs.
--
-- Who reads: staff and every painter with a login (contractors and employees),
-- because the painter and the PC must be judged against the same words. A
-- customer has no contractors row and no policy — nothing. Nobody writes but
-- the service role (the loader); new versions arrive as a new seed file.
--
-- Also here:
--   · settings.small_job_hours (ruling S9, default 16) as a numeric envelope,
--     so it appears under Settings → Pricing & job numbers like the other
--     levers, plus small_job_hours() so a painter's session can read it.
--   · drops public.work_order_surfaces (20260818): superseded by wo_surfaces in
--     20260927, no reader in app/ or lib/ since. Step 0 listed it as dead.
--
-- Converges on a re-run. The paste starts with a lock timeout so a busy table
-- fails loudly instead of deadlocking.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. tables ----------------------------------------------------------------
create table if not exists public.standards_versions (
  id              uuid primary key default gen_random_uuid(),
  version_no      integer not null unique check (version_no >= 1),
  title           text not null,
  -- The approval date, a calendar day. Null = loaded but not published.
  published_at    date,
  published_by    uuid references auth.users (id) on delete set null,
  -- A material change needs a fresh confirmation (ruling S7); wording fixes do not.
  is_material     boolean not null default true,
  change_note     text not null default '',
  source_file     text not null default '',
  -- Ruling S9: the tape step is not required under this many estimated hours.
  small_job_hours integer not null default 16 check (small_job_hours > 0),
  created_at      timestamptz not null default now()
);

create table if not exists public.standards_blocks (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.standards_versions (id) on delete cascade,
  section_key text not null check (section_key in ('levels','rules','time','interior','exterior','defect','checklist','words')),
  body        jsonb not null,
  sort        integer not null default 0,
  unique (version_id, section_key)
);

create table if not exists public.standards_surfaces (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.standards_versions (id) on delete cascade,
  side        text not null check (side in ('interior','exterior')),
  key         text not null check (key ~ '^[a-z0-9]+$'),
  name        text not null,
  intro       text,
  every_level text not null,
  note        text,
  sort        integer not null default 0,
  unique (version_id, key)
);
create index if not exists standards_surfaces_version_idx on public.standards_surfaces (version_id, side, sort);

create table if not exists public.standards_checks (
  id         uuid primary key default gen_random_uuid(),
  surface_id uuid not null references public.standards_surfaces (id) on delete cascade,
  level      smallint not null check (level in (2, 3, 4)),
  label      text not null,
  text       text not null check (char_length(text) > 0),
  sort       integer not null default 0,
  -- ONE row per surface, per level, per check (ruling S2).
  unique (surface_id, sort, level)
);
create index if not exists standards_checks_surface_idx on public.standards_checks (surface_id, sort, level);

create table if not exists public.standards_surface_codes (
  id             uuid primary key default gen_random_uuid(),
  surface_id     uuid not null references public.standards_surfaces (id) on delete cascade,
  -- rate_items.code, spelled as the card spells it. Three window codes exist on
  -- both sides of the card, so the pair (surface, code) is what is unique.
  substrate_code text not null check (char_length(substrate_code) > 0),
  unique (surface_id, substrate_code)
);
create index if not exists standards_surface_codes_code_idx on public.standards_surface_codes (substrate_code);

-- ---- 2. RLS: staff and painters read; customers nothing; writes service-only ---
alter table public.standards_versions      enable row level security;
alter table public.standards_blocks        enable row level security;
alter table public.standards_surfaces      enable row level security;
alter table public.standards_checks        enable row level security;
alter table public.standards_surface_codes enable row level security;

drop policy if exists standards_versions_read on public.standards_versions;
create policy standards_versions_read on public.standards_versions
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
drop policy if exists standards_blocks_read on public.standards_blocks;
create policy standards_blocks_read on public.standards_blocks
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
drop policy if exists standards_surfaces_read on public.standards_surfaces;
create policy standards_surfaces_read on public.standards_surfaces
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
drop policy if exists standards_checks_read on public.standards_checks;
create policy standards_checks_read on public.standards_checks
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);
drop policy if exists standards_surface_codes_read on public.standards_surface_codes;
create policy standards_surface_codes_read on public.standards_surface_codes
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null);

revoke all on public.standards_versions, public.standards_blocks, public.standards_surfaces,
               public.standards_checks, public.standards_surface_codes from anon;
revoke insert, update, delete on public.standards_versions, public.standards_blocks, public.standards_surfaces,
               public.standards_checks, public.standards_surface_codes from authenticated;
grant select on public.standards_versions, public.standards_blocks, public.standards_surfaces,
               public.standards_checks, public.standards_surface_codes to authenticated;

-- ---- 3. the small-job threshold (ruling S9) -----------------------------------
insert into public.settings (key, value) values ('small_job_hours', jsonb_build_object(
  'value', 16, 'unit', 'hours',
  'notes', 'Finish standards: the tape defect step is not required on jobs under this many estimated hours (the figure on the job sheet). Jobs under it count for a painter''s colour but not for a bonus.'
)) on conflict (key) do nothing;

-- A painter's session cannot read settings (staff-only RLS); this reads the one
-- number for them. Same shape as worked_day_hours() (20270178).
create or replace function public.small_job_hours()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case jsonb_typeof(value) when 'number' then value::text::numeric
                 when 'object' then (value->>'value')::numeric end
       from public.settings where key = 'small_job_hours')::integer, 16);
$$;
revoke all on function public.small_job_hours() from public, anon;
grant execute on function public.small_job_hours() to authenticated;

-- ---- 4. dead table from 20260818 ----------------------------------------------
-- work_order_surfaces was the first cut of the tick list; wo_surfaces (20260927)
-- replaced it and nothing has read it since. Step 0 (8 Oct 2026) confirmed no
-- reader in app/, lib/, scripts/ or e2e/.
drop table if exists public.work_order_surfaces;

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('standards_versions','standards_blocks','standards_surfaces','standards_checks','standards_surface_codes'))
                                                                                   as tables,          5 as _expect_tables,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename like 'standards_%')                                              as policies,        5 as _expect_policies,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'standards_%' and c.relkind = 'r' and c.relrowsecurity)
                                                                                   as rls_on,          5 as _expect_rls,
  has_table_privilege('authenticated', 'public.standards_checks', 'insert')         as auth_can_insert, false as _expect_no_insert,
  has_table_privilege('anon', 'public.standards_checks', 'select')                  as anon_can_read,   false as _expect_no_anon,
  has_function_privilege('authenticated', 'public.small_job_hours()', 'execute')    as can_read_hours,  true as _expect_hours_grant,
  (select value->>'value' from public.settings where key = 'small_job_hours')       as small_job_hours, '16' as _expect_16,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'work_order_surfaces')
                                                                                   as dead_table,      0 as _expect_dropped;

insert into public._prod_migrations(name) values ('20270224000000_finish_standards.sql') on conflict (name) do nothing;

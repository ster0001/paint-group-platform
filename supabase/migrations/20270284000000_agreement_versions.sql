-- 20270284 · The subcontractor agreement as data: agreement_versions
--
-- Contractor-agreement brief (21 Oct 2026), Step 1. The Independent Contractor
-- Agreement lives in the contractor portal; the words are
-- docs/agreements/subcontractor-agreement-v<N>.md, loaded by
-- scripts/seed-agreement.ts into this table the way the induction is. One row
-- per version: the whole document with its merge tokens, the schedules lifted
-- out as data, and the hash of the wording so a signed row can name exactly
-- what was signed. Nothing writes here but the seed (service role); every
-- signed-in user reads it (a contractor renders their own copy from it).
-- Signatures, snapshots and the gate are Step 2 (20270285).
-- Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. the table -------------------------------------------------------------------------
create table if not exists public.agreement_versions (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  title          text not null,
  effective_from date not null,
  body_md        text not null check (length(body_md) > 0),
  schedules      jsonb not null default '[]'::jsonb check (jsonb_typeof(schedules) = 'array'),
  body_sha256    text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  source_file    text not null default '',
  created_at     timestamptz not null default now()
);

comment on table public.agreement_versions is
  'The subcontractor agreement as data, one row per version (docs/agreements/subcontractor-agreement-v<N>.md). Written only by scripts/seed-agreement.ts. Read by the portal and the PDF renderer through lib/agreements.';

-- ---- 2. RLS: every signed-in user reads; nobody but the service role writes ----------------
alter table public.agreement_versions enable row level security;

drop policy if exists agreement_versions_read on public.agreement_versions;
create policy agreement_versions_read on public.agreement_versions
  for select to authenticated using (true);

revoke all on public.agreement_versions from anon;
revoke insert, update, delete on public.agreement_versions from authenticated;
grant select on public.agreement_versions to authenticated;

-- ---- 3. the current version, for the gate and the screens (Step 2 reads it) ---------------
create or replace function public.agreement_current_version()
returns integer language sql stable security definer set search_path = public as $$
  select max(version) from public.agreement_versions where effective_from <= current_date
$$;
revoke all on function public.agreement_current_version() from public, anon;
grant execute on function public.agreement_current_version() to authenticated;

-- ---- 4. read-back: compare each column to its _expect_ twin before calling this live --------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'agreement_versions') as tables, 1 as _expect_tables,
  (select relrowsecurity from pg_class where oid = 'public.agreement_versions'::regclass) as rls_on, true as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'agreement_versions') as policies, 1 as _expect_policies,
  has_table_privilege('authenticated', 'public.agreement_versions', 'select') as authenticated_reads, true as _expect_authenticated_reads,
  has_table_privilege('authenticated', 'public.agreement_versions', 'insert') as authenticated_inserts, false as _expect_authenticated_inserts,
  has_table_privilege('anon', 'public.agreement_versions', 'select') as anon_reads, false as _expect_anon_reads,
  has_function_privilege('authenticated', 'public.agreement_current_version()', 'execute') as current_version_callable, true as _expect_current_version_callable,
  (select count(*) from public.agreement_versions) as versions_seeded_so_far;

insert into public._prod_migrations(name) values ('20270284000000_agreement_versions.sql') on conflict (name) do nothing;

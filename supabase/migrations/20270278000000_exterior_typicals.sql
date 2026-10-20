-- =============================================================================
-- Exterior typicals (Exterior wizard v2 brief, S1 -- 19 Oct 2026)
--
-- One row per home shape the new outside path offers: the silhouette
-- (storeys, roof), the typical front and side lengths, the wall height, the
-- gable rise, which sides usually share a wall, whether the walls are usually
-- painted at all, and the picture starting texture. The shape never decides
-- the wall material (Tom, 12 Oct). Versioned like room_type_defaults, seeded
-- over the API by scripts/seed-exterior-typicals.ts from the same list that
-- lib/wizard/exterior-typicals.ts falls back to, Settings-editable later.
-- Every seeded row is source = proposed until Tom owns the number (brief
-- ruling 2).
--
-- Reads: the customer wizard runs with NO session (anon) and the builder with
-- one, so both roles may read; only staff write. Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

create table if not exists public.exterior_typicals (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  key text not null,
  name text not null,
  storeys int not null check (storeys in (1, 2)),
  roof text not null check (roof in ('hip', 'gable', 'parapet', 'skillion')),
  front_m numeric not null check (front_m > 0 and front_m <= 60),
  side_m numeric not null check (side_m > 0 and side_m <= 60),
  wall_h_m numeric not null check (wall_h_m > 0 and wall_h_m <= 12),
  gable_rise_m numeric check (gable_rise_m is null or (gable_rise_m >= 0 and gable_rise_m <= 6)),
  usual_walls text not null,
  walls_painted boolean not null default true,
  shared_sides text[] not null default '{}',
  verandah text not null default 'none' check (verandah in ('none', 'porch', 'columns', 'lace')),
  source text not null default 'proposed' check (source in ('proposed', 'tom')),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists exterior_typicals_unique
  on public.exterior_typicals (version, key);

alter table public.exterior_typicals enable row level security;

drop policy if exists exterior_typicals_read on public.exterior_typicals;
create policy exterior_typicals_read on public.exterior_typicals
  for select to anon, authenticated using (true);
drop policy if exists exterior_typicals_staff on public.exterior_typicals;
create policy exterior_typicals_staff on public.exterior_typicals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Since 20270201 nothing is granted by default: say who reads it.
grant select on public.exterior_typicals to anon, authenticated;
grant insert, update, delete on public.exterior_typicals to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ----
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exterior_typicals') as policies, 2 as _expect_policies,
  (select relrowsecurity from pg_class where oid = 'public.exterior_typicals'::regclass) as rls_on, true as _expect_rls_on,
  has_table_privilege('anon', 'public.exterior_typicals', 'select') as anon_reads, true as _expect_anon_reads,
  has_table_privilege('authenticated', 'public.exterior_typicals', 'select') as authenticated_reads, true as _expect_authenticated_reads,
  has_table_privilege('anon', 'public.exterior_typicals', 'insert') as anon_writes, false as _expect_anon_writes,
  (select count(*) from public.exterior_typicals where version = 1) as rows_v1, 0 as _expect_rows_v1_before_seed;

-- After the paste: npx tsx scripts/seed-exterior-typicals.ts (test) or
-- SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-exterior-typicals.ts --prod,
-- then expect 9 rows at version 1.

insert into public._prod_migrations(name) values ('20270278000000_exterior_typicals.sql') on conflict (name) do nothing;

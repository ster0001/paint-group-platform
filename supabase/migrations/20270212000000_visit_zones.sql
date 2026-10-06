-- =============================================================================
-- Visit zones (visit booking addendum A, S1 — 5 Oct 2026).
--
-- The property address decides how a site visit happens: one of five bookable
-- zones, a pre-arranged area (request a time, staff confirm), or out of area
-- (message only). Looked up by SUBURB AND POSTCODE together — Glen Waverley
-- (Zone 1) and Wheelers Hill (Zone 3) share 3150; Parkdale (Zone 1) and
-- Mordialloc (Zone 4) share 3195 — so postcode alone is wrong (addendum §4.1).
--
-- Three tables, all staff-only at the table layer. Customers never read them:
-- the resolver (lib/visits/zones.ts) runs on the server with the service
-- client, the same way /api/places/details reads `settings.service_area`.
--
--   visit_zones            — the five zones and which estimator covers each
--                            (R11: a zone belongs to one estimator at a time).
--   visit_suburbs          — every suburb + postcode with its status, the
--                            far-edge tick (R18) and whether Tom has reviewed
--                            it. Seeded by scripts/seed-visit-zones.ts from
--                            docs/briefs/data/visit-zones-review.csv, never by
--                            hand-written inserts.
--   visit_unmapped_suburbs — the FACT behind the work-queue item "unmapped
--                            suburb": a Victorian address the list did not
--                            know. Resolved when the suburb is added in
--                            Settings. Not a work_items table — the queue
--                            derives from it.
--
-- The five zone rows are structure, not data (the keys are fixed by the check
-- constraint), so they are created here with no estimator; Settings assigns one.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. zones -----------------------------------------------------------------
create table if not exists public.visit_zones (
  key          text primary key
    constraint visit_zones_key_check check (key in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5')),
  label        text not null,
  -- The estimator whose week this zone books into. Null = not assigned yet.
  estimator_id uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

insert into public.visit_zones (key, label) values
  ('zone_1', 'Zone 1 — CBD, bayside to Mentone and the inner east'),
  ('zone_2', 'Zone 2 — North and inner north'),
  ('zone_3', 'Zone 3 — Outer east and south east'),
  ('zone_4', 'Zone 4 — Bayside, Mordialloc to Mornington, inland to Lynbrook'),
  ('zone_5', 'Zone 5 — Inner west')
on conflict (key) do nothing;

alter table public.visit_zones enable row level security;
drop policy if exists visit_zones_staff_all on public.visit_zones;
create policy visit_zones_staff_all on public.visit_zones
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
revoke all on public.visit_zones from anon;
grant select, insert, update, delete on public.visit_zones to authenticated;

-- ---- 2. suburbs ---------------------------------------------------------------
create table if not exists public.visit_suburbs (
  id         uuid primary key default gen_random_uuid(),
  suburb     text not null
    constraint visit_suburbs_suburb_len check (char_length(btrim(suburb)) between 1 and 80),
  postcode   text not null
    constraint visit_suburbs_postcode_check check (postcode ~ '^[0-9]{4}$'),
  status     text not null
    constraint visit_suburbs_status_check check (status in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5', 'pre_arranged', 'out_of_area')),
  -- R18: a far-edge suburb cannot sit back to back with a far-edge suburb of the paired zone.
  far_edge   boolean not null default false,
  -- Tom has looked at this row (seeded true for every suburb in the rulings CSV).
  reviewed   boolean not null default false,
  -- Where the status came from: approved_on_map, named_by_tom, outline, settings.
  basis      text not null default 'settings'
    constraint visit_suburbs_basis_len check (char_length(basis) <= 60),
  -- The centre point the outline test used, for the review screen. Null when added by hand.
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One row per suburb + postcode, case-insensitively. The lookup index.
create unique index if not exists visit_suburbs_suburb_postcode_key
  on public.visit_suburbs (lower(btrim(suburb)), postcode);
create index if not exists visit_suburbs_suburb_idx on public.visit_suburbs (lower(btrim(suburb)));
create index if not exists visit_suburbs_status_idx on public.visit_suburbs (status);

alter table public.visit_suburbs enable row level security;
drop policy if exists visit_suburbs_staff_all on public.visit_suburbs;
create policy visit_suburbs_staff_all on public.visit_suburbs
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
revoke all on public.visit_suburbs from anon;
grant select, insert, update, delete on public.visit_suburbs to authenticated;

-- ---- 3. unmapped suburbs (the fact behind the work-queue item) ------------------
create table if not exists public.visit_unmapped_suburbs (
  id            uuid primary key default gen_random_uuid(),
  suburb        text not null
    constraint visit_unmapped_suburb_len check (char_length(btrim(suburb)) between 1 and 80),
  postcode      text not null default ''
    constraint visit_unmapped_postcode_check check (postcode = '' or postcode ~ '^[0-9]{4}$'),
  state         text not null default 'VIC',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  hits          integer not null default 1 check (hits >= 1),
  -- The last customer who hit it, so staff can follow up (either may be null).
  last_draft_id    uuid,
  last_estimate_id uuid references public.estimates (id) on delete set null,
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles (id) on delete set null
);
create unique index if not exists visit_unmapped_suburbs_key
  on public.visit_unmapped_suburbs (lower(btrim(suburb)), postcode);
create index if not exists visit_unmapped_suburbs_open_idx
  on public.visit_unmapped_suburbs (first_seen_at) where resolved_at is null;

alter table public.visit_unmapped_suburbs enable row level security;
drop policy if exists visit_unmapped_suburbs_staff_all on public.visit_unmapped_suburbs;
create policy visit_unmapped_suburbs_staff_all on public.visit_unmapped_suburbs
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
revoke all on public.visit_unmapped_suburbs from anon;
grant select, insert, update, delete on public.visit_unmapped_suburbs to authenticated;

-- ---- 4. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from public.visit_zones) as zones,
  5 as _expect_zones,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('visit_zones', 'visit_suburbs', 'visit_unmapped_suburbs')) as policies,
  3 as _expect_policies,
  (select count(*) from pg_tables where schemaname = 'public' and rowsecurity
     and tablename in ('visit_zones', 'visit_suburbs', 'visit_unmapped_suburbs')) as rls_on,
  3 as _expect_rls_on,
  (select count(*) from pg_indexes where schemaname = 'public'
     and indexname in ('visit_suburbs_suburb_postcode_key', 'visit_unmapped_suburbs_key')) as unique_keys,
  2 as _expect_unique_keys,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and table_name in ('visit_zones', 'visit_suburbs', 'visit_unmapped_suburbs')) as anon_grants,
  0 as _expect_anon_grants;

insert into public._prod_migrations(name) values ('20270212000000_visit_zones.sql') on conflict (name) do nothing;

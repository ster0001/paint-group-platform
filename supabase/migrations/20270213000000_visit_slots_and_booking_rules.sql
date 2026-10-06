-- =============================================================================
-- Visit schedule and booking rules (visit booking addendum A, S2 — 6 Oct 2026).
--
-- Each estimator has their own week (R11, R31): named slots, each listing the
-- zones that can book it, plus an optional conditional rule ("also Zone X if
-- the slot before is Zone Y" — R14, Friday 12:30). Every slot runs
-- `length_minutes` (R12: 90 — one hour with the customer, then 30 minutes of
-- travel). Two slots of one estimator can never overlap (section 8, test 18) —
-- the exclusion constraint is the last line of defence behind the server
-- action's own check.
--
-- The booking rules (R15, R16, R32, R33, R34, R36, R18, R6) are one JSON row in
-- `settings` under `visit_booking_rules`, edited at Settings → Booking rules.
-- The row is created here with the brief's starting values so the screen and
-- the availability function have one source from the first load. The public
-- holidays list starts EMPTY: S4 seeds it from the Victorian Government's
-- published list, with the dates reported for Tom to check.
--
-- `visits` gains `zone` and `far_edge`: the rules R14 and R18 read what zone a
-- CONFIRMED booking was in, frozen at booking (a suburb moved later must not
-- rewrite a booked day). S3 writes them.
--
-- The week itself is DATA, not structure: it is seeded by
-- scripts/seed-visit-week.ts (or "Load the standard week" in Settings) for a
-- named estimator, never by inserts here.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. slots ----------------------------------------------------------------
create table if not exists public.visit_slots (
  id             uuid primary key default gen_random_uuid(),
  estimator_id   uuid not null references public.profiles (id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday, Melbourne wall clock.
  weekday        smallint not null check (weekday between 0 and 6),
  -- Minutes after midnight, Melbourne wall clock (08:00 = 480).
  start_minutes  smallint not null check (start_minutes between 0 and 1439),
  length_minutes smallint not null default 90 check (length_minutes between 15 and 480),
  -- The zones that can book it. Empty is allowed (Settings warns nobody can book it).
  zones          text[] not null default '{}'
    constraint visit_slots_zones_check check (zones <@ array['zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5']::text[]),
  -- R14: also `cond_zone` if the slot directly before is a confirmed `cond_if_prev_zone` visit.
  cond_zone         text check (cond_zone is null or cond_zone in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5')),
  cond_if_prev_zone text check (cond_if_prev_zone is null or cond_if_prev_zone in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5')),
  constraint visit_slots_cond_pair check ((cond_zone is null) = (cond_if_prev_zone is null)),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint visit_slots_one_per_start unique (estimator_id, weekday, start_minutes)
);
create index if not exists visit_slots_estimator_idx on public.visit_slots (estimator_id, weekday, start_minutes);

-- Section 8, test 18: a slot that starts inside another slot's run is refused.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'btree_gist')
     and not exists (select 1 from pg_constraint where conname = 'visit_slots_no_overlap') then
    alter table public.visit_slots add constraint visit_slots_no_overlap
      exclude using gist (
        estimator_id with =,
        weekday with =,
        int4range(start_minutes::int, (start_minutes + length_minutes)::int, '[)') with &&
      );
  end if;
end $$;

alter table public.visit_slots enable row level security;
drop policy if exists visit_slots_staff_all on public.visit_slots;
create policy visit_slots_staff_all on public.visit_slots
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
revoke all on public.visit_slots from anon;
grant select, insert, update, delete on public.visit_slots to authenticated;

-- ---- 2. visits: the zone a confirmed booking was in ------------------------------
alter table public.visits add column if not exists zone text
  constraint visits_zone_check check (zone is null or zone in ('zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5'));
alter table public.visits add column if not exists far_edge boolean not null default false;
create index if not exists visits_staff_day_idx on public.visits (staff_id, starts_at) where status = 'booked';

-- ---- 3. booking rules: one settings row, the brief's starting values -------------
insert into public.settings (key, value) values ('visit_booking_rules', jsonb_build_object(
  'sameDay', true,
  'minNoticeMinutes', 120,
  'windowDays', 21,
  'holdMinutes', 10,
  'slotMinutes', 90,
  'visitMinutes', 60,
  'speakInteriorCapCents', 600000,
  'speakExteriorCapCents', 1200000,
  'reminderTime', '18:00',
  'publicHolidays', '[]'::jsonb,
  'farEdgePairs', '[["zone_4","zone_3"]]'::jsonb,
  'gateOrder', 'details_first'
)) on conflict (key) do nothing;

-- ---- 4. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'visit_slots') as slot_policies,
  1 as _expect_slot_policies,
  (select count(*) from pg_constraint where conname = 'visit_slots_no_overlap') as overlap_constraint,
  1 as _expect_overlap_constraint,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'visits' and column_name in ('zone', 'far_edge')) as visit_columns,
  2 as _expect_visit_columns,
  (select value ->> 'windowDays' from public.settings where key = 'visit_booking_rules') as window_days,
  '21' as _expect_window_days,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name = 'visit_slots') as anon_grants,
  0 as _expect_anon_grants;

insert into public._prod_migrations(name) values ('20270213000000_visit_slots_and_booking_rules.sql') on conflict (name) do nothing;

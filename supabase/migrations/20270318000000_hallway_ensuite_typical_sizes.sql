-- =============================================================================
-- Typical sizes: hallway 5 x 1.25 m, ensuite 2 x 1.5 m (Tom, 20 Nov 2026)
--
-- The wizard sizes a starter room from public.room_type_defaults. Two changes:
--   1. hallway: 6 x 2 was a mockup placeholder. The number from Tom
--      is 5 x 1.25. Only a row STILL at the placeholder is changed - a value
--      already edited in Settings is left exactly as it is.
--   2. ensuite: until now an ensuite borrowed the bathroom row. It gets its own
--      row (2 x 1.5), so changing the bathroom later never moves the ensuite.
--
-- Reference data, no schema change. Converges on a re-run: the update matches
-- nothing the second time, the insert conflicts and does nothing.
-- =============================================================================
set lock_timeout = '15s';

update public.room_type_defaults
   set typical_length_m = 5.0,
       typical_width_m  = 1.25,
       notes = '6.25 m2 - hall & entry (Tom, 20 Nov 2026)'
 where room_type = 'hallway'
   and typical_length_m = 6.0
   and typical_width_m  = 2.0;

insert into public.room_type_defaults (version, room_type, typical_length_m, typical_width_m, notes)
select b.version, 'ensuite', 2.0, 1.5, '3 m2 - ensuite, its own row (Tom, 20 Nov 2026)'
  from public.room_type_defaults b
 where b.room_type = 'bathroom'
on conflict (version, room_type) do nothing;

-- ---- Read-back: compare to the _expect_ values before calling this live -----
select
  (select count(*) from public.room_type_defaults where room_type = 'hallway' and typical_length_m = 6.0 and typical_width_m = 2.0) as hallway_still_placeholder, 0 as _expect_hallway_still_placeholder,
  (select string_agg(typical_length_m || ' x ' || typical_width_m, ', ' order by version) from public.room_type_defaults where room_type = 'hallway') as hallway_sizes, '5.0 x 1.25 (unless edited in Settings)' as _expect_hallway_sizes,
  (select count(*) from public.room_type_defaults where room_type = 'ensuite') as ensuite_rows,
  (select count(*) from public.room_type_defaults where room_type = 'bathroom') as _expect_ensuite_rows;

insert into public._prod_migrations(name) values ('20270318000000_hallway_ensuite_typical_sizes.sql') on conflict (name) do nothing;

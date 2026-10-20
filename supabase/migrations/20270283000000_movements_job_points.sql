-- =============================================================================
-- Movements, Session 6 (the Map part): real points on jobs. Brief flag 3 (geocode jobs,
-- filled lazily, suburb centroids until then) and rulings 21 and 22.
--
--   1. work_orders.lat / lng: where the job actually is. Null until the Map view has
--      resolved the address through the Places route (lib/places/geocodeAddress.ts);
--      point_checked_at stamps every attempt so a bad address is tried again at most
--      once a week, not on every render.
--   2. wo_set_point(work order, lat, lng): the ONE writer. Staff only; null lat/lng only
--      stamps the attempt. Nothing else writes the two columns.
--   3. movements_job_point prefers the real point and falls back to the suburb centroid,
--      so the sync (nearest branch) and Nearby use the same point the map draws.
--
-- Converges on a re-run: if not exists, or replace. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

alter table public.work_orders add column if not exists lat double precision;
alter table public.work_orders add column if not exists lng double precision;
alter table public.work_orders add column if not exists point_checked_at timestamptz;

alter table public.work_orders drop constraint if exists work_orders_lat_range;
alter table public.work_orders add constraint work_orders_lat_range check (lat is null or (lat >= -90 and lat <= 90));
alter table public.work_orders drop constraint if exists work_orders_lng_range;
alter table public.work_orders add constraint work_orders_lng_range check (lng is null or (lng >= -180 and lng <= 180));
alter table public.work_orders drop constraint if exists work_orders_point_pair;
alter table public.work_orders add constraint work_orders_point_pair check ((lat is null) = (lng is null));

-- 2. the one writer -----------------------------------------------------------------------
create or replace function public.wo_set_point(p_work_order_id uuid, p_lat double precision, p_lng double precision)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if (p_lat is null) <> (p_lng is null) then return 'error:bad_point'; end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180) then return 'error:bad_point'; end if;
  update public.work_orders
     set lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng), point_checked_at = now()
   where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  return case when p_lat is null then 'ok:checked' else 'ok:set' end;
end $$;
revoke all on function public.wo_set_point(uuid, double precision, double precision) from public, anon;
grant execute on function public.wo_set_point(uuid, double precision, double precision) to authenticated;

-- 3. the job point prefers the real one -------------------------------------------------------
create or replace function public.movements_job_point(p_work_order_id uuid, out lat double precision, out lng double precision)
language plpgsql stable set search_path = public as $$
declare v_addr text; part text;
begin
  select w.lat, w.lng, coalesce(w.wo_snapshot ->> 'jobAddress', '') into lat, lng, v_addr from public.work_orders w where w.id = p_work_order_id;
  if lat is not null and lng is not null then return; end if;
  lat := null; lng := null;
  foreach part in array string_to_array(coalesce(v_addr, ''), ',') loop
    part := btrim(regexp_replace(part, '\s+(VIC|Victoria)(\s+[0-9]{4})?\s*$', '', 'i'));
    if part = '' then continue; end if;
    select vs.lat, vs.lng into lat, lng from public.visit_suburbs vs
     where lower(btrim(vs.suburb)) = lower(part) order by vs.postcode limit 1;
    if lat is not null then return; end if;
  end loop;
end $$;
revoke all on function public.movements_job_point(uuid) from public, authenticated, anon;

-- read-back: compare to the _expect_ columns before calling it live ---------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'work_orders' and column_name in ('lat', 'lng', 'point_checked_at')) as point_columns, 3 as _expect_point_columns,
  (select count(*) from pg_constraint where conrelid = 'public.work_orders'::regclass and conname in ('work_orders_lat_range', 'work_orders_lng_range', 'work_orders_point_pair')) as point_checks, 3 as _expect_point_checks,
  has_function_privilege('authenticated', 'public.wo_set_point(uuid, double precision, double precision)', 'execute') as set_point_granted, true as _expect_set_point_granted,
  has_function_privilege('anon', 'public.wo_set_point(uuid, double precision, double precision)', 'execute') as set_point_anon, false as _expect_set_point_anon,
  (select prosrc like '%w.lat, w.lng%' from pg_proc where proname = 'movements_job_point' limit 1) as job_point_prefers_real, true as _expect_job_point_prefers_real,
  has_function_privilege('authenticated', 'public.movements_job_point(uuid)', 'execute') as job_point_client_callable, false as _expect_job_point_client_callable;

insert into public._prod_migrations(name) values ('20270283000000_movements_job_points.sql') on conflict (name) do nothing;

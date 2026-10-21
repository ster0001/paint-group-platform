-- =============================================================================
-- Run planner, refinements (Tom, 21 Oct 2026, evening): a rubbish chip published on an office
-- run is a collection — the rubbish rides in the car until the warehouse, no separate trip
-- and no tip run. movement_publish_run is re-emitted from 20270289 with that one branch.
-- Converging.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.movement_publish_run(p_person_kind text, p_person_id uuid, p_day date, p_stops jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare s jsonb; i int := 0; v_mid uuid; v_wo uuid; v_purpose text; v_time time; v_dur int; v_r text; v_ids uuid[] := '{}';
        v_visit uuid; v_title text; v_half text; v_kind public.movement_kind;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_day is null then return 'error:no_day'; end if;
  if p_person_kind not in ('profiles', 'contractors') then return 'error:bad_assignee'; end if;
  if p_person_kind = 'profiles' and not exists (select 1 from public.profiles where id = p_person_id) then return 'error:bad_assignee'; end if;
  if p_person_kind = 'contractors' and not exists (select 1 from public.contractors where id = p_person_id) then return 'error:bad_assignee'; end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) = 0 then return 'error:no_stops'; end if;

  for s in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    v_mid := nullif(s ->> 'movement_id', '')::uuid;
    v_wo := nullif(s ->> 'work_order_id', '')::uuid;
    v_purpose := coalesce(s ->> 'purpose', '');
    begin v_time := (s ->> 'time')::time; exception when others then return 'error:bad_time'; end;
    if v_time is null then return 'error:bad_time'; end if;
    v_dur := coalesce((s ->> 'duration_min')::int, 60);
    v_half := case when v_time < '12:00'::time then 'AM' else 'PM' end;

    if v_mid is null then
      if v_wo is null then return 'error:no_job'; end if;
      v_title := case v_purpose
        when 'collect_materials' then 'Collect materials'
        when 'quality_check' then 'Quality check'
        when 'site_checkin' then 'Site check-in'
        when 'rubbish_collection' then 'Rubbish collection'
        when 'drop_materials' then 'Drop off materials'
        when 'drop_paint' then 'Drop off paint'
        else null end;
      if v_title is null then return 'error:bad_purpose'; end if;
      if v_purpose = 'site_checkin' then
        select id into v_visit from public.wo_site_visits
         where work_order_id = v_wo and visited_at is null and scheduled_for is null
         order by created_at limit 1;
        if v_visit is not null then
          v_r := public.wo_site_visit_set_schedule(v_visit, p_day, v_time);
          if v_r not like 'ok%' then return 'error:stop_' || i || '_' || replace(v_r, 'error:', ''); end if;
          continue;
        end if;
      end if;
      v_r := public.movement_create(jsonb_build_object('kind', 'other', 'work_order_id', v_wo, 'title', v_title, 'detail', 'from the Map run plan'));
      if v_r not like 'ok:%' then return 'error:stop_' || i || '_' || replace(v_r, 'error:', ''); end if;
      v_mid := substr(v_r, 4)::uuid;
    end if;

    -- Tom, 21 Oct 2026 (evening): a rubbish chip on an office run is a COLLECTION — the bags
    -- ride in the car until the warehouse; no separate warehouse trip, no tip run.
    select kind into v_kind from public.movements where id = v_mid;
    if v_kind in ('rubbish_out', 'rubbish_in') and coalesce(v_purpose, '') in ('', 'rubbish_collection') then
      update public.movements
         set title = 'Rubbish — collected on the run', detail = 'collected on the run; stays in the car until the warehouse',
             to_kind = 'warehouse', to_text = 'Warehouse'
       where id = v_mid and status = 'tray';
    end if;
    v_r := public.movement_place(v_mid, 'person', p_person_id, p_day, v_half, v_time);
    if v_r not like 'ok%' then return 'error:stop_' || i || '_' || replace(v_r, 'error:', ''); end if;
    update public.movements set duration_min = least(600, greatest(15, v_dur)) where id = v_mid;
    v_ids := v_ids || v_mid;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    v_r := public.movement_set_sequence('person', p_person_id, p_day, v_ids);
    if v_r not like 'ok%' then return v_r; end if;
  end if;
  perform public.movements_event(null, 'run_published', jsonb_build_object('person_kind', p_person_kind, 'person_id', p_person_id, 'day', p_day, 'stops', i));
  return 'ok:' || i;
end $$;
revoke all on function public.movement_publish_run(text, uuid, date, jsonb) from public, anon;
grant execute on function public.movement_publish_run(text, uuid, date, jsonb) to authenticated;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'movement_publish_run' and pg_get_functiondef(p.oid) like '%collected on the run%') as publish_with_collection, 1 as _expect_publish_with_collection,
  has_function_privilege('authenticated', 'public.movement_publish_run(text, uuid, date, jsonb)', 'execute') as publish_granted, true as _expect_publish_granted;

insert into public._prod_migrations(name) values ('20270291000000_movements_run_rubbish_collection.sql') on conflict (name) do nothing;

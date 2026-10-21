-- =============================================================================
-- Movements, second batch (Tom, 21 Oct 2026, evening): the run planner on the Map and the
-- materials bubbles.
--
--   1. movements.duration_min: how long a stop takes (an hour unless changed), so a run plan
--      has an end time per stop and the office can adjust it. movement_set_duration writes it.
--   2. material_line_split: one item of a comma-separated materials line (tapes out of stock)
--      comes off the line and becomes its own line, so its own chip, in one transaction.
--   3. movement_publish_run: a run planned on the Map (stops in order, each a tray chip or a
--      purpose on a job: collect materials, quality check, site check-in, rubbish collection,
--      drop off materials, drop off paint) lands on the person for the day in ONE call:
--      every chip is placed at its time, a purpose with no chip becomes an other-kind
--      movement with that title, a site check-in uses the unscheduled check-in of the job when it
--      has one, the durations are written and the sequence is set. Nothing is posted until
--      the office presses Publish; before that the plan is only in the browser.
-- Converging. Comments carry no quotes (lib/sql/migrationPaste.test.ts).
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. how long a stop takes ------------------------------------------------------------
alter table public.movements add column if not exists duration_min integer not null default 60;
alter table public.movements drop constraint if exists movements_duration_min_check;
alter table public.movements add constraint movements_duration_min_check check (duration_min between 15 and 600);

create or replace function public.movement_set_duration(p_id uuid, p_minutes integer)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 600 then return 'error:bad_duration'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  update public.movements set duration_min = p_minutes where id = p_id;
  return 'ok:' || p_minutes;
end $$;
revoke all on function public.movement_set_duration(uuid, integer) from public, anon;
grant execute on function public.movement_set_duration(uuid, integer) to authenticated;

-- ---- 2. one item off a line becomes its own line (and chip) ----------------------------------
create or replace function public.material_line_split(p_id uuid, p_item text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.wo_material_lines%rowtype; v_item text; v_parts text[]; v_keep text[] := '{}'; v_found boolean := false; p text; v_new uuid; v_sort int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.wo_material_lines where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  v_item := btrim(coalesce(p_item, ''));
  if v_item = '' then return 'error:empty'; end if;
  v_parts := regexp_split_to_array(l.text, '\s*,\s*');
  foreach p in array v_parts loop
    if btrim(p) = '' then continue; end if;
    if not v_found and lower(btrim(p)) = lower(v_item) then v_found := true; else v_keep := v_keep || btrim(p); end if;
  end loop;
  if not v_found then return 'error:no_such_item'; end if;
  if coalesce(array_length(v_keep, 1), 0) = 0 then return 'error:last_item'; end if;
  update public.wo_material_lines set text = array_to_string(v_keep, ', ') where id = p_id;
  select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = l.work_order_id;
  insert into public.wo_material_lines (work_order_id, text, source, sort, created_by)
    values (l.work_order_id, left(v_item, 500), l.source, v_sort, auth.uid()) returning id into v_new;
  perform public.movements_event(l.work_order_id, 'material_line_split', jsonb_build_object('line_id', p_id, 'item', v_item, 'new_line_id', v_new));
  perform public.movements_sync_for_wo(l.work_order_id);
  return 'ok:' || v_new;
end $$;
revoke all on function public.material_line_split(uuid, text) from public, anon;
grant execute on function public.material_line_split(uuid, text) to authenticated;

-- ---- 3. publish a run planned on the Map ---------------------------------------------------
-- p_stops: a jsonb array, in run order, each {movement_id | work_order_id, purpose, time, duration_min}.
-- purpose: collect_materials, quality_check, site_checkin, rubbish_collection, drop_materials, drop_paint.
create or replace function public.movement_publish_run(p_person_kind text, p_person_id uuid, p_day date, p_stops jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare s jsonb; i int := 0; v_mid uuid; v_wo uuid; v_purpose text; v_time time; v_dur int; v_r text; v_ids uuid[] := '{}';
        v_visit uuid; v_title text; v_half text;
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
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'movements' and column_name = 'duration_min') as duration_column, 1 as _expect_duration_column,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('movement_set_duration', 'material_line_split', 'movement_publish_run')) as new_functions, 3 as _expect_new_functions,
  has_function_privilege('authenticated', 'public.movement_publish_run(text, uuid, date, jsonb)', 'execute') as publish_granted, true as _expect_publish_granted,
  has_function_privilege('authenticated', 'public.material_line_split(uuid, text)', 'execute') as split_granted, true as _expect_split_granted;

insert into public._prod_migrations(name) values ('20270289000000_movements_run_planner.sql') on conflict (name) do nothing;

-- =============================================================================
-- Photos per JOB, not per area (Tom, 30 Sep 2026: "instead of contractors
-- clicking to add before pictures for each side, a Step 1 · upload before
-- photos button … once uploaded they have access to the work order to mark
-- prepped and done"; after photos "per job — write for the contractor to
-- take photos of all rooms or all sides").
--
-- Two gates, both on the whole job:
--   · a BEFORE photo (any area, any surface) unlocks every tick on the job —
--     wo_tick_surface refuses the first tick with error:before_photo_required:job;
--   · a COMPLETION photo is needed before the painter can FINISH —
--     wo_contractor_finish refuses with error:after_photos_required. Ticking
--     a row done no longer asks for a finished shot of its area.
-- "Photos not required" on a line (20270198) still means that line ticks
-- without any photo on the job.
--
-- Two regressions in the live wo_tick_surface come right on the way, both
-- found by reading the migration chain (20270159 → 20270178 → 20270198/200):
--   · crew ownership — 20270159 let anyone ASSIGNED to the job tick
--     (wo_painter_on_job); 20270178 onward silently went back to the lead
--     only, so an employed crew member got error:not_yours;
--   · the all_surfaces_done event (20270178, the dashboard's "finished on
--     site" fact) was dropped from the body in 20270198.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- A photo of this kind anywhere on the job. Helper for definer functions: no grant.
create or replace function public.wo_has_job_photo(p_work_order_id uuid, p_kind public.wo_photo_kind)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wo_photos where work_order_id = p_work_order_id and kind = p_kind);
$$;

create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_gated boolean; v_all_done boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    -- The lead OR anyone assigned to the job (employed crew, 20270159).
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- A row the office marked "photos not required" never asks for one (20270198).
  v_gated := not coalesce(v_s.photos_optional, false);

  -- Step 1 (Tom, 30 Sep): the job's before photos, once, unlock every row.
  if v_gated and p_to <> 'todo' and not public.wo_has_job_photo(v_s.work_order_id, 'before') then
    return 'error:before_photo_required:job';
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  -- Dashboard 0c: the tick that finishes the JOB is a fact worth one row.
  -- Written once — a later un-tick and re-tick does not move it.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id
         and not coalesce(removed_from_scope, false) and state <> 'done'
    ) into v_all_done;
    if v_all_done and not exists (
      select 1 from public.wo_events
       where work_order_id = v_s.work_order_id and type = 'all_surfaces_done'
    ) then
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_s.work_order_id, 'all_surfaces_done', auth.uid(), v_kind,
                jsonb_build_object('last_surface_id', p_surface_id));
    end if;
  end if;

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

-- Step 3: the after photos — all rooms or all sides — before the job can finish.
create or replace function public.wo_contractor_finish(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_open integer; v_result text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;
  if v_wo.stage is distinct from 'in_progress' then return 'error:not_in_progress'; end if;

  -- Tom, 30 Sep: no finish without the job's after photos. A job whose every
  -- row is "photos not required" is exempt — nothing on it asked for a photo.
  if not public.wo_has_job_photo(p_work_order_id, 'completion')
     and exists (select 1 from public.wo_surfaces
                  where work_order_id = p_work_order_id
                    and not coalesce(removed_from_scope, false) and not coalesce(photos_optional, false)) then
    return 'error:after_photos_required';
  end if;

  perform public.wo_schedule_qa(p_work_order_id);

  v_result := public.wo_advance_stage(p_work_order_id, 'completion_prep',
                jsonb_build_object('via', 'contractor_finish'));
  if v_result not like 'ok:%' and v_result <> 'ok' then return v_result; end if;

  -- Prep pops up WITH its list — an empty prep screen is a dead end.
  perform public.wo_seed_prep_checklist(p_work_order_id);

  v_open := public.wo_qa_open_count(p_work_order_id);

  if v_open > 0 then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'qa_pending_notice', auth.uid(),
              case when public.is_staff() then 'staff' else 'contractor' end,
              jsonb_build_object('open_checks', v_open));
    return 'ok:completion_prep:qa_pending';
  end if;
  return 'ok:completion_prep';
end $$;
grant execute on function public.wo_contractor_finish(uuid) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select prosrc like '%before_photo_required:job%' and prosrc not like '%after_photo_required%' and prosrc like '%wo_painter_on_job%' and prosrc like '%all_surfaces_done%'
     from pg_proc where proname = 'wo_tick_surface') as tick_per_job, true as _expect_tick_per_job,
  (select prosrc like '%after_photos_required%' from pg_proc where proname = 'wo_contractor_finish') as finish_gated, true as _expect_finish_gated,
  (select has_function_privilege('authenticated', 'public.wo_tick_surface(uuid, public.wo_surface_state)', 'execute')) as tick_granted, true as _expect_tick_granted,
  (select has_function_privilege('authenticated', 'public.wo_contractor_finish(uuid)', 'execute')) as finish_granted, true as _expect_finish_granted,
  (select has_function_privilege('authenticated', 'public.wo_has_job_photo(uuid, public.wo_photo_kind)', 'execute')) as helper_not_granted, false as _expect_helper_not_granted;

insert into public._prod_migrations(name) values ('20270207000000_wo_photos_per_job.sql') on conflict (name) do nothing;

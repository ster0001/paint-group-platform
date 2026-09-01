-- Tom's 1 Sep batch: the FINISHED photo is now required, not invited.
--
-- Rule: the tick that would COMPLETE an area (every non-removed surface on the
-- heading done) is refused until a 'completion' photo exists for that heading —
-- the exact mirror of the before-photo gate on the FIRST tick. The tick lists
-- prompt for the shot before the tap ever reaches the server (TickList opens
-- the picker on the completing tap); this gate is the backstop so two phones,
-- a stale screen, or a deleted photo can't slide past it.
--
-- wo_has_after_photo mirrors wo_has_before_photo (20260930). wo_tick_surface
-- body copied faithfully from 20261116000000_variation_signature_working_scope.sql
-- with ONLY the after-photo gate added.

create or replace function public.wo_has_after_photo(p_work_order_id uuid, p_heading text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.wo_photos p
     where p.work_order_id = p_work_order_id
       and p.kind = 'completion'
       and (p.area = p_heading
            or p.surface_id in (
              select s.id from public.wo_surfaces s
               where s.work_order_id = p_work_order_id and s.heading = p_heading))
  );
$$;

create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean; v_completes boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  -- Struck by a signed credit: display-only from here on.
  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  -- Ticking only makes sense while the job is being worked. QA fails and
  -- walkthrough flags both return the job to in_progress, which is exactly why
  -- rectification uses this same list rather than a parallel one.
  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- The gate: is anything on this elevation already under way?
  select not exists (
    select 1 from public.wo_surfaces
     where work_order_id = v_s.work_order_id and heading = v_s.heading and state <> 'todo'
  ) into v_first_tick;

  if v_first_tick and p_to <> 'todo'
     and not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
    return 'error:before_photo_required:' || v_s.heading;
  end if;

  -- The other end (Tom, 1 Sep): the tick that would finish the area needs the
  -- finished shot on record first. Removed rows don't count — an area whose
  -- only unticked rows were struck by a signed credit is finished.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id and heading = v_s.heading
         and id <> v_s.id and not coalesce(removed_from_scope, false)
         and state <> 'done'
    ) into v_completes;
    if v_completes and not public.wo_has_after_photo(v_s.work_order_id, v_s.heading) then
      return 'error:after_photo_required:' || v_s.heading;
    end if;
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

-- ---- readback -------------------------------------------------------------
-- Expect: wo_has_after_photo exists, and wo_tick_surface's source carries the
-- after_photo_required refusal.
select
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'wo_has_after_photo') as helper_present,
  position('after_photo_required' in pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'wo_tick_surface'))) > 0 as gate_present;

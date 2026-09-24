-- =============================================================================
-- Photo rules on the tick list (Tom, 24 Sep 2026):
--
--   6. "Photos not required" on a specific line in the scope — a fuel
--      allowance, a site set-up line — so the painter is not asked for a
--      before/finished shot of something that is not a surface.
--      wo_surfaces.photos_optional, set from the PC job page. A heading's
--      photo asks are then computed over its PHOTO rows only: an optional row
--      never triggers the before gate or the finished gate, and a heading with
--      no photo rows asks for nothing.
--   7. Jobs of three days or less need ONE before and ONE finished photo for
--      the whole job, not one per area. Booked span = work_orders.start_date
--      → end_date (kept in step with the booking by trigger); the threshold is
--      Settings → work-order loop → photoMinimums.shortJobDays (default 3).
--      Nothing in the loop ever asked for a MID-JOB photo — progress shots
--      were always optional — so there is nothing to switch off there.
--
-- wo_tick_surface is the 20261220 body with only the gate arithmetic changed.
-- The tick lists mirror both rules client-side (lib/workorder/surfaces.ts) so
-- the painter meets them as a prompt, never as a refusal; the server decides.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 6a. the mark ------------------------------------------------------------------
alter table public.wo_surfaces add column if not exists photos_optional boolean not null default false;

create or replace function public.wo_set_surface_photos_optional(p_surface_id uuid, p_optional boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_stage public.wo_stage;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;
  select stage into v_stage from public.work_orders where id = v_s.work_order_id;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if v_s.photos_optional = p_optional then return 'ok:' || p_optional::text; end if;

  update public.wo_surfaces set photos_optional = p_optional where id = p_surface_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_photos_optional', auth.uid(), 'staff',
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'optional', p_optional));
  return 'ok:' || p_optional::text;
end $$;
grant execute on function public.wo_set_surface_photos_optional(uuid, boolean) to authenticated;

-- ---- 7a. how photos are counted on this job: per area, or one for the job -------------
create or replace function public.wo_photo_scope(p_work_order_id uuid)
returns text language sql stable set search_path = public as $$
  select case
    when w.start_date is not null and w.end_date is not null
         and (w.end_date - w.start_date + 1)
             <= coalesce((public.wo_loop_setting(array['photoMinimums','shortJobDays']))::text::integer, 3)
      then 'job'
    else 'area' end
    from public.work_orders w where w.id = p_work_order_id;
$$;
grant execute on function public.wo_photo_scope(uuid) to authenticated, service_role;

create or replace function public.wo_has_job_photo(p_work_order_id uuid, p_kind public.wo_photo_kind)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.wo_photos p
                  where p.work_order_id = p_work_order_id and p.kind = p_kind);
$$;
grant execute on function public.wo_has_job_photo(uuid, public.wo_photo_kind) to authenticated, service_role;

-- ---- the gate: 20261220 body, arithmetic over photo rows + job scope -------------------
create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean; v_completes boolean; v_scope text; v_gated boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- NEW: a row the office marked "photos not required" never asks for one.
  v_gated := not coalesce(v_s.photos_optional, false);
  v_scope := public.wo_photo_scope(v_s.work_order_id);

  if v_gated then
    -- The gate: is any PHOTO row on this elevation already under way?
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id and heading = v_s.heading
         and not coalesce(photos_optional, false) and state <> 'todo'
    ) into v_first_tick;

    if v_first_tick and p_to <> 'todo' then
      if v_scope = 'job' then
        -- NEW: a short job — one before shot anywhere on the job is enough.
        if not public.wo_has_job_photo(v_s.work_order_id, 'before') then
          return 'error:before_photo_required:' || v_s.heading;
        end if;
      elsif not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
        return 'error:before_photo_required:' || v_s.heading;
      end if;
    end if;

    if p_to = 'done' then
      select not exists (
        select 1 from public.wo_surfaces
         where work_order_id = v_s.work_order_id and heading = v_s.heading
           and id <> v_s.id and not coalesce(removed_from_scope, false)
           and not coalesce(photos_optional, false)
           and state <> 'done'
      ) into v_completes;
      if v_completes then
        if v_scope = 'job' then
          if not public.wo_has_job_photo(v_s.work_order_id, 'completion') then
            return 'error:after_photo_required:' || v_s.heading;
          end if;
        elsif not public.wo_has_after_photo(v_s.work_order_id, v_s.heading) then
          return 'error:after_photo_required:' || v_s.heading;
        end if;
      end if;
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

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_surfaces' and column_name = 'photos_optional') as optional_col, true as _expect_optional_col,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wo_set_surface_photos_optional', 'wo_photo_scope', 'wo_has_job_photo')) as new_fns, 3 as _expect_new_fns,
  (select prosrc like '%photos_optional%' and prosrc like '%wo_photo_scope%' from pg_proc where proname = 'wo_tick_surface' limit 1) as gate_reads_both, true as _expect_gate_reads_both,
  (select has_function_privilege('authenticated', 'public.wo_set_surface_photos_optional(uuid, boolean)', 'execute')) as set_granted, true as _expect_set_granted;

insert into public._prod_migrations(name) values ('20270198000000_wo_photos_optional_short_jobs.sql') on conflict (name) do nothing;

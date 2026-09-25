-- =============================================================================
-- Photos: every area keeps its own before and finished shot (Tom, 25 Sep 2026:
-- "I still require all areas to have a before and after photo, unless we tick
-- otherwise — please revert back to how it was previously").
--
-- 20270198 (yesterday) added TWO things: "photos not required" on a single
-- line (kept — that is the "unless we tick otherwise"), and a one-before-one-
-- after rule for jobs of three days or fewer (reverted here). wo_tick_surface
-- is the 20270198 body with the job-scope arms removed, so the gates are the
-- 20261220 per-area rule counted over the rows that still need photos. The
-- two helpers only the short-job rule used are dropped.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean; v_completes boolean; v_gated boolean;
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

  -- A row the office marked "photos not required" never asks for one (20270198).
  v_gated := not coalesce(v_s.photos_optional, false);

  if v_gated then
    -- The gate: is any PHOTO row on this elevation already under way?
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id and heading = v_s.heading
         and not coalesce(photos_optional, false) and state <> 'todo'
    ) into v_first_tick;

    if v_first_tick and p_to <> 'todo'
       and not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
      return 'error:before_photo_required:' || v_s.heading;
    end if;

    -- The other end (Tom, 1 Sep): the tick that would finish the area's photo
    -- rows needs the finished shot on record first. Removed rows don't count.
    if p_to = 'done' then
      select not exists (
        select 1 from public.wo_surfaces
         where work_order_id = v_s.work_order_id and heading = v_s.heading
           and id <> v_s.id and not coalesce(removed_from_scope, false)
           and not coalesce(photos_optional, false)
           and state <> 'done'
      ) into v_completes;
      if v_completes and not public.wo_has_after_photo(v_s.work_order_id, v_s.heading) then
        return 'error:after_photo_required:' || v_s.heading;
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

drop function if exists public.wo_photo_scope(uuid);
drop function if exists public.wo_has_job_photo(uuid, public.wo_photo_kind);

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select prosrc like '%photos_optional%' and prosrc not like '%wo_photo_scope%' from pg_proc where proname = 'wo_tick_surface' limit 1) as gate_per_area_with_optional_rows, true as _expect_gate_per_area_with_optional_rows,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wo_photo_scope', 'wo_has_job_photo')) as short_job_helpers_left, 0 as _expect_short_job_helpers_left;

insert into public._prod_migrations(name) values ('20270200000000_wo_photo_rules_per_area.sql') on conflict (name) do nothing;

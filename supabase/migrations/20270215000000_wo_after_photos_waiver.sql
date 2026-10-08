-- =============================================================================
-- After photos: the office can waive them, on the record (6 Oct 2026).
--
-- Tom, 6 Oct: two jobs (568 Collins St, 40 Jacka Blvd) sat at In progress
-- with every box ticked and nothing the office could press. The finish RPC
-- (20270207) refuses without the job's after photos — Tom's 30 Sep rule for
-- the PAINTER — and the console had no way past it except marking every line
-- "photos not required", which misdescribes the scope. (The console also
-- dropped that refusal and showed "not at prep"; that half is in the app.)
--
--   wo_after_photos_waived       helper, no grant: is a waiver on record?
--   wo_staff_waive_after_photos  staff-only RPC: records the waiver as a
--                                wo_event carrying the reason. Never a column
--                                on the job — the event IS the record (who,
--                                when, why), and it shows on the timeline.
--   wo_contractor_finish         20270207 body, the gate honouring the waiver.
--
-- The painter's rule stands: only is_staff() can waive.
-- Converges on a re-run: or-replace throughout, the grant is idempotent.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. is a waiver on record? ------------------------------------------------
create or replace function public.wo_after_photos_waived(p_work_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wo_events
     where work_order_id = p_work_order_id and type = 'after_photos_waived'
  );
$$;
revoke execute on function public.wo_after_photos_waived(uuid) from public, anon, authenticated;

-- ---- 2. the office waives, with a reason --------------------------------------
create or replace function public.wo_staff_waive_after_photos(p_work_order_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'in_progress' then return 'error:not_in_progress'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then return 'error:reason_required'; end if;

  if public.wo_has_job_photo(p_work_order_id, 'completion') then return 'ok:not_needed'; end if;
  if public.wo_after_photos_waived(p_work_order_id) then return 'ok:already'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'after_photos_waived', auth.uid(), 'staff',
            jsonb_build_object('reason', trim(p_reason)));
  return 'ok:waived';
end $$;
grant execute on function public.wo_staff_waive_after_photos(uuid, text) to authenticated;

-- ---- 3. the finish honours the waiver (20270207 body otherwise unchanged) -----
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
  -- Tom, 6 Oct: so is a job the OFFICE has waived them on, with a reason.
  if not public.wo_has_job_photo(p_work_order_id, 'completion')
     and not public.wo_after_photos_waived(p_work_order_id)
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

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select prosrc like '%wo_after_photos_waived%' from pg_proc where proname = 'wo_contractor_finish') as finish_honours_waiver, true as _expect_finish_honours_waiver,
  (select has_function_privilege('authenticated', 'public.wo_staff_waive_after_photos(uuid, text)', 'execute')) as waive_granted, true as _expect_waive_granted,
  (select has_function_privilege('authenticated', 'public.wo_after_photos_waived(uuid)', 'execute')) as helper_not_granted, false as _expect_helper_not_granted,
  (select has_function_privilege('authenticated', 'public.wo_contractor_finish(uuid)', 'execute')) as finish_granted, true as _expect_finish_granted;

insert into public._prod_migrations(name) values ('20270215000000_wo_after_photos_waiver.sql') on conflict (name) do nothing;

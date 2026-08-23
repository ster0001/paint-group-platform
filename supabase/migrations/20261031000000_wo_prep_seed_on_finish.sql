-- =============================================================================
-- Follow-up to 20261030, found the same evening: the painter's Finish moved
-- the job to completion prep, but the prep CHECKLIST never appeared — the
-- stage-entry trigger doesn't seed prep items, wo_seed_prep_checklist does,
-- and it was staff-only. The painter arrived at prep with an empty screen:
-- the exact dead-end class the qa stage had this morning.
--
-- Two changes: the seeder admits the ASSIGNED contractor, and the finish
-- seeds on the way through — so prep "pops up" the moment the ticks are done.
-- =============================================================================

-- ORIGINAL 20261005 body verbatim — labels, sort column and all — with ONLY
-- the permission line extended to the assigned contractor.
create or replace function public.wo_seed_prep_checklist(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_rubbish text; v_made integer := 0; v_item record; v_wo public.work_orders%rowtype;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  v_rubbish := coalesce(public.wo_loop_setting(array['rubbish','organisedBy'])::text, '"pc"');

  for v_item in
    select * from (values
      ('Touch-up sweep done', 1),
      ('Site left clean', 2),
      (case when v_rubbish = '"pc"' then 'Rubbish collected — courier booked by the office'
            else 'Rubbish removed' end, 3),
      ('Equipment return booked', 4),
      ('Final photos taken of every area', 5)
    ) as t(label, sort)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id
                      and phase = 'completion_prep' and label = v_item.label) then
      insert into public.wo_checklist_items (work_order_id, phase, label, required, sort)
        values (p_work_order_id, 'completion_prep', v_item.label, true, v_item.sort);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_prep_checklist(uuid) to authenticated, service_role;

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

  perform public.wo_schedule_qa(p_work_order_id);

  v_result := public.wo_advance_stage(p_work_order_id, 'completion_prep',
                jsonb_build_object('via', 'contractor_finish'));
  if v_result not like 'ok:%' and v_result <> 'ok' then return v_result; end if;

  -- Prep pops up WITH its list — an empty prep screen is a dead end.
  perform public.wo_seed_prep_checklist(p_work_order_id);

  select count(*) into v_open from public.wo_qa_checks
   where work_order_id = p_work_order_id and (result is null or result = 'fail');

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

-- Verification: as the assigned contractor, wo_contractor_finish on an
-- in-progress job with all surfaces done → stage completion_prep AND
-- select count(*) from wo_checklist_items where phase='completion_prep' > 0.
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('wo_seed_prep_checklist','wo_contractor_finish');

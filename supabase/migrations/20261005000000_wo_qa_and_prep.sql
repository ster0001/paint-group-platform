-- =============================================================================
-- WO completion loop, step 5a — QA checks and the completion-prep checklist
--
-- A QA FAIL DOES NOT CREATE A PARALLEL WORLD. It appends rectification rows to
-- wo_surfaces — the same tick list the painter already uses — and puts the job
-- back to in_progress. There is one list of work on a job, always, and the only
-- thing that marks rectification out is a flag on the row.
--
-- Photo minimums (⚑5) are a FLAG, not a gate: a QA check with a thin photo
-- record still passes, and says so in its event. Tom's call, and the right one —
-- a rule that blocks the honest inspector is a rule that gets worked around.
-- =============================================================================

alter table public.wo_qa_checks
  add column if not exists photo_count integer not null default 0,
  add column if not exists thin_record boolean not null default false;

-- ---- who gets checked -------------------------------------------------------
-- New contractors, for their first N jobs (⚑1, Settings). "New" counts jobs
-- they have actually finished, not jobs they were offered.
create or replace function public.wo_contractor_is_new(p_contractor_id uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select count(*) from public.work_orders
      where contractor_id = p_contractor_id and stage = 'closed'),
    0
  ) < coalesce((public.wo_loop_setting(array['qaCadence','newContractorJobs']))::text::integer, 3);
$$;

create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'ok:0'; end if;
  if not public.wo_contractor_is_new(v_wo.contractor_id) then return 'ok:0'; end if;

  for v_kind in
    select jsonb_array_elements_text(public.wo_loop_setting(array['qaCadence','checks']))
  loop
    if not exists (select 1 from public.wo_qa_checks
                    where work_order_id = p_work_order_id and kind = v_kind) then
      insert into public.wo_qa_checks (work_order_id, kind, scheduled_for)
        values (p_work_order_id, v_kind,
                case when v_kind = 'day_one' then v_wo.start_date else null end);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_schedule_qa(uuid) to authenticated, service_role;

-- ---- recording a check ------------------------------------------------------
-- p_rectify: [{"heading": "Left", "label": "Re-sand and recoat lower boards"}]
create or replace function public.wo_record_qa(
  p_check_id uuid, p_result text, p_notes text default '', p_rectify jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare v_c public.wo_qa_checks%rowtype; v_photos integer; v_min integer; v_thin boolean;
        v_added integer := 0; v_sort integer; v_r jsonb;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_result not in ('pass', 'fail') then return 'error:bad_result'; end if;

  select * into v_c from public.wo_qa_checks where id = p_check_id for update;
  if not found then return 'error:not_found'; end if;
  if v_c.result is not null then return 'error:already_' || v_c.result; end if;

  select count(*) into v_photos
    from public.wo_photos
   where work_order_id = v_c.work_order_id and kind = 'qa';

  v_min := coalesce((public.wo_loop_setting(array['photoMinimums','perQaCheck']))::text::integer, 3);
  v_thin := v_photos < v_min;

  update public.wo_qa_checks
     set result = p_result, notes = coalesce(p_notes, ''), checked_by = auth.uid(),
         checked_at = now(), photo_count = v_photos, thin_record = v_thin
   where id = p_check_id;

  if p_result = 'fail' then
    select coalesce(max(sort), 0) into v_sort
      from public.wo_surfaces where work_order_id = v_c.work_order_id;

    for v_r in select * from jsonb_array_elements(coalesce(p_rectify, '[]'::jsonb))
    loop
      v_sort := v_sort + 1;
      insert into public.wo_surfaces
          (work_order_id, heading, heading_meta, label, sort, rectification, source_ref)
        values (v_c.work_order_id,
                coalesce(v_r->>'heading', 'Rectification'), 'raised by QA',
                coalesce(v_r->>'label', 'Rectification'), v_sort, true, p_check_id);
      v_added := v_added + 1;
    end loop;

    -- Back to the painter, on the same list.
    perform public.wo_set_stage(v_c.work_order_id, 'in_progress', 'staff',
      jsonb_build_object('qa_check_id', p_check_id, 'rectifications', v_added, 'via', 'qa_fail'));
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_c.work_order_id, 'qa_' || p_result, auth.uid(), 'staff',
            jsonb_build_object('check_id', p_check_id, 'kind', v_c.kind,
                               'photos', v_photos, 'thin_record', v_thin,
                               'rectifications', v_added, 'notes', coalesce(p_notes, '')));

  return 'ok:' || p_result || case when v_thin then ':thin_record' else '' end;
end $$;
grant execute on function public.wo_record_qa(uuid, text, text, jsonb) to authenticated;

-- ---- completion prep --------------------------------------------------------
create or replace function public.wo_seed_prep_checklist(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_rubbish text; v_made integer := 0; v_item record;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;

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

create or replace function public.wo_tick_checklist_item(p_item_id uuid, p_done boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare v_i public.wo_checklist_items%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
begin
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_i.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  update public.wo_checklist_items
     set done_at = case when p_done then now() else null end,
         done_by = case when p_done then auth.uid() else null end
   where id = p_item_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_i.work_order_id, 'checklist_ticked', auth.uid(), v_kind,
            jsonb_build_object('item_id', p_item_id, 'label', v_i.label,
                               'phase', v_i.phase::text, 'done', p_done));

  return 'ok:' || case when p_done then 'done' else 'undone' end;
end $$;
grant execute on function public.wo_tick_checklist_item(uuid, boolean) to authenticated;

-- ---- gates ------------------------------------------------------------------
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer;
begin
  if p_from = 'in_progress' and p_to in ('qa', 'completion_prep') then
    select count(*), count(*) filter (where state = 'done')
      into v_total, v_done from public.wo_surfaces where work_order_id = p_wo_id;
    if v_total > 0 and v_done < v_total then
      return (v_total - v_done)::text || ' of ' || v_total::text || ' surfaces still to tick off';
    end if;
  end if;

  if p_to <> 'in_progress' and p_to <> 'offered' then
    select count(*) into v_waiting
      from public.wo_variations
     where work_order_id = p_wo_id and status in ('raised', 'priced', 'customer_approved');
    if v_waiting > 0 then
      return v_waiting::text || ' variation' || case when v_waiting = 1 then '' else 's' end
             || ' still waiting on a decision';
    end if;
  end if;

  -- QA: every scheduled check answered, and answered pass.
  if p_from = 'qa' and p_to = 'completion_prep' then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
    if v_open > 0 then
      return v_open::text || ' QA check' || case when v_open = 1 then '' else 's' end || ' still open';
    end if;
  end if;

  -- Prep: every required item ticked before the customer is asked to look.
  if p_from = 'completion_prep' and p_to = 'walkthrough' then
    select count(*) into v_open
      from public.wo_checklist_items
     where work_order_id = p_wo_id and phase = 'completion_prep'
       and required = true and done_at is null;
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  -- walkthrough -> closed is gated inside wo_sign, which is transactional.
  return null;
end $$;

-- ---- Verification -----------------------------------------------------------
--   select public.wo_schedule_qa('<wo>');    -> 'ok:2' for a new contractor, 'ok:0' otherwise
--   select public.wo_record_qa('<check>', 'fail', 'Lower boards patchy',
--            '[{"heading":"Left","label":"Re-sand and recoat lower boards"}]');
--     -> 'ok:fail:thin_record' (with <3 QA photos), the job is back at in_progress,
--        and the rectification row is in wo_surfaces with rectification = true

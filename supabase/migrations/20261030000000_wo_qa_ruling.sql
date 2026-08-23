-- =============================================================================
-- QA ruling + merged prep flow (Tom, 23 Aug):
--
--   ticks done → PREP, always → prep confirmed → QUALITY CHECK (new or
--   flagged contractor) or straight to SIGN-OFF. No final sign-off date with
--   the client until the checks pass.
--
-- The stage order changes: prep now comes BEFORE quality check. The whole
-- transition table is re-seeded (two pairs are REMOVED, upsert can't do
-- that); lib/workorder/stages.ts mirrors THIS file and its drift test reads
-- it. Existing jobs mid-flight keep their stage; every stage remains reachable.
-- =============================================================================

alter table public.contractors
  add column if not exists requires_qa boolean not null default false;

-- ---- 1. the canonical matrix -------------------------------------------------
delete from public.wo_stage_transitions;
insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',       array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff']),
  ('in_progress',     'completion_prep', 'all surfaces done — prep begins',     array['system','staff','contractor']),
  ('completion_prep', 'qa',              'prep confirmed — quality check due',  array['system','staff','contractor']),
  ('completion_prep', 'walkthrough',     'prep confirmed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'walkthrough',     'quality check passed — evidence pack delivered', array['system','staff']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer']);

-- ---- 2. the gates, re-keyed to the new order ---------------------------------
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer;
begin
  if p_from = 'pre_start' and p_to = 'in_progress' then
    if not public.wo_colours_confirmed(p_wo_id) then
      return 'the colour schedule is not finalised yet';
    end if;
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'pre_start'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' pre-start item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  if p_from = 'in_progress' and p_to = 'completion_prep' then
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

  -- Prep gates BOTH exits: the checklist is confirmed before quality check
  -- and before the pack alike.
  if p_from = 'completion_prep' and p_to in ('qa', 'walkthrough') then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'completion_prep'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  -- Nobody walks around the quality check: the pack cannot go out while a
  -- check is unpassed — from prep OR from the qa stage itself.
  if p_to = 'walkthrough' then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  return null;
end $$;

-- ---- 3. scheduling reads new-OR-flagged; assigned contractor may invoke ------
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_flagged boolean;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;

  select requires_qa into v_flagged from public.contractors where id = v_wo.contractor_id;
  if not (public.wo_contractor_is_new(v_wo.contractor_id) or coalesce(v_flagged, false)) then
    return 'ok:0';
  end if;

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

-- ---- 4. the painter finishes: ticks done → prep, always ----------------------
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

  -- Schedule now, so the painter is TOLD about the check while prepping, not
  -- surprised by it after.
  perform public.wo_schedule_qa(p_work_order_id);

  v_result := public.wo_advance_stage(p_work_order_id, 'completion_prep',
                jsonb_build_object('via', 'contractor_finish'));
  if v_result not like 'ok:%' and v_result <> 'ok' then return v_result; end if;

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

-- ---- 5. prep confirmed: the SERVER routes — quality check or sign-off --------
create or replace function public.wo_contractor_confirm_prep(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_open integer; v_result text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;
  if v_wo.stage is distinct from 'completion_prep' then return 'error:not_at_prep'; end if;

  select count(*) into v_open from public.wo_qa_checks
   where work_order_id = p_work_order_id and (result is null or result = 'fail');

  if v_open > 0 then
    -- Quality check before sign-off. The prep gate runs inside the advance.
    v_result := public.wo_advance_stage(p_work_order_id, 'qa',
                  jsonb_build_object('via', 'prep_confirmed'));
    if v_result not like 'ok:%' and v_result <> 'ok' then return v_result; end if;
    return 'ok:qa';
  end if;

  -- No check due: prep confirmed IS the handover — the pack goes out and the
  -- sign-off begins. Gates (prep items, variations) run inside the advance
  -- that wo_deliver_evidence_pack performs.
  v_result := public.wo_deliver_evidence_pack(p_work_order_id);
  if v_result not like 'ok:%' then return v_result; end if;
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_contractor_confirm_prep(uuid) to authenticated;

-- ---- 6. pack delivery: the assigned contractor's confirm may trigger it ------
create or replace function public.wo_deliver_evidence_pack(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_hours integer; v_token text; v_clock boolean; v_deadline timestamptz;
        v_kind text; v_blocked text; v_wo public.work_orders%rowtype;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif public.current_contractor_id() is not null
        and public.current_contractor_id() = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_staff';
  end if;

  -- Check the gate BEFORE minting anything: a blocked advance must not leave
  -- a signoff row and a live customer token behind it.
  v_blocked := public.wo_gate_blocked(p_work_order_id, v_wo.stage, 'walkthrough');
  if v_blocked is not null then return 'error:gate:' || v_blocked; end if;

  v_clock := coalesce(public.wo_loop_setting(array['signoff','clockEnabled']) = 'true'::jsonb, false);
  v_hours := coalesce((public.wo_loop_setting(array['signoff','residentialHours']))::text::integer, 72);
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_deadline := case when v_clock then now() + make_interval(hours => v_hours) else null end;

  insert into public.wo_signoff (work_order_id, evidence_pack_sent_at, deadline_at, customer_token)
    values (p_work_order_id, now(), v_deadline, v_token)
  on conflict (work_order_id) do update
    set evidence_pack_sent_at = coalesce(public.wo_signoff.evidence_pack_sent_at, now()),
        deadline_at = coalesce(public.wo_signoff.deadline_at, excluded.deadline_at),
        customer_token = coalesce(public.wo_signoff.customer_token, excluded.customer_token);

  select customer_token into v_token from public.wo_signoff where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'evidence_pack_sent', auth.uid(), v_kind,
            jsonb_build_object('deadline_at', v_deadline, 'clock_enabled', v_clock));

  perform public.wo_set_stage(p_work_order_id, 'walkthrough', v_kind,
                              jsonb_build_object('via', 'evidence_pack'));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_deliver_evidence_pack(uuid) to authenticated, service_role;

-- ---- 7. no final sign-off date until the checks pass -------------------------
create or replace function public.wo_book_walkthrough(
  p_work_order_id uuid, p_kind text, p_date date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_date date; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('pre', 'final') then return 'error:bad_kind'; end if;

  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if p_kind = 'final' and exists (
    select 1 from public.wo_qa_checks
     where work_order_id = p_work_order_id and (result is null or result = 'fail')
  ) then
    return 'error:qa_first';
  end if;

  v_date := p_date;
  if v_date is null and p_kind = 'final' then
    select bo.end_date into v_date
      from public.booking_offers bo
     where bo.work_order_id = p_work_order_id and bo.state = 'accepted'
     order by bo.accepted_at desc nulls last limit 1;
  end if;
  if v_date is null then return 'error:no_date'; end if;

  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = p_kind and status = 'booked';

  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, booked_by, note)
    values (p_work_order_id, p_kind, v_date, auth.uid(), coalesce(p_note, ''))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_booked', auth.uid(), 'staff',
            jsonb_build_object('walkthrough_id', v_id, 'kind', p_kind, 'date', v_date));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_book_walkthrough(uuid, text, date, text) to authenticated;

-- ---- 8. the staff switch: always quality checked ------------------------------
create or replace function public.set_contractor_requires_qa(p_contractor_id uuid, p_requires boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.contractors set requires_qa = p_requires where id = p_contractor_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:' || p_requires::text;
end $$;
grant execute on function public.set_contractor_requires_qa(uuid, boolean) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- Expect 10 rows, and NO in_progress→qa or qa→completion_prep:
select from_stage, to_stage from public.wo_stage_transitions order by from_stage, to_stage;
-- Expect requires_qa present:
select column_name from information_schema.columns
 where table_name = 'contractors' and column_name = 'requires_qa';
-- Expect 6 rows, all true:
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_schedule_qa', 'wo_contractor_finish', 'wo_contractor_confirm_prep',
                     'wo_deliver_evidence_pack', 'wo_book_walkthrough', 'set_contractor_requires_qa')
 order by p.proname;

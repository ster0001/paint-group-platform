-- =============================================================================
-- 6 Sep 2026 — a failed quality check gets its own re-check.
--
-- THE GAP (found by e2e/help-capture/work-orders.spec.ts): PC fails the final
-- check → job back to In progress → painter rectifies and finishes again → job
-- back at Quality check, where the ONLY card is the failed one, "Logged: FAIL",
-- no controls. wo_record_qa refuses a second log on it (already_fail),
-- wo_schedule_qa creates nothing (a 'final' already exists), and every gate
-- counts `result = 'fail'` as open. The job is parked for ever; the only way
-- through was an administrator editing wo_qa_checks (which is exactly what
-- wo-full-loop step 7 did to pass).
--
-- THE RULE (Tom, 23 Aug: QA is ours, and a passed check must move the job on):
--   · A FAIL is a record, not a state to reset. It stays as logged — notes,
--     the standards that were ticked, the photos, the rectification rows'
--     source_ref — and it spawns its successor in the same statement: a fresh
--     check of the SAME kind, `retry_of` = the failed check, standards seeded by
--     the existing trigger, result null.
--   · A failed check counts as open ONLY until its re-check exists; the
--     re-check then carries the job's openness (null = open, pass = clear,
--     fail = another re-check). One predicate, `wo_qa_open_count`, replaces the
--     five copies of `result is null or result = 'fail'`.
--   · Nothing else changes: the painter's re-finish routes to qa because the
--     re-check is open; the PC works the new card; the LAST pass routes the job
--     through wo_qa_route_passed exactly as before.
--
-- Bodies below are the newest ones VERBATIM with only the predicate swapped:
--   wo_gate_blocked (20261116), wo_contractor_finish (20261031),
--   wo_contractor_confirm_prep + wo_qa_route_passed + wo_record_qa (20261110),
--   wo_book_walkthrough 5-arg (20261125).
-- =============================================================================

-- ---- 1. the link -----------------------------------------------------------
alter table public.wo_qa_checks
  add column if not exists retry_of uuid references public.wo_qa_checks (id) on delete set null;
create index if not exists wo_qa_checks_retry_of_idx
  on public.wo_qa_checks (retry_of) where retry_of is not null;

-- ---- 2. one definition of "open" -------------------------------------------
-- null = not yet logged; fail = open until a re-check row points at it.
create or replace function public.wo_qa_open_count(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select count(*)::integer
    from public.wo_qa_checks c
   where c.work_order_id = p_work_order_id
     and (c.result is null
          or (c.result = 'fail'
              and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id)));
$$;
grant execute on function public.wo_qa_open_count(uuid) to authenticated, service_role;

-- ---- 3. wo_record_qa: a FAIL spawns its re-check ---------------------------
create or replace function public.wo_record_qa(
  p_check_id uuid, p_result text, p_notes text default '', p_rectify jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare v_c public.wo_qa_checks%rowtype; v_photos integer; v_min integer; v_thin boolean;
        v_added integer := 0; v_sort integer; v_r jsonb; v_left integer; v_route text;
        v_recheck uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_result not in ('pass', 'fail') then return 'error:bad_result'; end if;

  select * into v_c from public.wo_qa_checks where id = p_check_id for update;
  if not found then return 'error:not_found'; end if;
  if v_c.result is not null then return 'error:already_' || v_c.result; end if;

  if p_result = 'pass' then
    v_left := public.wo_qa_outstanding(p_check_id);
    if v_left > 0 then return 'error:standards_outstanding:' || v_left::text; end if;
  end if;

  select count(*) into v_photos
    from public.wo_photos where work_order_id = v_c.work_order_id and kind = 'qa';

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
        values (v_c.work_order_id, coalesce(v_r->>'heading', 'Rectification'), 'raised by QA',
                coalesce(v_r->>'label', 'Rectification'), v_sort, true, p_check_id);
      v_added := v_added + 1;
    end loop;

    -- NEW: the re-check, same kind, linked. Its standards seed by trigger.
    -- Undated: it is due when the painter finishes again, not on a day.
    insert into public.wo_qa_checks (work_order_id, kind, retry_of)
      values (v_c.work_order_id, v_c.kind, p_check_id) returning id into v_recheck;

    perform public.wo_set_stage(v_c.work_order_id, 'in_progress', 'staff',
      jsonb_build_object('qa_check_id', p_check_id, 'rectifications', v_added, 'via', 'qa_fail',
                         'recheck_id', v_recheck));
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_c.work_order_id, 'qa_' || p_result, auth.uid(), 'staff',
            jsonb_build_object('check_id', p_check_id, 'kind', v_c.kind,
                               'photos', v_photos, 'thin_record', v_thin,
                               'rectifications', v_added, 'notes', coalesce(p_notes, ''),
                               'recheck_id', v_recheck, 'retry_of', v_c.retry_of));

  if p_result = 'pass' then
    v_route := public.wo_qa_route_passed(v_c.work_order_id);
    if v_route = 'ok:walkthrough' then
      return 'ok:pass:walkthrough' || case when v_thin then ':thin_record' else '' end;
    elsif v_route = 'ok:closed' then
      return 'ok:pass:closed' || case when v_thin then ':thin_record' else '' end;
    elsif v_route like 'error:gate:%' then
      return 'ok:pass:gate:' || substr(v_route, length('error:gate:') + 1);
    end if;
  end if;

  return 'ok:' || p_result || case when v_thin then ':thin_record' else '' end;
end $$;
grant execute on function public.wo_record_qa(uuid, text, text, jsonb) to authenticated;

-- ---- 4. the gate: 20261116 body, predicate swapped (both QA arms) -----------
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer; v_txt text;
begin
  if p_from = 'pre_start' and p_to = 'in_progress' then
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
      into v_total, v_done from public.wo_surfaces
     where work_order_id = p_wo_id and not removed_from_scope;
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

  -- Prep gates every exit: quality check, the pack, or straight to closed.
  if p_from = 'completion_prep' and p_to in ('qa', 'walkthrough', 'closed') then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'completion_prep'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  -- Nobody walks around the quality check — not to the pack, not to closed.
  -- A failed check is open until its re-check exists (20270112).
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
    -- NEW (Tom, 23 Aug): colour-match codes before the hand-over.
    v_txt := public.wo_colour_match_outstanding(p_wo_id);
    if v_txt <> '' then
      return 'colour match codes still needed for ' || v_txt;
    end if;
  end if;

  -- The walkthrough → closed sign path keeps its own QA guard (was p_to = 'walkthrough' only).
  if p_to = 'walkthrough' and p_from = 'closed' then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  return null;
end $$;

-- ---- 5. the painter's own finish: 20261031 body, predicate swapped ----------
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

-- ---- 6. prep confirmed routes: 20261110 body, predicate swapped -------------
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

  v_open := public.wo_qa_open_count(p_work_order_id);

  if v_open > 0 then
    v_result := public.wo_advance_stage(p_work_order_id, 'qa',
                  jsonb_build_object('via', 'prep_confirmed'));
    if v_result not like 'ok:%' and v_result <> 'ok' then return v_result; end if;
    return 'ok:qa';
  end if;

  -- NEW: no walkthrough on this job — it closes here (invoice stage).
  if not coalesce(v_wo.walkthrough_required, true) then
    v_result := public.wo_close_without_walkthrough(p_work_order_id);
    if v_result not like 'ok:%' then return v_result; end if;
    return 'ok:closed';
  end if;

  v_result := public.wo_deliver_evidence_pack(p_work_order_id);
  if v_result not like 'ok:%' then return v_result; end if;
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_contractor_confirm_prep(uuid) to authenticated;

-- ---- 7. a passed check routes: 20261110 body, predicate swapped -------------
create or replace function public.wo_qa_route_passed(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_total integer; v_open integer; v_r text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or public.wo_is_system()
          or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;

  if v_wo.stage is distinct from 'qa' then return 'ok:0'; end if;

  select count(*) into v_total
    from public.wo_qa_checks where work_order_id = p_work_order_id;
  v_open := public.wo_qa_open_count(p_work_order_id);
  if v_total = 0 or v_open > 0 then return 'ok:0'; end if;

  -- NEW: no walkthrough on this job — straight to closed.
  if not coalesce(v_wo.walkthrough_required, true) then
    v_r := public.wo_close_without_walkthrough(p_work_order_id);
    if v_r not like 'ok:%' then return v_r; end if;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'qa_passed_routed', auth.uid(),
              case when public.is_staff() then 'staff'
                   when public.wo_is_system() then 'system'
                   else 'contractor' end,
              jsonb_build_object('checks', v_total, 'to', 'closed'));
    return 'ok:closed';
  end if;

  v_r := public.wo_deliver_evidence_pack(p_work_order_id);
  if v_r not like 'ok:%' then return v_r; end if;
  perform public.wo_generate_report_draft(p_work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_passed_routed', auth.uid(),
            case when public.is_staff() then 'staff'
                 when public.wo_is_system() then 'system'
                 else 'contractor' end,
            jsonb_build_object('checks', v_total));
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_qa_route_passed(uuid) to authenticated, service_role;

-- ---- 8. no final sign-off date until the checks pass: 20261125 body ---------
create or replace function public.wo_book_walkthrough(
  p_work_order_id uuid, p_kind text, p_date date default null,
  p_note text default '', p_time time default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_date date; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('pre', 'final') then return 'error:bad_kind'; end if;

  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if p_kind = 'final' and public.wo_qa_open_count(p_work_order_id) > 0 then
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

  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, scheduled_time, booked_by, note)
    values (p_work_order_id, p_kind, v_date, p_time, auth.uid(), coalesce(p_note, ''))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_booked', auth.uid(), 'staff',
            jsonb_build_object('walkthrough_id', v_id, 'kind', p_kind,
                               'date', v_date, 'time', p_time));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_book_walkthrough(uuid, text, date, text, time) to authenticated;

-- ---- 9. backfill: every parked fail gets its re-check -----------------------
-- A failed check with no successor on a job that is not closed is exactly the
-- parked state this fixes. Closed jobs keep their history as it is.
insert into public.wo_qa_checks (work_order_id, kind, retry_of)
select c.work_order_id, c.kind, c.id
  from public.wo_qa_checks c
  join public.work_orders w on w.id = c.work_order_id
 where c.result = 'fail'
   and w.stage <> 'closed'
   and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id);

-- ---- read-back: ONE row, every column true ---------------------------------
do $$
declare v_col int; v_fn int;
begin
  select count(*) into v_col from information_schema.columns
   where table_schema = 'public' and table_name = 'wo_qa_checks' and column_name = 'retry_of';
  if v_col <> 1 then raise exception 'wo_qa_checks.retry_of missing'; end if;
  select count(*) into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wo_qa_open_count';
  if v_fn <> 1 then raise exception 'wo_qa_open_count missing'; end if;
end $$;

select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_qa_checks' and column_name = 'retry_of') as retry_col,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_qa_open_count') as open_fn,
  (select prosrc like '%retry_of%' from pg_proc where proname = 'wo_record_qa' limit 1) as record_spawns_recheck,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_contractor_finish' limit 1) as finish_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_contractor_confirm_prep' limit 1) as confirm_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_qa_route_passed' limit 1) as route_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_book_walkthrough' limit 1) as book_uses_it,
  (select count(*) from public.wo_qa_checks c join public.work_orders w on w.id = c.work_order_id
    where c.result = 'fail' and w.stage <> 'closed'
      and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id)) = 0 as no_parked_fails;

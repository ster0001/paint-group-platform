-- =============================================================================
-- Quality check: the missing "open check" predicate, and the re-check a FAIL
-- spawns (Tom, 24 Sep 2026: "I am trying to do a quality check and it is
-- coming up with 'function public.wo_qa_open_count(uuid) does not exist'").
--
-- WHAT HAPPENED: 20270173 (pre-start list, on main and live) copied the
-- wo_gate_blocked body from the fix/qa-recheck branch, whose migration
-- 20270112 defined wo_qa_open_count — but that branch was never merged, so
-- the gate on production calls a function nothing ever created. plpgsql
-- resolves the call at run time, so every OTHER gate arm kept working and the
-- fault showed only on the quality-check arms: the last PASS routes the job
-- (wo_qa_route_passed → wo_deliver_evidence_pack → wo_gate_blocked) and dies.
--
-- THE FIX is the 20270112 design, brought onto main as this file (the bodies
-- below are the branch's, checked against the newest definitions on main —
-- wo_gate_blocked is already 20270173's and needs no change):
--   · wo_qa_checks.retry_of — a re-check points at the check it re-inspects;
--   · wo_qa_open_count(wo) — null = open; fail = open until a re-check row
--     points at it; pass = clear. ONE predicate for every gate;
--   · wo_record_qa's FAIL inserts the successor (same kind, standards seeded
--     by the existing trigger, undated) before moving the job back. A fail is
--     a record, never reset — the parked-for-ever job (6 Sep) cannot recur;
--   · wo_contractor_finish, wo_contractor_confirm_prep, wo_qa_route_passed and
--     wo_book_walkthrough read the predicate (bodies otherwise verbatim from
--     20261031 / 20261110 / 20261125);
--   · backfill: every parked fail on an open job gets its re-check.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the link -----------------------------------------------------------
alter table public.wo_qa_checks
  add column if not exists retry_of uuid references public.wo_qa_checks (id) on delete set null;
create index if not exists wo_qa_checks_retry_of_idx
  on public.wo_qa_checks (retry_of) where retry_of is not null;

-- ---- 2. one definition of "open" -------------------------------------------
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

    -- The re-check, same kind, linked. Its standards seed by trigger.
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

-- ---- 4. the painter's own finish: 20261031 body, predicate swapped ----------
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

-- ---- 5. prep confirmed routes: 20261110 body, predicate swapped -------------
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

-- ---- 6. a passed check routes: 20261110 body, predicate swapped -------------
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

-- ---- 7. no final sign-off date until the checks pass: 20261125 body ---------
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

-- ---- 8. backfill: every parked fail gets its re-check -----------------------
insert into public.wo_qa_checks (work_order_id, kind, retry_of)
select c.work_order_id, c.kind, c.id
  from public.wo_qa_checks c
  join public.work_orders w on w.id = c.work_order_id
 where c.result = 'fail'
   and w.stage <> 'closed'
   and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id);

-- ---- read-back: ONE row, every column equals its _expect_ -------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_qa_checks' and column_name = 'retry_of') as retry_col, true as _expect_retry_col,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_qa_open_count') as open_fn, true as _expect_open_fn,
  (select prosrc like '%retry_of%' from pg_proc where proname = 'wo_record_qa' limit 1) as record_spawns_recheck, true as _expect_record_spawns_recheck,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_uses_it, true as _expect_gate_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_contractor_finish' limit 1) as finish_uses_it, true as _expect_finish_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_contractor_confirm_prep' limit 1) as confirm_uses_it, true as _expect_confirm_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_qa_route_passed' limit 1) as route_uses_it, true as _expect_route_uses_it,
  (select prosrc like '%wo_qa_open_count%' from pg_proc where proname = 'wo_book_walkthrough' limit 1) as book_uses_it, true as _expect_book_uses_it,
  (select count(*) from public.wo_qa_checks c join public.work_orders w on w.id = c.work_order_id
    where c.result = 'fail' and w.stage <> 'closed'
      and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id)) as parked_fails, 0 as _expect_parked_fails;

insert into public._prod_migrations(name) values ('20270196000000_wo_qa_recheck.sql') on conflict (name) do nothing;

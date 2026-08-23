-- =============================================================================
-- A passed quality check ROUTES THE JOB ITSELF (Tom, 23 Aug, second ruling):
--
--   "When the quality check is passed it should automatically go to the
--    walkthrough stage for both staff and contractor. The contractor shouldn't
--    see anything related to sending anything to the customer."
--
-- The first cut did this app-side, on one staff screen only — a pass logged
-- any other way left the job parked at qa with a "send" button on the
-- painter's page. Now the DATABASE does it:
--   · wo_record_qa: the LAST pass delivers the pack (stage → walkthrough,
--     customer token minted) and drafts the report;
--   · wo_qa_route_passed: the same move for a job already sitting passed-at-qa,
--     callable by staff, the assigned contractor (both portals self-heal on
--     view) and the sweep (system backstop);
--   · wo_generate_report_draft admits the system actor for the sweep.
-- =============================================================================

-- ---- 1. the draft report, system-callable ----------------------------------
-- 20261028 body VERBATIM except the permission line and the actor_kind.
create or replace function public.wo_generate_report_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_report jsonb; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or public.wo_is_system()
          or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'draft', true,
    'generated_at', now(),
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = p_work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = p_work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = p_work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = p_work_order_id)
  ) into v_report;

  insert into public.wo_reports (work_order_id, kind, body)
    values (p_work_order_id, 'draft', v_report) returning id into v_id;

  update public.wo_signoff set report_draft_id = v_id where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor,
                                actor_kind, meta)
    values (p_work_order_id, 'report_drafted', auth.uid(),
            case when public.is_staff() then 'staff'
                 when public.wo_is_system() then 'system'
                 else 'contractor' end,
            jsonb_build_object('report_id', v_id));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_generate_report_draft(uuid) to authenticated, service_role;

-- ---- 2. route a job whose checks have ALL passed ----------------------------
-- 'ok:walkthrough' when it moved · 'ok:0' when there is nothing to do (not at
-- qa, no checks, or one still open) · 'error:gate:…' when the pack gate
-- refuses (a variation waiting on a decision) — the job stays at qa and the
-- screens say why.
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

  select count(*), count(*) filter (where result is null or result = 'fail')
    into v_total, v_open
    from public.wo_qa_checks where work_order_id = p_work_order_id;
  if v_total = 0 or v_open > 0 then return 'ok:0'; end if;

  -- The pack delivery mints the customer's link and moves the stage; its own
  -- gate still runs. Then the draft report travels with it (best-effort).
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

-- ---- 3. the last PASS routes, inside the record itself ----------------------
-- 20261016 body VERBATIM; the routing is appended after the event insert.
-- Returns 'ok:pass' (a check still open) · 'ok:pass:walkthrough' (moved) ·
-- 'ok:pass:gate:<reason>' (moved nothing — the reason is for the screen) ·
-- 'ok:fail' — ':thin_record' is still appended when the photo record is thin.
create or replace function public.wo_record_qa(
  p_check_id uuid, p_result text, p_notes text default '', p_rectify jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare v_c public.wo_qa_checks%rowtype; v_photos integer; v_min integer; v_thin boolean;
        v_added integer := 0; v_sort integer; v_r jsonb; v_left integer; v_route text;
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

    perform public.wo_set_stage(v_c.work_order_id, 'in_progress', 'staff',
      jsonb_build_object('qa_check_id', p_check_id, 'rectifications', v_added, 'via', 'qa_fail'));
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_c.work_order_id, 'qa_' || p_result, auth.uid(), 'staff',
            jsonb_build_object('check_id', p_check_id, 'kind', v_c.kind,
                               'photos', v_photos, 'thin_record', v_thin,
                               'rectifications', v_added, 'notes', coalesce(p_notes, '')));

  -- NEW: the last pass sends the job on. A pass with a sibling check still
  -- open routes nothing (ok:0) and reads as a plain pass.
  if p_result = 'pass' then
    v_route := public.wo_qa_route_passed(v_c.work_order_id);
    if v_route = 'ok:walkthrough' then
      return 'ok:pass:walkthrough' || case when v_thin then ':thin_record' else '' end;
    elsif v_route like 'error:gate:%' then
      return 'ok:pass:gate:' || substr(v_route, length('error:gate:') + 1);
    end if;
  end if;

  return 'ok:' || p_result || case when v_thin then ':thin_record' else '' end;
end $$;
grant execute on function public.wo_record_qa(uuid, text, text, jsonb) to authenticated;

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'wo_qa_route_passed') as route_fn,
  (select count(*) from pg_proc where proname = 'wo_record_qa') as record_fn,
  (select prosrc like '%wo_qa_route_passed%' from pg_proc where proname = 'wo_record_qa' limit 1) as record_routes,
  (select prosrc like '%wo_is_system%' from pg_proc where proname = 'wo_generate_report_draft' limit 1) as draft_system_ok;

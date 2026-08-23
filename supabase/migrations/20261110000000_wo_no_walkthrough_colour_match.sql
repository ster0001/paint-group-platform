-- =============================================================================
-- Tom, 23 Aug (batch 4) — paste AFTER 20261109:
--   1. "Walkthrough not required" when booking a job in: work_orders.
--      walkthrough_required=false → after the painter finishes (and the quality
--      check passes, if one is due) the job goes STRAIGHT TO CLOSED — invoice
--      stage — no customer walkthrough. wo_close_without_walkthrough writes the
--      same record a signing would (report, warranty, invoice stub, review
--      follow-up) so nothing downstream is missing.
--   2. Pre-start list: the derived "QA schedule created" item goes; "Customer
--      'what to expect'" becomes the OPTIONAL "Pre-start checklist" (ticked =
--      the office emails the customer the checklist N days before the start;
--      template + N live in Settings → Messaging); "Colour schedule finalised"
--      becomes a YES/NO question — No means colour matches are needed.
--   3. Colour match: the estimator marks a substrate "colour match" (code,
--      brand, can size) — or leaves it to the painter, who supplies the codes
--      from the job (wo_set_colour_match); the pack / close is GATED until every
--      required code is in.
-- =============================================================================

-- ---- 1a. the flag -----------------------------------------------------------
alter table public.work_orders add column if not exists walkthrough_required boolean not null default true;

create or replace function public.wo_set_walkthrough_required(p_work_order_id uuid, p_required boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.work_orders set walkthrough_required = p_required where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:' || p_required::text;
end $$;
grant execute on function public.wo_set_walkthrough_required(uuid, boolean) to authenticated;

-- ---- 1b. the matrix: two straight-to-closed rows -------------------------------
delete from public.wo_stage_transitions;
insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',       array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff']),
  ('in_progress',     'completion_prep', 'all surfaces done — prep begins',     array['system','staff','contractor']),
  ('completion_prep', 'qa',              'prep confirmed — quality check due',  array['system','staff','contractor']),
  ('completion_prep', 'walkthrough',     'prep confirmed — evidence pack delivered', array['system','staff','contractor']),
  ('completion_prep', 'closed',          'prep confirmed — no walkthrough required', array['system','staff','contractor']),
  ('qa',              'walkthrough',     'quality check passed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'closed',          'quality check passed — no walkthrough required', array['system','staff','contractor']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer']),
  ('closed',          'walkthrough',     'reopened after sign-off',             array['staff']);

-- ---- 3a. colour matches: what is still owed ------------------------------------
-- A product needs codes when the estimator flagged it for a colour match, OR the
-- pre-start colours question was answered No and the product has no colour at
-- all. Codes can come from the estimate (snapshot) or the painter
-- (work_orders.colours -> product -> match). Returns a comma list, '' when clear.
create or replace function public.wo_colour_match_outstanding(p_work_order_id uuid)
returns text language sql stable set search_path = public as $$
  with w as (
    select wo_snapshot, colours,
           exists (select 1 from public.wo_checklist_items i
                    where i.work_order_id = p_work_order_id and i.phase = 'pre_start'
                      and i.item_key = 'colours' and i.answer = 'no') as colours_no
      from public.work_orders where id = p_work_order_id
  ),
  m as (
    select x->>'product' as product,
           coalesce((x->'colourMatch'->>'required')::boolean, false) as flagged,
           coalesce(x->>'colourName', '') as colour,
           coalesce(x->'colourMatch'->>'code', '') as snap_code,
           coalesce(w.colours -> (x->>'product') -> 'match' ->> 'code', '') as wo_code,
           w.colours_no
      from w, jsonb_array_elements(coalesce(w.wo_snapshot->'materials', '[]'::jsonb)) x
  )
  select coalesce(string_agg(product, ', ' order by product), '')
    from m
   where (flagged or (colours_no and colour = ''))
     and snap_code = '' and wo_code = '';
$$;
grant execute on function public.wo_colour_match_outstanding(uuid) to authenticated, service_role;

-- ---- 3b. the painter (or office) supplies the codes -----------------------------
create or replace function public.wo_set_colour_match(
  p_work_order_id uuid, p_product text, p_code text, p_brand text default '', p_can_size text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if coalesce(trim(p_product), '') = '' then return 'error:no_product'; end if;
  if coalesce(trim(p_code), '') = '' then return 'error:no_code'; end if;

  update public.work_orders
     set colours = coalesce(colours, '{}'::jsonb)
         || jsonb_build_object(p_product,
              coalesce(colours -> p_product, '{}'::jsonb)
              || jsonb_build_object('match', jsonb_build_object(
                   'code', trim(p_code), 'brand', coalesce(trim(p_brand), ''),
                   'canSize', coalesce(trim(p_can_size), ''), 'by', v_kind, 'at', now())))
   where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'colour_match_supplied', auth.uid(), v_kind,
            jsonb_build_object('product', p_product, 'code', trim(p_code),
                               'brand', coalesce(trim(p_brand), ''), 'can_size', coalesce(trim(p_can_size), '')));
  return 'ok';
end $$;
grant execute on function public.wo_set_colour_match(uuid, text, text, text, text) to authenticated;

-- ---- 3c. the gate: 20261101 body + closed arms + the colour-match clause ------
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
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
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

-- ---- 1c. close without a walkthrough --------------------------------------------
-- The record a signing would have written, minus the signature: report frozen,
-- warranty from the close date, the review follow-up, the invoice stub. Callable
-- by staff, the system (sweep) and the assigned contractor (the routed press).
create or replace function public.wo_close_without_walkthrough(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_r text; v_start date; v_report jsonb;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if coalesce(v_wo.walkthrough_required, true) then return 'error:walkthrough_required'; end if;
  if v_wo.stage not in ('completion_prep', 'qa') then return 'error:not_ready'; end if;

  v_r := public.wo_set_stage(p_work_order_id, 'closed', v_kind,
           jsonb_build_object('via', 'no_walkthrough'));
  if v_r not like 'ok:%' then return v_r; end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', 'No walkthrough required', 'signed_kind', 'no_walkthrough',
    'captured_on', null,
    'warranty_starts', v_start,
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
             from public.wo_qa_checks where work_order_id = p_work_order_id),
    'areas', '{}'::jsonb
  ) into v_report;

  insert into public.wo_signoff (work_order_id, signed_at, signed_name, signed_kind, report)
    values (p_work_order_id, now(), 'No walkthrough required', 'no_walkthrough', v_report)
  on conflict (work_order_id) do update
    set signed_at = coalesce(public.wo_signoff.signed_at, now()),
        signed_name = coalesce(public.wo_signoff.signed_name, 'No walkthrough required'),
        signed_kind = coalesce(public.wo_signoff.signed_kind, 'no_walkthrough'),
        report = coalesce(public.wo_signoff.report, excluded.report);

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (p_work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => 2))::date, 2, 'no_walkthrough')
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  insert into public.invoices (estimate_id, customer_id, status, amount_cents, issued_on)
    values (v_wo.estimate_id,
            (select customer_id from public.estimates where id = v_wo.estimate_id),
            'draft', 0, v_start);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'closed_without_walkthrough', auth.uid(), v_kind,
            jsonb_build_object('warranty_starts', v_start));
  return 'ok:closed';
end $$;
grant execute on function public.wo_close_without_walkthrough(uuid) to authenticated, service_role;

-- ---- 1d. prep confirmed routes: qa | walkthrough | CLOSED ---------------------------
-- 20261030 body with the no-walkthrough branch.
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

-- ---- 1e. a passed check routes: walkthrough | CLOSED -------------------------------
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

-- wo_record_qa: 20261104 body; the routing now also reads 'ok:closed'.
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

-- ---- 2. the pre-start list ------------------------------------------------------------
-- Existing rows: the derived QA item goes; what-to-expect becomes the optional
-- pre-start checklist; colours becomes the yes/no question (a past tick = yes).
delete from public.wo_checklist_items where phase = 'pre_start' and auto_key = 'qa';
update public.wo_checklist_items
   set label = 'Pre-start checklist', required = false, item_key = 'pre_start_checklist',
       detail = 'Tick to email the customer the pre-start checklist before the job starts'
 where phase = 'pre_start' and label = 'Customer ''what to expect'' queued';
update public.wo_checklist_items
   set kind = 'yes_no', item_key = 'colours',
       detail = 'Every colour on the job sheet? Tick No if any colours need a colour match',
       answer = case when done_at is not null then 'yes' else answer end
 where phase = 'pre_start' and label = 'Colour schedule finalised' and item_key is null;

-- 20261102 body, three rows changed, dedupe by item_key-or-label, kind/item_key written.
create or replace function public.wo_seed_checklists(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record; v_swms boolean;
begin
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;

  v_swms := public.wo_job_kind(p_work_order_id) in ('commercial', 'body_corporate');

  for v_i in
    select * from (values
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text, 'tick', null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null, 'tick', null),
      ('pre_start', 'Colour schedule finalised', 'Every colour on the job sheet? Tick No if any colours need a colour match', true, 1, null, 'yes_no', 'colours'),
      ('pre_start', 'Materials ordered', 'Needs the colours above first', true, 2, null, 'tick', null),
      ('pre_start', 'Equipment movements booked', 'Delivery to site and the return trigger', true, 3, null, 'tick', null),
      ('pre_start', 'Access details recorded', 'Gate codes, parking, pets, keys', true, 4, null, 'tick', null),
      ('pre_start', 'Pre-start checklist', 'Tick to email the customer the pre-start checklist before the job starts', false, 6, null, 'tick', 'pre_start_checklist'),
      ('pre_start', 'SWMS / induction attached', 'Required on commercial and body corporate', v_swms, 7, null, 'tick', null)
    ) as t(phase, label, detail, required, sort, auto_key, kind, item_key)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id and phase = v_i.phase
                      and (label = v_i.label or (v_i.item_key is not null and item_key = v_i.item_key))) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, auto_key, kind, item_key)
        values (p_work_order_id, v_i.phase, v_i.label, v_i.detail, v_i.required, v_i.sort, v_i.auto_key, v_i.kind, v_i.item_key);
      v_made := v_made + 1;
    end if;
  end loop;

  update public.wo_checklist_items
     set required = v_swms
   where work_order_id = p_work_order_id
     and phase = 'pre_start' and label = 'SWMS / induction attached'
     and required is distinct from v_swms;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

create or replace function public.wo_seed_checklists_on_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'stage_changed' and new.to_stage in ('offered', 'pre_start') then
    perform public.wo_seed_checklists(new.work_order_id);
  end if;
  return new;
end $$;

-- The colours question: a YES or a NO both satisfy the pre-start gate (the
-- question is answered); No is what opens the colour-match work. The tick RPC
-- already refuses a yes_no item, and 'Materials ordered' waits for done_at —
-- which answering sets. Nothing else to change.

-- ---- read-back -------------------------------------------------------------------------
select
  (select count(*) from public.wo_stage_transitions) as transitions,
  (select count(*) from information_schema.columns where table_name = 'work_orders' and column_name = 'walkthrough_required') as wt_col,
  (select count(*) from pg_proc where proname in ('wo_close_without_walkthrough','wo_set_walkthrough_required','wo_set_colour_match','wo_colour_match_outstanding')) as new_fns,
  (select count(*) from public.wo_checklist_items where phase = 'pre_start' and auto_key = 'qa') as qa_items_left,
  (select prosrc like '%colour match codes%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_reads_colours,
  (select prosrc like '%Pre-start checklist%' from pg_proc where proname = 'wo_seed_checklists' limit 1) as seeder_current;

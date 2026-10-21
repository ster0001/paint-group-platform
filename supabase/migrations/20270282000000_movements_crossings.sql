-- =============================================================================
-- Movements, Session 7 (build plan docs/briefs/movements-build-plan.md): the crossings.
-- Brief docs/briefs/claude-code-brief-pc-movements.md section 3.5, rulings 12, 17, 20,
-- flags 9 and 10. Session 0 report item 9 points 2 and 3.
--
-- What crosses here:
--   1. The two pre-start gate items get item keys (materials, equipment) so the tick RPC
--      can address them; existing rows are back-keyed by label.
--   2. The gates live in SQL: movements_gate_paint / movements_gate_gear mirror
--      lib/movements/evaluate.ts gates() word for word; wo_tick_checklist_item refuses
--      Materials ordered with error:paint_not_ordered and Equipment movements booked with
--      error:equipment_not_booked. colours_first stays in front.
--   3. The completion-prep answers reach the movements: Equipment for collection = yes
--      confirms the open gear return (creating a tray one if the office never did);
--      Rubbish for collection = yes confirms the rubbish chip (left on site when the
--      office had not yet answered how). The painter calls this, so it writes the rows
--      itself rather than through the staff-only wrappers.
--   4. The estimate internal Materials and sundries list (builder_state.internalMaterials,
--      ruling 12: never on the customer document) becomes wo_material_lines(source =
--      estimate) whenever the sync runs for the job, idempotently.
--   5. material_costs.movement_id links a matched supplier invoice to its order: set by a
--      trigger when the order reference matches a movement on the same job.
--   6. hire_off ticked done with an expected cost writes a job_costs row (equipment_hire,
--      recorded) when the settings row says recordHireCosts (flag 9).
--   7. The old free-text wo_prestart_lists are imported once as lines (source = pc) and
--      the box goes from the job page. The read-back prints the import count.
--
-- Converges on a re-run (or replace, if not exists, guarded inserts). No new table.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. item keys on the two gate items ----------------------------------------------------
update public.wo_checklist_items set item_key = 'materials'
 where phase = 'pre_start' and label = 'Materials ordered' and item_key is null;
update public.wo_checklist_items set item_key = 'equipment'
 where phase = 'pre_start' and label = 'Equipment movements booked' and item_key is null;

-- The seeder now writes the keys (body as 20261110, two values changed).
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
      ('pre_start', 'Materials ordered', 'Every paint chip ordered on the Movements board (or marked not needed / painter supplies)', true, 2, null, 'tick', 'materials'),
      ('pre_start', 'Equipment movements booked', 'Every gear chip booked on the Movements board (or marked not needed)', true, 3, null, 'tick', 'equipment'),
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

-- ---- 2. the gates in SQL (mirror of evaluate.ts gates()) -----------------------------------
-- paint: a paint decision (not_needed / painter_supplies), else every non-cancelled paint
-- chip is done or has ordered_at. gear: an equipment decision, else every non-cancelled
-- equipment_out / hire_on chip is booked or done. No chips at all = open.
create or replace function public.movements_gate_paint(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.wo_logistics_decisions d where d.work_order_id = p_work_order_id and d.line = 'paint')
      or not exists (select 1 from public.movements m where m.work_order_id = p_work_order_id and m.kind = 'paint'
                        and m.status <> 'cancelled' and not (m.status = 'done' or m.ordered_at is not null))
$$;
revoke all on function public.movements_gate_paint(uuid) from public, authenticated, anon;

create or replace function public.movements_gate_gear(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.wo_logistics_decisions d where d.work_order_id = p_work_order_id and d.line = 'equipment')
      or not exists (select 1 from public.movements m where m.work_order_id = p_work_order_id and m.kind in ('equipment_out', 'hire_on')
                        and m.status <> 'cancelled' and m.status not in ('booked', 'done'))
$$;
revoke all on function public.movements_gate_gear(uuid) from public, authenticated, anon;

-- The tick (body as 20270159, with the two gates after colours_first).
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
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_i.auto_key is not null then return 'error:derived:' || v_i.auto_key; end if;
  if v_i.kind <> 'tick' then return 'error:answer_required'; end if;

  if p_done and v_i.phase = 'pre_start' and (v_i.item_key = 'materials' or v_i.label = 'Materials ordered') then
    if not exists (
      select 1 from public.wo_checklist_items c
       where c.work_order_id = v_i.work_order_id and c.phase = 'pre_start'
         and (c.item_key = 'colours' or c.label = 'Colour schedule finalised') and c.done_at is not null
    ) then return 'error:colours_first'; end if;
    if not public.movements_gate_paint(v_i.work_order_id) then return 'error:paint_not_ordered'; end if;
  end if;
  if p_done and v_i.phase = 'pre_start' and (v_i.item_key = 'equipment' or v_i.label = 'Equipment movements booked') then
    if not public.movements_gate_gear(v_i.work_order_id) then return 'error:equipment_not_booked'; end if;
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

-- ---- 3. the completion-prep answers reach the movements -------------------------------------
-- Called by the answer RPC (below) as the owner. A yes on equipment confirms the open gear
-- return for the job, creating a tray one when the office never booked an out; a yes on
-- rubbish confirms the rubbish chip, choosing left on site when the question was still open.
create or replace function public.movements_prep_answer(p_work_order_id uuid, p_item_key text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_site text;
begin
  if p_work_order_id is null then return; end if;
  v_site := public.movements_site_text(p_work_order_id);
  if p_item_key = 'equipment' then
    select id into v_id from public.movements
     where work_order_id = p_work_order_id and kind = 'equipment_return' and status not in ('done', 'cancelled')
     order by created_at limit 1;
    if v_id is null then
      insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_text, to_kind, to_text, status, due_date, order_ref, created_by)
        values (p_work_order_id, 'equipment_return', 'return:prep', 'Gear to collect', left(coalesce(nullif(btrim(p_note), ''), 'the painter says there is gear on site'), 300),
                'site', v_site, 'warehouse', 'Warehouse', 'tray',
                (select coalesce(w.end_date, w.start_date) from public.work_orders w where w.id = p_work_order_id),
                public.movements_job_ref(p_work_order_id), auth.uid())
        returning id into v_id;
      perform public.movements_event(p_work_order_id, 'movement_created', jsonb_build_object('movement_id', v_id, 'kind', 'equipment_return', 'from', 'completion_prep'));
    end if;
    update public.movements set painter_confirmed_at = coalesce(painter_confirmed_at, now()),
           detail = case when coalesce(nullif(btrim(p_note), ''), '') <> '' then left(p_note, 300) else detail end
     where id = v_id;
  elsif p_item_key = 'rubbish' then
    select id into v_id from public.movements
     where work_order_id = p_work_order_id and source_key = 'rubbish' and status not in ('done', 'cancelled') limit 1;
    if v_id is null then return; end if;
    update public.movements
       set painter_confirmed_at = coalesce(painter_confirmed_at, now()),
           title = case when detail = 'undecided' then 'Rubbish — collect from site' else title end,
           detail = case when detail = 'undecided' then 'left on site: drop it on whoever collects, or make it a skip' else detail end,
           to_kind = case when detail = 'undecided' then 'tip'::public.place_kind else to_kind end,
           to_text = case when detail = 'undecided' then 'Tip' else to_text end
     where id = v_id;
  end if;
  perform public.movements_event(p_work_order_id, 'prep_answer_confirmed', jsonb_build_object('item_key', p_item_key, 'movement_id', v_id));
end $$;
revoke all on function public.movements_prep_answer(uuid, text, text) from public, authenticated, anon;

-- The answer (body as 20270159, plus the call above on a yes).
create or replace function public.wo_answer_checklist_item(p_item_id uuid, p_answer text default null, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_i public.wo_checklist_items%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_done boolean;
begin
  select * into v_i from public.wo_checklist_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  select * into v_wo from public.work_orders where id = v_i.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_i.kind = 'tick' then return 'error:not_a_question'; end if;

  if v_i.kind = 'yes_no' then
    if p_answer is null or p_answer not in ('yes', 'no') then return 'error:bad_answer'; end if;
    if v_i.item_key = 'equipment' and p_answer = 'yes' and length(trim(coalesce(p_note, ''))) = 0 then
      return 'error:list_required';
    end if;
    update public.wo_checklist_items
       set answer = p_answer,
           answer_note = case when p_answer = 'yes' then coalesce(p_note, '') else '' end,
           done_at = now(), done_by = auth.uid(),
           handled_at = null, handled_by = null
     where id = p_item_id;
    v_done := true;
    if p_answer = 'yes' and v_i.phase = 'completion_prep' and v_i.item_key in ('equipment', 'rubbish') then
      perform public.movements_prep_answer(v_i.work_order_id, v_i.item_key, coalesce(p_note, ''));
    end if;
  else -- note
    v_done := length(trim(coalesce(p_note, ''))) > 0;
    update public.wo_checklist_items
       set answer_note = coalesce(p_note, ''),
           done_at = case when v_done then now() end,
           done_by = case when v_done then auth.uid() end
     where id = p_item_id;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_i.work_order_id, 'checklist_answered', auth.uid(), v_kind,
            jsonb_build_object('item_id', p_item_id, 'label', v_i.label, 'item_key', v_i.item_key,
                               'phase', v_i.phase::text, 'answer', p_answer,
                               'note', left(coalesce(p_note, ''), 500), 'done', v_done));

  return 'ok:' || coalesce(p_answer, case when v_done then 'noted' else 'cleared' end);
end $$;
grant execute on function public.wo_answer_checklist_item(uuid, text, text) to authenticated;

-- ---- 4. the estimate list becomes lines whenever the job syncs -------------------------------
create or replace function public.movements_lines_from_estimate(p_work_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_text text; v_sort integer;
begin
  for v_text in
    select left(btrim(x), 200)
      from public.work_orders w
      join public.estimates e on e.id = w.estimate_id,
           jsonb_array_elements_text(case when jsonb_typeof(e.builder_state -> 'internalMaterials') = 'array' then e.builder_state -> 'internalMaterials' else '[]'::jsonb end) x
     where w.id = p_work_order_id and btrim(x) <> ''
  loop
    if not exists (select 1 from public.wo_material_lines l where l.work_order_id = p_work_order_id and l.source = 'estimate' and l.text = v_text) then
      select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = p_work_order_id;
      insert into public.wo_material_lines (work_order_id, text, source, sort) values (p_work_order_id, v_text, 'estimate', v_sort);
      v_made := v_made + 1;
    end if;
  end loop;
  if v_made > 0 then
    perform public.movements_event(p_work_order_id, 'material_lines_from_estimate', jsonb_build_object('count', v_made));
  end if;
  return v_made;
end $$;
revoke all on function public.movements_lines_from_estimate(uuid) from public, authenticated, anon;

-- The trigger (body as 20270279) now copies the lines first, then syncs.
create or replace function public.work_orders_movements_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.wo_snapshot is not null then
      perform public.movements_lines_from_estimate(new.id);
      perform public.movements_sync_for_wo(new.id);
    end if;
    return new;
  end if;
  if (old.wo_snapshot -> 'materials') is distinct from (new.wo_snapshot -> 'materials')
     or (old.wo_snapshot is null and new.wo_snapshot is not null)
     or (old.stage is distinct from new.stage and new.stage = 'closed') then
    if new.wo_snapshot is not null then perform public.movements_lines_from_estimate(new.id); end if;
    perform public.movements_sync_for_wo(new.id);
  end if;
  return new;
end $$;
revoke all on function public.work_orders_movements_sync() from public, authenticated, anon;

-- Staff re-sync (body as 20270279, plus the lines).
create or replace function public.movements_sync_now(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  perform public.movements_lines_from_estimate(p_work_order_id);
  return public.movements_sync_for_wo(p_work_order_id);
end $$;
revoke all on function public.movements_sync_now(uuid) from public, anon;
grant execute on function public.movements_sync_now(uuid) to authenticated;

-- ---- 5. a matched invoice links to its order -------------------------------------------------
alter table public.material_costs add column if not exists movement_id uuid references public.movements (id) on delete set null;
create index if not exists material_costs_movement_idx on public.material_costs (movement_id) where movement_id is not null;

create or replace function public.material_costs_link_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.movement_id is null and new.work_order_id is not null and coalesce(new.order_ref, '') <> '' then
    select m.id into new.movement_id from public.movements m
     where m.work_order_id = new.work_order_id and m.status <> 'cancelled'
       and lower(btrim(m.order_ref)) = lower(btrim(new.order_ref))
     -- Every chip on a job defaults to the job reference: a supplier invoice is for what a
     -- supplier delivered (paint, then materials), and the most recent order of those.
     order by (m.assignee_kind = 'supplier') desc, (m.kind = 'paint') desc, (m.kind = 'materials') desc, m.ordered_at desc nulls last, m.created_at limit 1;
  end if;
  return new;
end $$;
revoke all on function public.material_costs_link_movement() from public, authenticated, anon;
drop trigger if exists t_material_costs_link_movement on public.material_costs;
create trigger t_material_costs_link_movement before insert or update of work_order_id, order_ref on public.material_costs
  for each row execute function public.material_costs_link_movement();

-- ---- 6. off-hire done writes the cost (flag 9) -----------------------------------------------
-- Body as 20270279 movement_set_status, plus the job_costs row on done for a hire_off.
create or replace function public.movement_set_status(p_id uuid, p_status public.movement_status, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_vendor uuid; v_desc text; v_record boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if p_status = 'done' then
    if m.status <> 'booked' then return 'error:not_booked'; end if;
    update public.movements set status = 'done', done_at = now(), done_by = auth.uid(), problem_note = '' where id = p_id;
    if m.kind = 'hire_off' and m.work_order_id is not null and coalesce(m.expected_cost_cents, 0) > 0 then
      v_record := coalesce((public.movements_settings() ->> 'recordHireCosts')::boolean, true);
      v_desc := left('Hire — ' || m.title || ' (movement ' || m.id || ')', 300);
      if v_record and not exists (select 1 from public.job_costs j where j.work_order_id = m.work_order_id and j.description = v_desc) then
        select b.vendor_id into v_vendor from public.supplier_branches b where b.id = coalesce(m.to_branch_id, m.from_branch_id);
        insert into public.job_costs (work_order_id, vendor_id, category, description, amount_ex_cents, gst_cents, status, recorded_by)
          values (m.work_order_id, v_vendor, 'equipment_hire', v_desc,
                  round(m.expected_cost_cents / 1.1), m.expected_cost_cents - round(m.expected_cost_cents / 1.1), 'recorded', auth.uid());
        perform public.movements_event(m.work_order_id, 'hire_cost_recorded', jsonb_build_object('movement_id', p_id, 'cents', m.expected_cost_cents));
      end if;
    end if;
  elsif p_status = 'problem' then
    if m.status not in ('planned', 'booked') then return 'error:bad_transition'; end if;
    update public.movements set status = 'problem', problem_note = left(coalesce(p_note, ''), 500) where id = p_id;
  elsif p_status = 'booked' then
    if m.status <> 'problem' then return 'error:bad_transition'; end if;
    update public.movements set status = 'booked', problem_note = '', booked_at = coalesce(booked_at, now()), booked_by = coalesce(booked_by, auth.uid()) where id = p_id;
    if m.booked_at is null then perform public.movements_after_booked(p_id); end if;
  elsif p_status = 'cancelled' then
    if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
    update public.movements set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           problem_note = case when coalesce(p_note, '') = '' then problem_note else left(p_note, 500) end
     where id = p_id;
    delete from public.movements
     where coalesce(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(m.work_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and source_key in ('return:' || m.id, 'hire_off:' || m.id) and status = 'tray';
  else
    return 'error:bad_transition';
  end if;
  perform public.movements_event(m.work_order_id, 'movement_status', jsonb_build_object('movement_id', p_id, 'from', m.status::text, 'to', p_status::text, 'note', left(coalesce(p_note, ''), 500)));
  return 'ok:' || p_status;
end $$;
revoke all on function public.movement_set_status(uuid, public.movement_status, text) from public, anon;
grant execute on function public.movement_set_status(uuid, public.movement_status, text) to authenticated;

-- ---- 7. import the old free-text lists once ------------------------------------------------
-- Each non-empty line of wo_prestart_lists.materials becomes a line (source pc); each line of
-- .equipment becomes a line prefixed Gear:. Guarded: a line already present is skipped, so
-- the paste can be repeated. The table stays (read by nothing after this; dropped later).
create or replace function public.movements_import_prestart_lists()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_text text; v_sort integer; v_made integer := 0;
begin
  for r in select work_order_id, materials, equipment from public.wo_prestart_lists loop
    for v_text in
      select left(btrim(x), 200) from regexp_split_to_table(coalesce(r.materials, ''), E'\\r?\\n') x where btrim(x) <> ''
      union all
      select left('Gear: ' || btrim(x), 200) from regexp_split_to_table(coalesce(r.equipment, ''), E'\\r?\\n') x where btrim(x) <> ''
    loop
      if not exists (select 1 from public.wo_material_lines l where l.work_order_id = r.work_order_id and l.text = v_text) then
        select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = r.work_order_id;
        insert into public.wo_material_lines (work_order_id, text, source, sort) values (r.work_order_id, v_text, 'pc', v_sort);
        v_made := v_made + 1;
      end if;
    end loop;
    perform public.movements_sync_for_wo(r.work_order_id);
  end loop;
  return v_made;
end $$;
revoke all on function public.movements_import_prestart_lists() from public, authenticated, anon;
select public.movements_import_prestart_lists() as prestart_lists_imported_as_lines;
drop function public.movements_import_prestart_lists();

-- ---- read-back: compare to the _expect_ values before calling this live --------------------
select
  (select count(*) from public.wo_checklist_items where phase = 'pre_start' and label in ('Materials ordered', 'Equipment movements booked') and item_key is null) as unkeyed_gate_items, 0 as _expect_unkeyed_gate_items,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('movements_gate_paint', 'movements_gate_gear', 'movements_prep_answer', 'movements_lines_from_estimate', 'material_costs_link_movement')) as helpers, 5 as _expect_helpers,
  (select prosrc like '%paint_not_ordered%' from pg_proc where proname = 'wo_tick_checklist_item' limit 1) as tick_gated, true as _expect_tick_gated,
  (select prosrc like '%movements_prep_answer%' from pg_proc where proname = 'wo_answer_checklist_item' limit 1) as answer_crosses, true as _expect_answer_crosses,
  (select prosrc like '%movements_lines_from_estimate%' from pg_proc where proname = 'work_orders_movements_sync' limit 1) as sync_copies_lines, true as _expect_sync_copies_lines,
  (select prosrc like '%equipment_hire%' from pg_proc where proname = 'movement_set_status' limit 1) as hire_cost, true as _expect_hire_cost,
  (select count(*) from information_schema.columns where table_name = 'material_costs' and column_name = 'movement_id') as cost_link_column, 1 as _expect_cost_link_column,
  (select count(*) from pg_trigger where tgname = 't_material_costs_link_movement') as cost_link_trigger, 1 as _expect_cost_link_trigger,
  (select count(*) from public.wo_material_lines where source = 'pc' and (text like 'Gear: %' or created_by is null)) as imported_lines_pc,
  (select count(*) from public.wo_prestart_lists where coalesce(materials, '') <> '' or coalesce(equipment, '') <> '') as old_lists_with_text,
  has_function_privilege('authenticated', 'public.wo_tick_checklist_item(uuid, boolean)', 'execute') as tick_granted, true as _expect_tick_granted,
  has_function_privilege('authenticated', 'public.movements_gate_paint(uuid)', 'execute') as gate_client_callable, false as _expect_gate_client_callable;

insert into public._prod_migrations(name) values ('20270282000000_movements_crossings.sql') on conflict (name) do nothing;

-- =============================================================================
-- Stages 1 & 2 — the checklists the lifecycle mockup specifies
--
-- The loop has always had the transition ("pre-start checklist complete") and
-- the table (wo_checklist_items, phase pre_offer | pre_start), but nothing
-- seeded the items, nothing showed them, and the gate checked nothing. A job
-- could walk into in_progress with colours unconfirmed and no access details —
-- exactly what the checklist exists to prevent.
--
-- The labels and captions here are taken from
-- design/reference/work-order-lifecycle-mockup.html, not paraphrased:
--
--   PC review (pre_offer)  — ready to OFFER, not ready to start
--   Pre-start (pre_start)  — six items, colours first
--
-- The mockup is explicit that COLOURS ARE NOT REQUIRED TO OFFER: "the
-- contractor accepts with the TBC chip visible, and colours become a pre-start
-- item after acceptance." So colours gate the START, never the offer.
--
-- Two items are DERIVED rather than ticked, because a checkbox that disagrees
-- with the data is a lie waiting to happen:
--   * colours  — from the builder's per-product TBC/Confirmed chips
--   * QA       — from whether the checks have actually been scheduled
-- Everything else is a human tick.
-- =============================================================================

alter table public.wo_checklist_items
  add column if not exists detail   text not null default '',
  -- When set, done-ness is computed, not stored, and the row is not tickable.
  add column if not exists auto_key text;

-- ---- is the colour schedule actually finalised? -----------------------------
create or replace function public.wo_colours_confirmed(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select case
    when w.wo_snapshot is null then false
    when jsonb_array_length(coalesce(w.wo_snapshot->'materials', '[]'::jsonb)) = 0 then false
    else not exists (
      select 1
        from jsonb_array_elements(w.wo_snapshot->'materials') m
       where coalesce(w.colours -> (m->>'product') ->> 'status', 'tbc') <> 'confirmed'
    )
  end
  from public.work_orders w
  where w.id = p_work_order_id;
$$;
grant execute on function public.wo_colours_confirmed(uuid) to authenticated;

-- ---- one answer for "is this item done?" ------------------------------------
create or replace function public.wo_checklist_done(p_item public.wo_checklist_items)
returns boolean language sql stable set search_path = public as $$
  select case p_item.auto_key
    when 'colours' then public.wo_colours_confirmed(p_item.work_order_id)
    when 'qa' then exists (select 1 from public.wo_qa_checks
                            where work_order_id = p_item.work_order_id)
    else p_item.done_at is not null
  end;
$$;
grant execute on function public.wo_checklist_done(public.wo_checklist_items) to authenticated;

-- ---- the lists, verbatim from the mockup ------------------------------------
create or replace function public.wo_seed_checklists(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;

  for v_i in
    select * from (values
      -- PC review: ready to OFFER, not ready to start.
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null),

      -- Pre-start: everything the site needs, arranged before day one.
      ('pre_start', 'Colour schedule finalised',
        'Confirmed at the colour consult — the chips on the job sheet', true, 1, 'colours'),
      ('pre_start', 'Materials ordered',
        'Needs the colours above first', true, 2, null),
      ('pre_start', 'Equipment movements booked',
        'Delivery to site and the return trigger', true, 3, null),
      ('pre_start', 'Access details recorded',
        'Gate codes, parking, pets, keys', true, 4, null),
      ('pre_start', 'QA schedule created',
        'Auto-scheduled while a contractor is inside their first jobs', false, 5, 'qa'),
      ('pre_start', 'Customer ''what to expect'' queued',
        'Goes out the evening before the start', true, 6, null)
    ) as t(phase, label, detail, required, sort, auto_key)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id
                      and phase = v_i.phase and label = v_i.label) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, auto_key)
        values (p_work_order_id, v_i.phase, v_i.label, v_i.detail, v_i.required, v_i.sort, v_i.auto_key);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

-- ---- ticking ----------------------------------------------------------------
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

  -- A derived item cannot be ticked by hand: change the thing it reads.
  if v_i.auto_key is not null then return 'error:derived:' || v_i.auto_key; end if;

  -- The mockup's own rule: "needs the colours above first".
  if p_done and v_i.label = 'Materials ordered'
     and not public.wo_colours_confirmed(v_i.work_order_id) then
    return 'error:colours_first';
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

-- ---- seed as soon as a work order exists, and again at pre-start ------------
create or replace function public.wo_seed_checklists_on_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'stage_changed' and new.to_stage in ('offered', 'pre_start') then
    perform public.wo_seed_checklists(new.work_order_id);
  end if;
  return new;
end $$;

drop trigger if exists wo_events_seed_pre_start on public.wo_events;
drop trigger if exists wo_events_seed_checklists on public.wo_events;
create trigger wo_events_seed_checklists
  after insert on public.wo_events
  for each row execute function public.wo_seed_checklists_on_stage();

do $$
declare v_id uuid;
begin
  for v_id in select id from public.work_orders where stage <> 'closed' loop
    perform public.wo_seed_checklists(v_id);
  end loop;
end $$;

-- ---- the gate ---------------------------------------------------------------
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer;
begin
  -- Colours gate the START, never the offer: the mockup is explicit that a
  -- contractor accepts with the TBC chip visible.
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

  if p_from = 'qa' and p_to = 'completion_prep' then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
    if v_open > 0 then
      return v_open::text || ' QA check' || case when v_open = 1 then '' else 's' end || ' still open';
    end if;
  end if;

  if p_from = 'completion_prep' and p_to = 'walkthrough' then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'completion_prep'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  return null;
end $$;

-- ---- Verification -----------------------------------------------------------
--   select phase, sort, label, required, auto_key from wo_checklist_items
--    where work_order_id = '<a job>' order by phase, sort;
--     -> 2 pre_offer rows, 6 pre_start rows, colours and QA carrying auto_key
--   select public.wo_advance_stage('<a pre_start job>', 'in_progress');
--     -> 'error:gate:the colour schedule is not finalised yet'
--   confirm every colour chip on the job sheet, then tick the rest:
--     -> 'ok:in_progress'

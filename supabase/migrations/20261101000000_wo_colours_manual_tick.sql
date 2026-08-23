-- =============================================================================
-- "Colour schedule finalised" becomes a REMINDER you tick, not a derived gate.
--
-- 23 Oakdene Crescent (Tom, 23 Aug): every colour entered, and the box would
-- not tick — it read work_orders.colours for a per-product 'confirmed' status
-- that the builder's colour entry never writes, so it stayed empty forever and
-- the job could not start. The derived wiring was a promise the data model
-- does not keep. Ruling: the box is ticked by a person, and it is the reminder
-- to get every colour onto the job sheet.
--
-- Three things follow: the item loses its auto_key (existing rows too); the
-- pre-start gate stops reading wo_colours_confirmed() — the required, ticked
-- item IS the gate; and "Materials ordered" waits for the colours TICK rather
-- than the phantom status.
-- =============================================================================

update public.wo_checklist_items
   set auto_key = null,
       detail = 'Tick once every colour is on the job sheet'
 where auto_key = 'colours';

-- Seeder: 20261017 body verbatim, colours row is a plain required item.
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
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null),
      ('pre_start', 'Colour schedule finalised', 'Tick once every colour is on the job sheet', true, 1, null),
      ('pre_start', 'Materials ordered', 'Needs the colours above first', true, 2, null),
      ('pre_start', 'Equipment movements booked', 'Delivery to site and the return trigger', true, 3, null),
      ('pre_start', 'Access details recorded', 'Gate codes, parking, pets, keys', true, 4, null),
      ('pre_start', 'QA schedule created', 'Auto while a contractor is in their first jobs', false, 5, 'qa'),
      ('pre_start', 'Customer ''what to expect'' queued', 'Goes out the evening before', true, 6, null),
      ('pre_start', 'SWMS / induction attached', 'Required on commercial and body corporate', v_swms, 7, null)
    ) as t(phase, label, detail, required, sort, auto_key)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id and phase = v_i.phase and label = v_i.label) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, auto_key)
        values (p_work_order_id, v_i.phase, v_i.label, v_i.detail, v_i.required, v_i.sort, v_i.auto_key);
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

-- Tick RPC: 20261012 body, one change marked NEW — "Materials ordered" waits
-- for the colours TICK, not the phantom status.
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

  if v_i.auto_key is not null then return 'error:derived:' || v_i.auto_key; end if;

  -- NEW: the colours box is the reminder; materials wait for it to be ticked.
  if p_done and v_i.label = 'Materials ordered' and not exists (
    select 1 from public.wo_checklist_items c
     where c.work_order_id = v_i.work_order_id and c.phase = 'pre_start'
       and c.label = 'Colour schedule finalised' and c.done_at is not null
  ) then
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

-- Gate: 20261030 body verbatim MINUS the wo_colours_confirmed() pre-start
-- check. The required colours item, ticked by a person, is the gate now.
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer;
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

-- Verification: expect 0 rows still derived for colours, and the two function
-- bodies NOT mentioning wo_colours_confirmed.
select count(*) as still_derived from public.wo_checklist_items where auto_key = 'colours';
select p.proname, pg_get_functiondef(p.oid) like '%wo_colours_confirmed%' as reads_phantom_status
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('wo_gate_blocked', 'wo_tick_checklist_item');

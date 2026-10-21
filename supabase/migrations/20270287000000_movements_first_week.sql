-- =============================================================================
-- Movements, first-week batch (Tom, 21 Oct 2026). Six asks after the first day:
--   1. a materials line is one order chip: comma-separated items on ONE line, up to 500 chars;
--   2. the gear item on the job page works the same way: words typed become a gear chip,
--      and booking it makes its return chip as every gear chip does;
--   3. no shop is assumed for a materials line (no Bunnings default): the office confirms the
--      shop and whether it is delivered or picked up in the chip (movement_set_method);
--   4. one paint order per brand per job: products with a blank brand take the brand their
--      name starts with when that brand exists, and two spellings of one brand (Cabots /
--      Cabot s) fold into the one with more products, so the sync groups them as one chip;
--   5. (no SQL: litres are edited on the Materials card, in the chip and in the working scope);
--   6. (no SQL: unscheduled site check-ins use wo_site_visit_set_schedule from the tray).
-- Converging. The sync, create and line RPCs are re-emitted from 20270279 with the edits
-- marked Tom, 21 Oct 2026, so nothing else in them changes.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. material lines up to 500 characters ----------------------------------------------
alter table public.wo_material_lines drop constraint if exists wo_material_lines_text_check;
alter table public.wo_material_lines add constraint wo_material_lines_text_check check (char_length(btrim(text)) between 1 and 500);

create or replace function public.material_line_add(p_work_order_id uuid, p_text text, p_source text default 'pc')
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_text text; v_sort int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  if p_source not in ('estimate', 'pc', 'painter_request') then return 'error:bad_source'; end if;
  v_text := left(btrim(coalesce(p_text, '')), 500);
  if v_text = '' then return 'error:empty'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = p_work_order_id;
  insert into public.wo_material_lines (work_order_id, text, source, sort, created_by)
    values (p_work_order_id, v_text, p_source, v_sort, auth.uid()) returning id into v_id;
  perform public.movements_event(p_work_order_id, 'material_line_added', jsonb_build_object('line_id', v_id, 'text', v_text, 'source', p_source));
  perform public.movements_sync_for_wo(p_work_order_id);
  return 'ok:' || v_id;
end $$;
revoke all on function public.material_line_add(uuid, text, text) from public, anon;
grant execute on function public.material_line_add(uuid, text, text) to authenticated;

create or replace function public.material_line_update(p_id uuid, p_text text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.wo_material_lines%rowtype; v_text text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.wo_material_lines where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  v_text := left(btrim(coalesce(p_text, '')), 500);
  if v_text = '' then return 'error:empty'; end if;
  update public.wo_material_lines set text = v_text where id = p_id;
  perform public.movements_event(l.work_order_id, 'material_line_edited', jsonb_build_object('line_id', p_id, 'from', l.text, 'to', v_text));
  perform public.movements_sync_for_wo(l.work_order_id);
  return 'ok:' || p_id;
end $$;
revoke all on function public.material_line_update(uuid, text) from public, anon;
grant execute on function public.material_line_update(uuid, text) to authenticated;

-- ---- 2. a gear chip from words ----------------------------------------------------------
create or replace function public.movement_create(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_kind public.movement_kind; v_wo uuid; v_title text; v_detail text; v_id uuid; v_items uuid[]; v_item uuid;
        v_loc record; v_blocked uuid; v_tag text; v_from_kind public.place_kind; v_to_kind public.place_kind;
        v_from_branch uuid; v_to_branch uuid; v_from_text text; v_to_text text; v_cost int; v_labels text[] := '{}';
        v_return_due date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  begin v_kind := (p ->> 'kind')::public.movement_kind; exception when others then return 'error:bad_kind'; end;
  if v_kind is null then return 'error:bad_kind'; end if;
  v_wo := nullif(p ->> 'work_order_id', '')::uuid;
  if v_wo is not null and not exists (select 1 from public.work_orders where id = v_wo) then return 'error:not_found'; end if;
  v_title := left(btrim(coalesce(p ->> 'title', '')), 160);
  v_detail := nullif(left(btrim(coalesce(p ->> 'detail', '')), 300), '');
  begin
    v_from_kind := nullif(p -> 'from' ->> 'kind', '')::public.place_kind;
    v_to_kind := nullif(p -> 'to' ->> 'kind', '')::public.place_kind;
  exception when others then return 'error:bad_place'; end;
  v_from_branch := nullif(p -> 'from' ->> 'branch_id', '')::uuid;
  v_to_branch := nullif(p -> 'to' ->> 'branch_id', '')::uuid;
  if v_from_branch is not null and not exists (select 1 from public.supplier_branches where id = v_from_branch) then return 'error:bad_branch'; end if;
  if v_to_branch is not null and not exists (select 1 from public.supplier_branches where id = v_to_branch) then return 'error:bad_branch'; end if;
  v_from_text := left(coalesce(nullif(p -> 'from' ->> 'text', ''), case when v_from_branch is not null then public.movements_branch_text(v_from_branch)
                       when v_from_kind = 'site' and v_wo is not null then public.movements_site_text(v_wo) when v_from_kind = 'warehouse' then 'Warehouse' else '' end), 200);
  v_to_text := left(coalesce(nullif(p -> 'to' ->> 'text', ''), case when v_to_branch is not null then public.movements_branch_text(v_to_branch)
                     when v_to_kind = 'site' and v_wo is not null then public.movements_site_text(v_wo) when v_to_kind = 'warehouse' then 'Warehouse' else '' end), 200);
  v_cost := nullif(p ->> 'expected_cost_cents', '')::int;
  if v_cost is not null and v_cost < 0 then return 'error:bad_cost'; end if;
  v_return_due := nullif(p ->> 'return_due', '')::date;

  -- Rubbish: one chip per job (the sync makes the question; + Add a chip may not make a second).
  if v_kind in ('rubbish_in', 'rubbish_out') and v_wo is not null
     and exists (select 1 from public.movements where work_order_id = v_wo and kind in ('rubbish_in', 'rubbish_out') and status <> 'cancelled') then
    return 'error:rubbish_exists';
  end if;

  -- Gear: items from the register, each checked.
  if p ? 'items' and jsonb_typeof(p -> 'items') = 'array' then
    select coalesce(array_agg((x)::uuid), '{}') into v_items from jsonb_array_elements_text(p -> 'items') x;
  end if;
  -- Tom, 21 Oct 2026: a gear chip typed as words (the gear box on the job page) needs no register
  -- items; a return or a repair still does.
  if v_kind in ('equipment_return', 'repair_out', 'repair_back') and coalesce(array_length(v_items, 1), 0) = 0 then
    return 'error:no_items';
  end if;
  if v_kind = 'equipment_out' and coalesce(array_length(v_items, 1), 0) = 0 and v_title = '' then
    return 'error:no_items';
  end if;
  if v_items is not null then
    foreach v_item in array v_items loop
      select e.tag || ' · ' || e.name into v_tag from public.equipment_items e where e.id = v_item and e.status <> 'retired';
      if v_tag is null then return 'error:bad_item'; end if;
      v_labels := v_labels || v_tag;
      if v_kind = 'equipment_out' then
        if exists (select 1 from public.movement_items mi join public.movements mo on mo.id = mi.movement_id
                    where mi.equipment_item_id = v_item and mo.kind = 'equipment_out' and mo.status in ('tray', 'planned', 'booked', 'problem')) then
          return 'error:item_already_planned:' || split_part(v_tag, ' · ', 1);
        end if;
        select * into v_loc from public.equipment_item_location(v_item);
        if v_loc.state = 'stranded' then
          -- The closed job owes a return chip; make sure it exists, then block on it.
          perform public.movements_sync_for_wo(v_loc.work_order_id);
          select id into v_blocked from public.movements
           where source_key = 'return:' || v_loc.movement_id and status <> 'done' limit 1;
          if v_blocked is null then return 'error:item_unavailable:' || split_part(v_tag, ' · ', 1); end if;
        elsif v_loc.state <> 'warehouse' then
          return 'error:item_unavailable:' || split_part(v_tag, ' · ', 1);
        end if;
      end if;
    end loop;
  end if;

  if v_title = '' then
    v_title := case when v_kind = 'equipment_out' then 'Gear · ' || array_to_string(v_labels, ', ')
                    when v_kind = 'equipment_return' then 'Collect ' || array_to_string(v_labels, ', ')
                    else initcap(replace(v_kind::text, '_', ' ')) end;
    v_title := left(v_title, 160);
  end if;
  if v_kind = 'equipment_out' then
    v_from_kind := coalesce(v_from_kind, 'warehouse'); v_to_kind := coalesce(v_to_kind, 'site');
    if v_from_text = '' then v_from_text := 'Warehouse'; end if;
    if v_to_text = '' and v_wo is not null then v_to_text := public.movements_site_text(v_wo); end if;
  end if;

  insert into public.movements (work_order_id, kind, title, detail, from_kind, from_branch_id, from_text, to_kind, to_branch_id, to_text,
                                status, order_ref, expected_cost_cents, blocked_by_movement_id, return_due, note, created_by)
    values (v_wo, v_kind, v_title, v_detail, v_from_kind, v_from_branch, v_from_text, v_to_kind, v_to_branch, v_to_text,
            'tray', coalesce(nullif(left(p ->> 'order_ref', 40), ''), case when v_wo is null then '' else public.movements_job_ref(v_wo) end),
            v_cost, v_blocked, v_return_due, left(coalesce(p ->> 'note', ''), 500), auth.uid())
    returning id into v_id;
  if v_items is not null then
    insert into public.movement_items (movement_id, equipment_item_id, label)
      select v_id, e.id, left(e.tag || ' · ' || e.name, 160) from public.equipment_items e where e.id = any (v_items)
      on conflict do nothing;
  end if;
  perform public.movements_event(v_wo, 'movement_created', jsonb_build_object('movement_id', v_id, 'kind', v_kind::text, 'title', v_title, 'blocked_by', v_blocked));
  return 'ok:' || v_id;
end $$;
revoke all on function public.movement_create(jsonb) from public, anon;
grant execute on function public.movement_create(jsonb) to authenticated;

-- ---- 3. no default shop for materials; the office confirms shop and method ---------------
alter table public.movements add column if not exists method_pref text check (method_pref is null or method_pref in ('delivery', 'pickup'));

create or replace function public.movements_sync_for_wo(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_site text; v_lat double precision; v_lng double precision;
        r record; v_id uuid; v_key text; v_title text; v_detail text; v_branch uuid; v_status public.movement_status; v_ordered timestamptz;
        v_old_title text; v_old_detail text; v_seen uuid[] := '{}'; v_created int := 0; v_refreshed int := 0; v_removed int := 0;
        v_dec_paint text; v_dec_mat text; v_dec_rub text; v_label text; v_brand text; v_lines jsonb;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.wo_snapshot is null then return 'ok:not_issued'; end if;

  v_site := public.movements_site_text(p_work_order_id);
  select lat, lng into v_lat, v_lng from public.movements_job_point(p_work_order_id);
  select decision into v_dec_paint from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'paint';
  select decision into v_dec_mat   from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'materials';
  select decision into v_dec_rub   from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'rubbish';

  if v_wo.stage <> 'closed' then
    -- Paint: one chip per product brand. Brand by product name through products.brand;
    -- a blank brand groups under Paint (brand?) (Session 0 item 6).
    if v_dec_paint is null then
      for r in
        select coalesce(nullif(btrim(p.brand), ''), '') as brand, count(*)::int as n,
               sum(coalesce((m ->> 'litres')::numeric, 0)) as litres,
               sum(public.movements_cans((m ->> 'litres')::numeric))::int as cans,
               jsonb_agg(jsonb_build_object(
                 'rowKey', coalesce(m ->> 'colourKey', m ->> 'product'), 'product', m ->> 'product',
                 'colourName', m ->> 'colourName', 'colourHex', m ->> 'colourHex', 'colourStatus', m ->> 'colourStatus',
                 'litres', (m ->> 'litres')::numeric, 'cans', public.movements_cans((m ->> 'litres')::numeric))
                 order by coalesce(m ->> 'colourKey', m ->> 'product')) as rows
          from jsonb_array_elements(coalesce(v_wo.wo_snapshot -> 'materials', '[]'::jsonb)) m
          left join lateral (select pr.brand from public.products pr
                              where lower(btrim(pr.name)) = lower(btrim(m ->> 'product'))
                              order by pr.effective_from desc nulls last limit 1) p on true
         where coalesce(m ->> 'product', '') <> ''
         group by 1
      loop
        v_brand := r.brand;
        v_key := 'paint:' || case when v_brand = '' then 'brand?' else v_brand end;
        v_label := case when v_brand = '' then 'Paint (brand?)' else v_brand end;
        v_title := left(v_label || ' · ' || r.n || case when r.n = 1 then ' line · ' else ' lines · ' end
                        || r.cans || case when r.cans = 1 then ' can' else ' cans' end, 160);
        v_detail := 'from the Materials card';
        v_branch := case when v_brand = '' then null else public.movements_nearest_branch('paint', v_brand, v_lat, v_lng, true) end;
        select id, status, ordered_at, title, detail into v_id, v_status, v_ordered, v_old_title, v_old_detail
          from public.movements where work_order_id = p_work_order_id and source_key = v_key;
        if v_id is null then
          insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_branch_id, from_text, to_kind, to_text, status, order_ref)
            values (p_work_order_id, 'paint', v_key, v_title, v_detail, 'branch', v_branch, public.movements_branch_text(v_branch), 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
            returning id into v_id;
          v_created := v_created + 1;
        elsif v_status = 'tray' then
          update public.movements set title = v_title, detail = v_detail,
                 from_branch_id = coalesce(from_branch_id, v_branch),
                 from_text = case when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end,
                 to_text = v_site, order_ref = case when order_ref = '' then public.movements_job_ref(p_work_order_id) else order_ref end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null));
          v_refreshed := v_refreshed + 1;
        elsif v_ordered is not null and (v_old_title is distinct from v_title or (select lines from public.movements where id = v_id) is distinct from r.rows) then
          update public.movements set source_changed_at = coalesce(source_changed_at, now()) where id = v_id and lines is distinct from r.rows;
        end if;
        v_seen := v_seen || v_id;
      end loop;
    end if;

    -- Materials: one chip per line not merged into another.
    if v_dec_mat is null then
      for r in select l.id, l.text, l.source from public.wo_material_lines l
                where l.work_order_id = p_work_order_id and l.merged_into is null order by l.sort, l.created_at
      loop
        v_key := 'matline:' || r.id;
        v_title := left(r.text, 160);
        v_detail := case r.source when 'estimate' then 'from the estimate' when 'painter_request' then 'asked for by the painter' else 'from the job page' end;
        -- Tom, 21 Oct 2026: no default shop for a materials line. The office confirms the shop
        -- and whether it is delivered or picked up in the chip (movement_set_method).
        v_branch := null;
        select id, status, ordered_at, title into v_id, v_status, v_ordered, v_old_title
          from public.movements where work_order_id = p_work_order_id and source_key = v_key;
        if v_id is null then
          insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_branch_id, from_text, to_kind, to_text, status, order_ref)
            values (p_work_order_id, 'materials', v_key, v_title, v_detail, null, null, '', 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
            returning id into v_id;
          v_created := v_created + 1;
        elsif v_status = 'tray' then
          update public.movements set title = v_title, detail = v_detail, to_text = v_site,
                 from_branch_id = coalesce(from_branch_id, v_branch),
                 from_text = case when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null));
          v_refreshed := v_refreshed + 1;
        elsif v_ordered is not null and v_old_title is distinct from v_title then
          update public.movements set source_changed_at = coalesce(source_changed_at, now()) where id = v_id;
        end if;
        v_seen := v_seen || v_id;
      end loop;
    end if;

    -- Rubbish: one undecided chip per job until the office answers how (ruling 20).
    if v_dec_rub is null then
      v_key := 'rubbish';
      select id, status into v_id, v_status from public.movements where work_order_id = p_work_order_id and source_key = v_key;
      if v_id is null then
        insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_text, status, order_ref)
          values (p_work_order_id, 'rubbish_out', v_key, 'Rubbish — how?', 'undecided', 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
          returning id into v_id;
        v_created := v_created + 1;
      end if;
      v_seen := v_seen || v_id;
    end if;

    -- A tray chip whose source went away (brand gone, line removed or merged, decision taken).
    delete from public.movements
     where work_order_id = p_work_order_id and status = 'tray'
       and (source_key like 'paint:%' or source_key like 'matline:%' or source_key = 'rubbish')
       and not (id = any (v_seen));
    get diagnostics v_removed = row_count;
    -- A placed, ordered chip whose source went away is flagged, never touched otherwise.
    update public.movements set source_changed_at = coalesce(source_changed_at, now())
     where work_order_id = p_work_order_id and status in ('planned', 'booked', 'problem') and ordered_at is not null
       and (source_key like 'paint:%' or source_key like 'matline:%')
       and not (id = any (v_seen));
  else
    -- Closed job: every item the register still shows on this site gets its return chip.
    for r in
      select mo.id as out_id, mo.title, mo.work_order_id
        from public.movements mo
       where mo.work_order_id = p_work_order_id and mo.kind = 'equipment_out' and mo.status = 'done'
         and exists (select 1 from public.movement_items mi
                      where mi.movement_id = mo.id
                        and (select state from public.equipment_item_location(mi.equipment_item_id)) = 'stranded'
                        and (select work_order_id from public.equipment_item_location(mi.equipment_item_id)) = p_work_order_id)
    loop
      if not exists (select 1 from public.movements where work_order_id = p_work_order_id and source_key = 'return:' || r.out_id) then
        perform public.movements_after_booked(r.out_id);
        v_created := v_created + 1;
      end if;
    end loop;
  end if;

  return 'ok:' || v_created || ':' || v_refreshed || ':' || v_removed;
end $$;
revoke all on function public.movements_sync_for_wo(uuid) from public, anon, authenticated;

create or replace function public.movement_place(p_id uuid, p_assignee_kind public.movement_assignee, p_assignee_id uuid, p_due_date date, p_half text default null, p_time time default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_table text; v_start date; v_status public.movement_status; v_seq int; v_time time;
        v_delivers boolean; v_blocked_status public.movement_status; v_probe public.movements%rowtype; v_was_booked boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_due_date is null then return 'error:no_day'; end if;
  if p_half is not null and p_half not in ('AM', 'PM') then return 'error:bad_half'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  if m.source_key = 'rubbish' and m.detail = 'undecided' then return 'error:rubbish_undecided'; end if;

  if p_assignee_kind = 'supplier' then
    if p_assignee_id is not null then return 'error:bad_assignee'; end if;
    if m.kind not in ('paint', 'materials', 'hire_on', 'hire_off', 'rubbish_in', 'rubbish_out')
       or (m.kind = 'rubbish_out' and m.to_branch_id is null) then
      return 'error:supplier_own_gear';
    end if;
    if m.kind in ('paint', 'materials') then
      -- Tom, 21 Oct 2026: no shop chosen yet is not a delivery — pick the shop in the chip first.
      if m.from_branch_id is null then return 'error:no_shop'; end if;
      if m.from_branch_id is not null then
        select delivers_to_site into v_delivers from public.supplier_branches where id = m.from_branch_id;
        if not coalesce(v_delivers, false) then return 'error:branch_does_not_deliver'; end if;
      end if;
    end if;
  elsif p_assignee_kind = 'person' then
    if p_assignee_id is null then return 'error:bad_assignee'; end if;
    if exists (select 1 from public.contractors where id = p_assignee_id) then v_table := 'contractors';
    elsif exists (select 1 from public.profiles where id = p_assignee_id and role = 'staff') then v_table := 'profiles';
    else return 'error:bad_assignee'; end if;
  else
    return 'error:bad_assignee';
  end if;

  if m.blocked_by_movement_id is not null then
    select status into v_blocked_status from public.movements where id = m.blocked_by_movement_id;
    if v_blocked_status is distinct from 'done' then return 'error:blocked:' || m.blocked_by_movement_id; end if;
  end if;

  select start_date into v_start from public.work_orders where id = m.work_order_id;
  v_time := coalesce(p_time, m.time, case when p_half is not null then nullif(public.movements_settings() -> 'defaultHalfTime' ->> p_half, '')::time end);
  v_was_booked := m.status in ('booked', 'problem') or m.ordered_at is not null;

  -- Needs-order is a function of the drop: compute on the row as it will be.
  v_probe := m; v_probe.assignee_kind := p_assignee_kind; v_probe.assignee_id := p_assignee_id;
  v_status := case when v_was_booked then 'booked'::public.movement_status
                   when public.movement_needs_order(v_probe) then 'planned'::public.movement_status
                   else 'booked'::public.movement_status end;
  if m.status = 'problem' then v_status := 'problem'; end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.movements
   where assignee_kind = p_assignee_kind and assignee_id is not distinct from p_assignee_id and due_date = p_due_date and id <> p_id;

  update public.movements
     set assignee_kind = p_assignee_kind, assignee_id = p_assignee_id, assignee_table = v_table,
         due_date = p_due_date, half = p_half, time = v_time,
         sequence = case when due_date is distinct from p_due_date or assignee_id is distinct from p_assignee_id or assignee_kind is distinct from p_assignee_kind then v_seq else coalesce(sequence, v_seq) end,
         planned_for_start = coalesce(v_start, planned_for_start),
         status = v_status,
         booked_at = case when v_status = 'booked' and booked_at is null then now() else booked_at end,
         booked_by = case when v_status = 'booked' and booked_at is null then auth.uid() else booked_by end
   where id = p_id;
  if v_status = 'booked' and not v_was_booked then perform public.movements_after_booked(p_id); end if;
  perform public.movements_event(m.work_order_id, 'movement_placed', jsonb_build_object(
    'movement_id', p_id, 'assignee_kind', p_assignee_kind::text, 'assignee_id', p_assignee_id, 'due_date', p_due_date, 'half', p_half, 'time', v_time, 'status', v_status::text));
  return 'ok:' || v_status;
end $$;
revoke all on function public.movement_place(uuid, public.movement_assignee, uuid, date, text, time) from public, anon;
grant execute on function public.movement_place(uuid, public.movement_assignee, uuid, date, text, time) to authenticated;

-- Confirm the shop and the method on a tray chip. delivery + a shop that delivers places it
-- on the Supplier lane on the job start day (AM); pickup records the preference and leaves
-- the chip in the tray for a person lane. Staff only.
create or replace function public.movement_set_method(p_id uuid, p_method text, p_branch_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_delivers boolean; v_start date; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_method not in ('delivery', 'pickup') then return 'error:bad_method'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.kind not in ('paint', 'materials') then return 'error:not_an_order'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  if p_branch_id is not null then
    if not exists (select 1 from public.supplier_branches where id = p_branch_id) then return 'error:bad_branch'; end if;
    update public.movements set from_kind = 'branch', from_branch_id = p_branch_id, from_text = public.movements_branch_text(p_branch_id) where id = p_id;
    m.from_branch_id := p_branch_id;
  end if;
  update public.movements set method_pref = p_method where id = p_id;
  perform public.movements_event(m.work_order_id, 'movement_method', jsonb_build_object('movement_id', p_id, 'method', p_method, 'branch_id', m.from_branch_id));
  if p_method = 'delivery' and m.status = 'tray' then
    if m.from_branch_id is null then return 'ok:pickshop'; end if;
    select delivers_to_site into v_delivers from public.supplier_branches where id = m.from_branch_id;
    if not coalesce(v_delivers, false) then return 'ok:nodelivery'; end if;
    select coalesce(w.start_date, current_date) into v_start from public.work_orders w where w.id = m.work_order_id;
    v_r := public.movement_place(p_id, 'supplier', null, coalesce(v_start, current_date), 'AM', null);
    if v_r not like 'ok%' then return v_r; end if;
    return 'ok:placed';
  end if;
  return 'ok:' || p_method;
end $$;
revoke all on function public.movement_set_method(uuid, text, uuid) from public, anon;
grant execute on function public.movement_set_method(uuid, text, uuid) to authenticated;

-- ---- 4. one brand, one chip: brands on the products the paint chips group by ----------------
-- The canonical spelling of a brand: the one with the most products, apostrophes and case
-- aside (Cabots vs Cabot s). Null when nothing matches.
create or replace function public.products_canonical_brand(p_text text)
returns text language sql stable set search_path = public as $$
  select brand from (
    select btrim(brand) as brand, count(*) as n from public.products
     where coalesce(btrim(brand), '') <> ''
       and regexp_replace(lower(brand), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]', '', 'g')
     group by btrim(brand) order by n desc, brand limit 1) s
$$;
revoke all on function public.products_canonical_brand(text) from public, authenticated, anon;

-- The brand a product should carry: its own (canonical spelling), else the brand its name
-- starts with when some product has that brand (Dulux Professional Gloss Enamel → Dulux).
create or replace function public.products_infer_brand(p_name text, p_brand text)
returns text language plpgsql stable set search_path = public as $$
declare v text; w text;
begin
  if coalesce(btrim(p_brand), '') <> '' then
    v := public.products_canonical_brand(p_brand);
    return coalesce(v, btrim(p_brand));
  end if;
  foreach w in array regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+') loop
    v := public.products_canonical_brand(w);
    if v is not null then return v; end if;
    exit; -- only the first word
  end loop;
  return null;
end $$;
revoke all on function public.products_infer_brand(text, text) from public, authenticated, anon;

create or replace function public.products_brand_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.brand := coalesce(public.products_infer_brand(new.name, new.brand), new.brand);
  return new;
end $$;
revoke all on function public.products_brand_default() from public, authenticated, anon;
drop trigger if exists t_products_brand_default on public.products;
create trigger t_products_brand_default before insert or update of name, brand on public.products
  for each row execute function public.products_brand_default();

-- Backfill once (guarded: only rows whose brand would change), then re-sync every open job.
update public.products p set brand = public.products_infer_brand(p.name, p.brand)
 where public.products_infer_brand(p.name, p.brand) is distinct from p.brand
   and public.products_infer_brand(p.name, p.brand) is not null;

create or replace function public.movements_resync_open_jobs()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.work_orders where stage in ('offered', 'pre_start', 'in_progress') and wo_snapshot is not null loop
    perform public.movements_sync_for_wo(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.movements_resync_open_jobs() from public, authenticated, anon;
select public.movements_resync_open_jobs() as open_jobs_resynced;
drop function public.movements_resync_open_jobs();

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_constraint where conname = 'wo_material_lines_text_check' and pg_get_constraintdef(oid) like '%500%') as line_cap_500, 1 as _expect_line_cap_500,
  (select prosrc like '%v_branch := null;%' from pg_proc where proname = 'movements_sync_for_wo' limit 1) as sync_no_default_shop, true as _expect_sync_no_default_shop,
  (select prosrc like '%v_title = '''' then%' from pg_proc where proname = 'movement_create' limit 1) as gear_from_words, true as _expect_gear_from_words,
  (select prosrc like '%no_shop%' from pg_proc where proname = 'movement_place' limit 1) as place_needs_shop, true as _expect_place_needs_shop,
  (select count(*) from information_schema.columns where table_name = 'movements' and column_name = 'method_pref') as method_pref_column, 1 as _expect_method_pref_column,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('movement_set_method', 'products_canonical_brand', 'products_infer_brand', 'products_brand_default')) as helpers, 4 as _expect_helpers,
  (select count(*) from pg_trigger where tgname = 't_products_brand_default') as brand_trigger, 1 as _expect_brand_trigger,
  (select count(*) from public.products where coalesce(btrim(brand), '') = '') as products_without_brand,
  (select count(*) from public.movements where kind = 'materials' and status = 'tray' and from_branch_id is not null) as tray_materials_with_default_shop,
  has_function_privilege('authenticated', 'public.movement_set_method(uuid, text, uuid)', 'execute') as set_method_granted, true as _expect_set_method_granted;

insert into public._prod_migrations(name) values ('20270287000000_movements_first_week.sql') on conflict (name) do nothing;

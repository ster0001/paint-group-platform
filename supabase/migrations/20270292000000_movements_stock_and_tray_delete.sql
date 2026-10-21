-- =============================================================================
-- Movements (Tom, 22 Oct 2026): paint and materials from OUR STOCK, and a tray that deletes
-- in one tap.
--   1. method_pref gains stock. movement_set_method(id, stock) makes the warehouse the source
--      (from_kind warehouse, no shop); the chip needs no order step and books by being dropped
--      on a person. movement_place refuses a stock chip on the Supplier lane (from_stock). The
--      sync never refills a shop onto a stock chip (paint and materials branches re-emitted
--      from 20270287 with that guard).
--   2. One-tap delete needs no SQL: a synced chip that is cancelled is not re-created by the
--      sync (it looks a chip up by source key whatever its status) and a materials line chip
--      is deleted through material_line_remove.
-- Converging.
-- =============================================================================
set lock_timeout = '15s';

alter table public.movements drop constraint if exists movements_method_pref_check;
alter table public.movements add constraint movements_method_pref_check check (method_pref is null or method_pref in ('delivery', 'pickup', 'stock'));

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
          -- Tom, 22 Oct 2026: a chip marked from our stock keeps no shop — the sync never refills one.
          update public.movements set title = v_title, detail = v_detail,
                 from_branch_id = case when method_pref = 'stock' then null else coalesce(from_branch_id, v_branch) end,
                 from_text = case when method_pref = 'stock' then from_text when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end,
                 to_text = v_site, order_ref = case when order_ref = '' then public.movements_job_ref(p_work_order_id) else order_ref end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null and method_pref is distinct from 'stock'));
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
                 from_branch_id = case when method_pref = 'stock' then null else coalesce(from_branch_id, v_branch) end,
                 from_text = case when method_pref = 'stock' then from_text when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null and method_pref is distinct from 'stock'));
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
      -- Tom, 22 Oct 2026: from our stock is ours to carry — a person, never the Supplier lane.
      if m.from_kind = 'warehouse' or m.method_pref = 'stock' then return 'error:from_stock'; end if;
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

create or replace function public.movement_set_method(p_id uuid, p_method text, p_branch_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_delivers boolean; v_start date; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_method not in ('delivery', 'pickup', 'stock') then return 'error:bad_method'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.kind not in ('paint', 'materials') then return 'error:not_an_order'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  if p_branch_id is not null then
    if not exists (select 1 from public.supplier_branches where id = p_branch_id) then return 'error:bad_branch'; end if;
    update public.movements set from_kind = 'branch', from_branch_id = p_branch_id, from_text = public.movements_branch_text(p_branch_id) where id = p_id;
    m.from_branch_id := p_branch_id;
  end if;
  -- Tom, 22 Oct 2026: from our stock — the warehouse is where it comes from, no shop, no order
  -- step; it books by being dropped on whoever carries it. Leaving stock clears the warehouse.
  if p_method = 'stock' then
    update public.movements set from_kind = 'warehouse', from_branch_id = null,
           from_text = coalesce(nullif(public.movements_settings() -> 'warehouse' ->> 'label', ''), 'Warehouse'), method_pref = 'stock'
     where id = p_id;
    perform public.movements_event(m.work_order_id, 'movement_method', jsonb_build_object('movement_id', p_id, 'method', 'stock'));
    return 'ok:stock';
  elsif m.from_kind = 'warehouse' and p_branch_id is null then
    update public.movements set from_kind = null, from_text = '' where id = p_id;
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

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_constraint where conname = 'movements_method_pref_check' and pg_get_constraintdef(oid) like '%stock%') as stock_allowed, 1 as _expect_stock_allowed,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'movement_set_method' and pg_get_functiondef(p.oid) like '%ok:stock%') as set_method_stock, 1 as _expect_set_method_stock,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'movement_place' and pg_get_functiondef(p.oid) like '%from_stock%') as place_refuses_stock, 1 as _expect_place_refuses_stock,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'movements_sync_for_wo' and pg_get_functiondef(p.oid) like '%method_pref is distinct from%') as sync_keeps_stock, 1 as _expect_sync_keeps_stock;

insert into public._prod_migrations(name) values ('20270292000000_movements_stock_and_tray_delete.sql') on conflict (name) do nothing;

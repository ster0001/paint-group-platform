-- =============================================================================
-- Tom, 22 Oct 2026 (batch): four small writers the screens were missing.
--   1. wo_set_job_title: the job title on the working scope belongs to the office to edit (it
--      starts as the address; Interior / Exterior tell two jobs at one address apart).
--   2. material_cost_update: supplier, amount, invoice date, reference and WHICH ORDER
--      (movement) a supplier invoice belongs to — tap a material to fix a label or a price,
--      or move it to a different order.
--   3. material_cost_add_manual: a material cost typed by hand against an order, no document.
--   4. job_cost_update: label, amount, GST and category of a recorded job cost (the ones that
--      landed as Other).
-- Staff only; every change is an event on the job. Converging.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_set_job_title(p_work_order_id uuid, p_title text)
returns text language plpgsql security definer set search_path = public as $$
declare v_title text; v_old text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  v_title := left(btrim(coalesce(p_title, '')), 120);
  if v_title = '' then return 'error:empty'; end if;
  select wo_snapshot ->> 'jobTitle' into v_old from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  update public.work_orders set wo_snapshot = jsonb_set(coalesce(wo_snapshot, '{}'::jsonb), '{jobTitle}', to_jsonb(v_title), true) where id = p_work_order_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'job_title_set', auth.uid(), 'staff', jsonb_build_object('from', v_old, 'to', v_title));
  return 'ok:' || v_title;
end $$;
revoke all on function public.wo_set_job_title(uuid, text) from public, anon;
grant execute on function public.wo_set_job_title(uuid, text) to authenticated;

create or replace function public.material_cost_update(p_id uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare m public.material_costs%rowtype; v_mid uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.material_costs where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if p ? 'supplier' then
    if btrim(coalesce(p ->> 'supplier', '')) = '' then return 'error:empty'; end if;
    update public.material_costs set supplier = left(btrim(p ->> 'supplier'), 120) where id = p_id;
  end if;
  if p ? 'amount_cents' then
    if (p ->> 'amount_cents')::int < 0 then return 'error:bad_amount'; end if;
    update public.material_costs set amount_cents = (p ->> 'amount_cents')::int where id = p_id;
  end if;
  if p ? 'invoice_date' then update public.material_costs set invoice_date = nullif(p ->> 'invoice_date', '')::date where id = p_id; end if;
  if p ? 'order_ref' then update public.material_costs set order_ref = left(btrim(coalesce(p ->> 'order_ref', '')), 60) where id = p_id; end if;
  if p ? 'movement_id' then
    v_mid := nullif(p ->> 'movement_id', '')::uuid;
    if v_mid is not null and not exists (select 1 from public.movements mv where mv.id = v_mid and mv.work_order_id is not distinct from m.work_order_id) then return 'error:bad_order'; end if;
    update public.material_costs set movement_id = v_mid where id = p_id;
  end if;
  if m.work_order_id is not null then
    perform public.movements_event(m.work_order_id, 'material_cost_edited', jsonb_build_object('material_cost_id', p_id, 'patch', p));
  end if;
  return 'ok:' || p_id;
end $$;
revoke all on function public.material_cost_update(uuid, jsonb) from public, anon;
grant execute on function public.material_cost_update(uuid, jsonb) to authenticated;

create or replace function public.material_cost_add_manual(p_work_order_id uuid, p_supplier text, p_amount_cents integer, p_movement_id uuid default null, p_order_ref text default '', p_invoice_date date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  if btrim(coalesce(p_supplier, '')) = '' then return 'error:empty'; end if;
  if coalesce(p_amount_cents, -1) < 0 then return 'error:bad_amount'; end if;
  if p_movement_id is not null and not exists (select 1 from public.movements mv where mv.id = p_movement_id and mv.work_order_id = p_work_order_id) then return 'error:bad_order'; end if;
  insert into public.material_costs (work_order_id, supplier, amount_cents, invoice_date, order_ref, source, matched_by, matched_at, movement_id)
    values (p_work_order_id, left(btrim(p_supplier), 120), p_amount_cents, p_invoice_date, left(btrim(coalesce(p_order_ref, '')), 60), 'manual', 'staff', now(), p_movement_id)
    returning id into v_id;
  perform public.movements_event(p_work_order_id, 'material_cost_added', jsonb_build_object('material_cost_id', v_id, 'movement_id', p_movement_id, 'amount_cents', p_amount_cents));
  return 'ok:' || v_id;
end $$;
revoke all on function public.material_cost_add_manual(uuid, text, integer, uuid, text, date) from public, anon;
grant execute on function public.material_cost_add_manual(uuid, text, integer, uuid, text, date) to authenticated;

create or replace function public.job_cost_update(p_id uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare c public.job_costs%rowtype; v_cat public.job_cost_category;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into c from public.job_costs where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if c.status = 'paid' then return 'error:paid'; end if;
  if p ? 'description' then update public.job_costs set description = left(btrim(coalesce(p ->> 'description', '')), 400) where id = p_id; end if;
  if p ? 'amount_ex_cents' then
    if (p ->> 'amount_ex_cents')::int < 0 then return 'error:bad_amount'; end if;
    update public.job_costs set amount_ex_cents = (p ->> 'amount_ex_cents')::int where id = p_id;
  end if;
  if p ? 'gst_cents' then
    if (p ->> 'gst_cents')::int < 0 then return 'error:bad_amount'; end if;
    update public.job_costs set gst_cents = (p ->> 'gst_cents')::int where id = p_id;
  end if;
  if p ? 'category' then
    begin v_cat := (p ->> 'category')::public.job_cost_category; exception when others then return 'error:bad_category'; end;
    update public.job_costs set category = v_cat where id = p_id;
  end if;
  if c.work_order_id is not null then
    perform public.movements_event(c.work_order_id, 'job_cost_edited', jsonb_build_object('job_cost_id', p_id, 'patch', p));
  end if;
  return 'ok:' || p_id;
end $$;
revoke all on function public.job_cost_update(uuid, jsonb) from public, anon;
grant execute on function public.job_cost_update(uuid, jsonb) to authenticated;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('wo_set_job_title', 'material_cost_update', 'material_cost_add_manual', 'job_cost_update')) as new_functions, 4 as _expect_new_functions,
  has_function_privilege('authenticated', 'public.wo_set_job_title(uuid, text)', 'execute') as title_granted, true as _expect_title_granted,
  has_function_privilege('authenticated', 'public.material_cost_update(uuid, jsonb)', 'execute') as material_update_granted, true as _expect_material_update_granted,
  has_function_privilege('authenticated', 'public.material_cost_add_manual(uuid, text, integer, uuid, text, date)', 'execute') as material_add_granted, true as _expect_material_add_granted,
  has_function_privilege('authenticated', 'public.job_cost_update(uuid, jsonb)', 'execute') as job_cost_update_granted, true as _expect_job_cost_update_granted;

insert into public._prod_migrations(name) values ('20270294000000_tom_batch_22oct.sql') on conflict (name) do nothing;

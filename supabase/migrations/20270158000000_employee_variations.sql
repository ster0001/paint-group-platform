-- =============================================================================
-- Employed painters — Session 4: variations, the employee side
-- (docs/briefs/claude-code-brief-employed-painters.md §3.5, ruling 8)
--
-- Same card in, different card out. An employee raises the same structured
-- variation; the office prices it; the customer signs it — unchanged. What
-- differs is the far end: an employee sees "Variation approved" with the
-- scope lines and the hours, and nothing else happens. No adjusted offer, no
-- accept step, no dollar figure (ruling 8).
--
-- Three things, none of which touches the contractor's path:
--   1. wo_raise_variation lets any painter ON the job raise one — the lead is
--      work_orders.contractor_id already, so this widens to the rest of the
--      crew through wo_my_job_ids_as_contractor() (20270154). A contractor
--      still matches exactly as before.
--   2. employee_variations(): the money-free read. An employee has no row
--      access to wo_variations (20270153); this is the only way it reaches them.
--   3. The accept step is REMOVED for employee jobs at the database: a BEFORE
--      UPDATE trigger turns customer_approved into contractor_accepted on a
--      job that is crewed by assignments, in the same statement the customer's
--      signature lands. wo_customer_sign_variation is not edited (its body is
--      fenced — 20261011's lesson); the stage gate, which waits on
--      customer_approved, therefore never waits on nobody. Credits that need a
--      manual deduction are the office's, and stay put.
-- =============================================================================

-- ---- 1. any painter on the job may raise --------------------------------------
-- 20261002 body verbatim, one line changed: the "is this yours?" test.
create or replace function public.wo_raise_variation(
  p_work_order_id uuid, p_category text, p_comment text,
  p_photo_ids uuid[], p_est_hours numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_id uuid; v_photos integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    -- The lead (contractor_id) OR anyone assigned to the job (employed crew).
    if v_cid is null or v_wo.id not in (select public.wo_my_job_ids_as_contractor()) then
      return 'error:not_yours';
    end if;
    v_kind := 'contractor';
  end if;

  if coalesce(trim(p_category), '') = '' then return 'error:no_category'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  if p_est_hours is not null and p_est_hours <= 0 then return 'error:bad_hours'; end if;

  select count(*) into v_photos
    from public.wo_photos
   where id = any (coalesce(p_photo_ids, '{}'::uuid[]))
     and work_order_id = p_work_order_id;
  if v_photos = 0 then return 'error:photos_required'; end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment, est_hours, status)
    values (p_work_order_id, auth.uid(), v_kind,
            v_kind = 'staff', trim(p_category), trim(p_comment), p_est_hours, 'raised')
    returning id into v_id;

  update public.wo_photos
     set variation_id = v_id, kind = 'variation'
   where id = any (p_photo_ids) and work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'variation_raised', auth.uid(), v_kind,
            jsonb_build_object('variation_id', v_id, 'category', trim(p_category),
                               'est_hours', p_est_hours, 'photos', v_photos,
                               'override', v_kind = 'staff'));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_raise_variation(uuid, text, text, uuid[], numeric) to authenticated;

-- ---- 2. is this an employee-crewed job? ---------------------------------------
create or replace function public.wo_is_employee_job(p_work_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wo_assignments a
                  where a.work_order_id = p_work_order_id and a.status <> 'released')
     and not exists (select 1 from public.booking_offers o
                      where o.work_order_id = p_work_order_id
                        and o.state in ('offered', 'proposed', 'accepted'))
$$;
grant execute on function public.wo_is_employee_job(uuid) to authenticated;

-- ---- 3. the money-free read ---------------------------------------------------
-- outcome: with_office (raised) · with_customer (priced) · approved · not_going_ahead
-- scope_lines: the office's priced lines with every money key stripped —
-- what to do, not what it costs. Never a delta, never a rate.
create or replace function public.employee_variations(p_work_order_id uuid)
returns table (
  id uuid, work_order_id uuid, category text, comment text, est_hours numeric,
  outcome text, scope_lines jsonb, office_note text, credit boolean,
  created_at timestamptz, decided_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select v.id, v.work_order_id, v.category, v.comment, v.est_hours,
         case v.status::text
           when 'raised' then 'with_office'
           when 'priced' then 'with_customer'
           when 'customer_approved' then 'approved'
           when 'contractor_accepted' then 'approved'
           when 'declined' then 'not_going_ahead'
           else 'not_going_ahead' end,
         coalesce(public.jsonb_strip_money(v.priced_lines), '[]'::jsonb),
         coalesce(v.declined_reason, ''),
         coalesce(v.credit, false),
         v.created_at, v.customer_responded_at
    from public.wo_variations v
   where public.is_employee()
     and v.work_order_id = p_work_order_id
     and v.work_order_id in (select public.wo_my_job_ids_as_contractor())
     and v.status <> 'cancelled'
   order by v.created_at desc
$$;
grant execute on function public.employee_variations(uuid) to authenticated;

-- ---- 4. no accept step on an employee job -----------------------------------
create or replace function public.wo_variation_employee_autoapply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'customer_approved' and old.status is distinct from 'customer_approved'
     and public.wo_is_employee_job(new.work_order_id)
     and not coalesce(new.needs_manual_deduction, false) then
    new.status := 'contractor_accepted';
    new.contractor_accepted_at := now();
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (new.work_order_id, 'variation_employee_applied', 'system',
              jsonb_build_object('variation_id', new.id, 'hours', new.est_hours, 'credit', coalesce(new.credit, false)));
  end if;
  return new;
end $$;

drop trigger if exists wo_variations_employee_autoapply on public.wo_variations;
create trigger wo_variations_employee_autoapply
  before update on public.wo_variations
  for each row execute function public.wo_variation_employee_autoapply();

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select prosrc like '%wo_my_job_ids_as_contractor%' from pg_proc where proname = 'wo_raise_variation') as raise_widened,
  (select count(*) from pg_proc where proname in ('wo_is_employee_job', 'employee_variations', 'wo_variation_employee_autoapply')) = 3 as three_functions,
  (select count(*) from pg_trigger where tgname = 'wo_variations_employee_autoapply' and not tgisinternal) = 1 as trigger_present;

insert into public._prod_migrations(name) values ('20270158000000_employee_variations.sql') on conflict (name) do nothing;

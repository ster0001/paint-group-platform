-- =============================================================================
-- Employed painters — Session 7: leave / RDO requests, sick days (brief §3.9,
-- ruling 11; ⚑H: one calendar table, extended in 20270154)
--
-- 1. An employee REQUESTS leave or an RDO; the office approves or declines.
--    Only an approved request blocks the board (wo_assignment_conflict already
--    reads approved_at); a declined one keeps its row so the painter sees why.
-- 2. A sick day is self-marked and counts at once — and for every assignment
--    it lands on, it raises the same can't-make-it event Session 3 built, so
--    ONE work item (employee_reassign) covers "sick" and "can't make it".
-- 3. Nothing here is client-writable: the two RPCs are the only way in for a
--    painter; the office decides through leave_decide. The office's own
--    blocks (source 'staff') and a contractor's tap-to-block are untouched.
-- =============================================================================

alter table public.contractor_unavailability
  add column if not exists declined_at    timestamptz,
  add column if not exists decline_reason text not null default '';

create index if not exists contractor_unavailability_pending_idx
  on public.contractor_unavailability (start_date)
  where kind in ('leave', 'rdo') and approved_at is null and declined_at is null;

-- ---- the painter asks --------------------------------------------------------------
create or replace function public.leave_request(p_kind text, p_start date, p_end date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_id uuid; v_today date; a record; v_kind public.unavailability_kind;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_painter'; end if;
  if not public.is_employee() then return 'error:not_an_employee'; end if;
  if p_kind not in ('leave', 'rdo', 'sick') then return 'error:bad_kind'; end if;
  v_kind := p_kind::public.unavailability_kind;
  if p_start is null or p_end is null or p_end < p_start then return 'error:bad_dates'; end if;
  if p_end - p_start > 60 then return 'error:too_long'; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if v_kind <> 'sick' and p_start < v_today then return 'error:in_the_past'; end if;
  -- Sick is today (or yesterday, marked the morning after) — not a fortnight from now.
  if v_kind = 'sick' and (p_start < v_today - 1 or p_start > v_today or p_end - p_start > 14) then return 'error:sick_is_now'; end if;
  if length(coalesce(p_reason, '')) > 300 then return 'error:reason_too_long'; end if;
  if exists (select 1 from public.contractor_unavailability u
              where u.contractor_id = v_cid and u.declined_at is null
                and u.start_date <= p_end and u.end_date >= p_start) then
    return 'error:overlap';
  end if;

  insert into public.contractor_unavailability (contractor_id, start_date, end_date, reason, source, kind, requested_by)
  values (v_cid, p_start, p_end, coalesce(trim(p_reason), ''), 'contractor', v_kind, auth.uid())
  returning id into v_id;

  -- Sick over a booked day: the office's Reassign item, through the event
  -- Session 3 already derives it from. One per assignment the days touch.
  if v_kind = 'sick' then
    for a in select * from public.wo_assignments
              where contractor_id = v_cid and status <> 'released'
                and start_date <= p_end and end_date >= p_start
    loop
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (a.work_order_id, 'assignment_cant_make_it', auth.uid(), 'contractor',
              jsonb_build_object('assignment_id', a.id, 'contractor_id', v_cid,
                                 'start_date', a.start_date, 'end_date', a.end_date,
                                 'reason', 'Sick' || case when coalesce(trim(p_reason), '') <> '' then ' — ' || trim(p_reason) else '' end,
                                 'unavailability_id', v_id));
    end loop;
  end if;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.leave_request(text, date, date, text) to authenticated;

-- A request the painter no longer needs — theirs, and not yet started.
create or replace function public.leave_cancel(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_unavailability%rowtype; v_today date;
begin
  select * into v from public.contractor_unavailability where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.contractor_id is distinct from public.current_contractor_id() then return 'error:not_yours'; end if;
  if v.kind not in ('leave', 'rdo', 'sick') then return 'error:not_a_request'; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if v.kind <> 'sick' and v.start_date <= v_today then return 'error:already_started'; end if;
  delete from public.contractor_unavailability where id = p_id;
  return 'ok:cancelled';
end $$;
grant execute on function public.leave_cancel(uuid) to authenticated;

-- ---- the office decides -------------------------------------------------------------
-- Approving over a booked day is refused with the job named: reassign first,
-- then approve — an approved leave that silently empties a job is the thing
-- the board exists to prevent.
create or replace function public.leave_decide(p_id uuid, p_approve boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_unavailability%rowtype; v_ref text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.contractor_unavailability where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.kind not in ('leave', 'rdo') then return 'error:not_a_request'; end if;
  if p_approve then
    if v.approved_at is not null then return 'ok:already'; end if;
    select w.wo_ref into v_ref from public.wo_assignments a join public.work_orders w on w.id = a.work_order_id
     where a.contractor_id = v.contractor_id and a.status <> 'released'
       and a.start_date <= v.end_date and a.end_date >= v.start_date
     order by a.start_date limit 1;
    if v_ref is not null then return 'conflict:assigned:' || v_ref; end if;
    update public.contractor_unavailability
       set approved_by = auth.uid(), approved_at = now(), declined_at = null, decline_reason = ''
     where id = p_id;
  else
    if v.declined_at is not null then return 'ok:already'; end if;
    update public.contractor_unavailability
       set declined_at = now(), decline_reason = left(coalesce(p_note, ''), 300), approved_at = null, approved_by = null
     where id = p_id;
  end if;
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (v.contractor_id, 'leave_decided',
          jsonb_build_object('unavailability_id', p_id, 'kind', v.kind, 'approved', p_approve,
                             'start_date', v.start_date, 'end_date', v.end_date), auth.uid());
  return case when p_approve then 'ok:approved' else 'ok:declined' end;
end $$;
grant execute on function public.leave_decide(uuid, boolean, text) to authenticated;

-- ---- read-back --------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_unavailability'
     and column_name in ('declined_at', 'decline_reason')) = 2 as columns_ok,
  exists (select 1 from pg_indexes where indexname = 'contractor_unavailability_pending_idx') as index_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('leave_request', 'leave_cancel', 'leave_decide')) = 3 as functions_ok;

insert into public._prod_migrations(name) values ('20270164000000_leave_requests.sql') on conflict (name) do nothing;

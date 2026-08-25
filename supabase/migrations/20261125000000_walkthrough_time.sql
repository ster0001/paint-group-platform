-- ============================================================================
-- Walkthrough bookings carry a TIME (Tom, 25 Aug 2026): the final walkthrough
-- is confirmed with the client when the project is booked in — date AND time —
-- so later automations can remind the client before the appointment and the
-- contractor that the finish is still on track.
--
-- Idempotent; safe to re-run. Ends with read-backs (house law).
-- ============================================================================

alter table public.wo_walkthroughs
  add column if not exists scheduled_time time;

-- The signature changes (new p_time param), so the old function is dropped
-- rather than overloaded — two overloads would make PostgREST's named-arg
-- calls ambiguous.
drop function if exists public.wo_book_walkthrough(uuid, text, date, text);

create or replace function public.wo_book_walkthrough(
  p_work_order_id uuid, p_kind text, p_date date default null,
  p_note text default '', p_time time default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_date date; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('pre', 'final') then return 'error:bad_kind'; end if;

  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if p_kind = 'final' and exists (
    select 1 from public.wo_qa_checks
     where work_order_id = p_work_order_id and (result is null or result = 'fail')
  ) then
    return 'error:qa_first';
  end if;

  v_date := p_date;
  if v_date is null and p_kind = 'final' then
    select bo.end_date into v_date
      from public.booking_offers bo
     where bo.work_order_id = p_work_order_id and bo.state = 'accepted'
     order by bo.accepted_at desc nulls last limit 1;
  end if;
  if v_date is null then return 'error:no_date'; end if;

  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = p_kind and status = 'booked';

  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, scheduled_time, booked_by, note)
    values (p_work_order_id, p_kind, v_date, p_time, auth.uid(), coalesce(p_note, ''))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_booked', auth.uid(), 'staff',
            jsonb_build_object('walkthrough_id', v_id, 'kind', p_kind,
                               'date', v_date, 'time', p_time));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_book_walkthrough(uuid, text, date, text, time) to authenticated;

-- ---- read-backs -------------------------------------------------------------

-- Expect: scheduled_time | time without time zone
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'wo_walkthroughs'
   and column_name = 'scheduled_time';

-- Expect: exactly ONE wo_book_walkthrough, 5 args, security definer
select p.proname, p.pronargs, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'wo_book_walkthrough';

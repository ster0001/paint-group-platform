-- Tom's 1 Sep batch (found while wiring the walkthrough calendar invites):
-- wo_contractor_set_finish_date re-books the final walkthrough on the new
-- last day, but its insert predates the scheduled_time column (20261125) —
-- every finish-date move silently DROPPED the time confirmed with the client,
-- and the auto-updating calendar invite would degrade to an all-day entry.
-- The re-book now carries the cancelled row's time forward.
--
-- 20261106 body verbatim + one variable and the time carried into the insert.

create or replace function public.wo_contractor_set_finish_date(p_work_order_id uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_o public.booking_offers%rowtype; v_id uuid;
        v_kind text; v_old date; v_time time;
begin
  if p_date is null then return 'error:no_date'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if v_wo.stage in ('offered', 'closed') then return 'error:not_live'; end if;

  select * into v_o from public.booking_offers
   where work_order_id = p_work_order_id and state = 'accepted'
   order by accepted_at desc nulls last limit 1;
  if not found then return 'error:no_booking'; end if;
  if p_date < v_o.start_date then return 'error:before_start'; end if;

  v_old := v_o.end_date;
  update public.booking_offers set end_date = p_date where id = v_o.id;
  -- The sync trigger listens to state only; write the work order here.
  update public.work_orders set end_date = p_date where id = p_work_order_id;

  -- Keep the client-confirmed TIME when the day moves.
  select scheduled_time into v_time from public.wo_walkthroughs
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked'
   order by created_at desc limit 1;

  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked';
  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, scheduled_time, booked_by, note)
    values (p_work_order_id, 'final', p_date, v_time, auth.uid(),
            case when v_kind = 'contractor' then 'Finish date set by the painter' else '' end)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'finish_date_changed', auth.uid(), v_kind,
            jsonb_build_object('from', v_old, 'to', p_date, 'walkthrough_id', v_id));
  return 'ok:' || p_date::text;
end $$;
grant execute on function public.wo_contractor_set_finish_date(uuid, date) to authenticated;

-- ---- readback -------------------------------------------------------------
-- Expect true: the re-book insert now names scheduled_time.
select (select prosrc like '%scheduled_date, scheduled_time, booked_by%' from pg_proc
         where proname = 'wo_contractor_set_finish_date' limit 1) as carries_time;

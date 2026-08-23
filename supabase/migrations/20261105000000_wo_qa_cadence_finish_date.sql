-- =============================================================================
-- Tom, 23 Aug (batch 3):
--   · ONE quality check as standard (the final); a mid-job check is ADDED by
--     the office when wanted (wo_add_qa_check); a job can be flagged "quality
--     check required" when it is booked in (work_orders.qa_required), which
--     widens the cadence to that job whoever the painter is;
--   · the painter may start the walkthrough WITHOUT the office booking it;
--   · the painter can move the finish / walkthrough date when finishing
--     earlier or later (wo_contractor_set_finish_date): the accepted booking's
--     end date moves (the calendar and work order follow by trigger) and the
--     final walkthrough is re-booked to that day.
-- =============================================================================

-- ---- 1. cadence: final only; a job-level flag ---------------------------------
update public.settings
   set value = jsonb_set(value, '{qaCadence,checks}', '["final"]'::jsonb, true)
 where key = 'wo_loop';

alter table public.work_orders add column if not exists qa_required boolean not null default false;

-- Unlogged day-one checks on live jobs came from the old default; the ruling is
-- one check, so they go (nothing was ever recorded against them).
delete from public.wo_qa_checks c
 using public.work_orders w
 where w.id = c.work_order_id and w.stage <> 'closed'
   and c.kind = 'day_one' and c.result is null;

create or replace function public.wo_set_qa_required(p_work_order_id uuid, p_required boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.work_orders set qa_required = p_required where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  -- Flagged on: schedule straight away so the check is on the books.
  if p_required then perform public.wo_schedule_qa(p_work_order_id); end if;
  return 'ok:' || p_required::text;
end $$;
grant execute on function public.wo_set_qa_required(uuid, boolean) to authenticated;

-- 20261030 body VERBATIM, one clause added: the job's own flag widens the cadence.
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_flagged boolean;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;

  select requires_qa into v_flagged from public.contractors where id = v_wo.contractor_id;
  if not (public.wo_contractor_is_new(v_wo.contractor_id) or coalesce(v_flagged, false)
          or coalesce(v_wo.qa_required, false)) then
    return 'ok:0';
  end if;

  for v_kind in
    select jsonb_array_elements_text(public.wo_loop_setting(array['qaCadence','checks']))
  loop
    if not exists (select 1 from public.wo_qa_checks
                    where work_order_id = p_work_order_id and kind = v_kind) then
      insert into public.wo_qa_checks (work_order_id, kind, scheduled_for)
        values (p_work_order_id, v_kind,
                case when v_kind = 'day_one' then v_wo.start_date else null end);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_schedule_qa(uuid) to authenticated, service_role;

-- ---- 2. a mid-job check, added by the office --------------------------------
-- Kind 'mid'; the standards seed by the existing trigger. Several may exist.
create or replace function public.wo_add_qa_check(p_work_order_id uuid, p_date date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage in ('closed') then return 'error:closed'; end if;

  insert into public.wo_qa_checks (work_order_id, kind, scheduled_for)
    values (p_work_order_id, 'mid', p_date) returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_check_added', auth.uid(), 'staff',
            jsonb_build_object('check_id', v_id, 'kind', 'mid', 'date', p_date));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_add_qa_check(uuid, date) to authenticated;

-- ---- 3. the painter starts the walkthrough — no booking needed --------------
-- 20261028 body VERBATIM minus the "booked final ≤ today" clause (Tom, 23 Aug).
create or replace function public.wo_start_walkthrough_mode(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_cid uuid; v_token text;
begin
  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_w.contractor_id)) then
    return 'error:not_yours';
  end if;
  if v_w.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '2 hours'
   where work_order_id = p_work_order_id and signed_at is null;
  if not found then return 'error:no_signoff_row'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_mode_started', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('expires_at', now() + interval '2 hours'));
  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_start_walkthrough_mode(uuid) to authenticated;

-- ---- 4. the painter moves the finish / walkthrough date ---------------------
-- The accepted booking's end date moves (wo_stage_follows_offer copies it onto
-- the work order, the calendar lane follows); the final walkthrough is
-- re-booked to the same day. Never earlier than the start; the office is told
-- by event.
create or replace function public.wo_contractor_set_finish_date(p_work_order_id uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_o public.booking_offers%rowtype; v_id uuid;
        v_kind text; v_old date;
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

  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked';
  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, booked_by, note)
    values (p_work_order_id, 'final', p_date, auth.uid(),
            case when v_kind = 'contractor' then 'Finish date set by the painter' else '' end)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'finish_date_changed', auth.uid(), v_kind,
            jsonb_build_object('from', v_old, 'to', p_date, 'walkthrough_id', v_id));
  return 'ok:' || p_date::text;
end $$;
grant execute on function public.wo_contractor_set_finish_date(uuid, date) to authenticated;

-- ---- 5. staff record the sign-off from our side (Tom, 23 Aug) ----------------
-- The customer approved in person / on the phone / on paper and a staff member
-- records it: every outstanding area is approved on the customer's behalf, the
-- signature is taken through wo_sign (so warranty, report, invoice stub and the
-- close all happen exactly as they do for any other signing), then the record
-- says it was captured by staff. Stage must be walkthrough (the pack has gone).
create or replace function public.wo_staff_sign(p_work_order_id uuid, p_name text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_s public.wo_signoff%rowtype; v_token text; v_r text; v_h text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found then return 'error:no_signoff_row'; end if;
  if v_s.signed_at is not null then return 'ok:already'; end if;

  -- Approve every area the customer has not answered — staff are vouching.
  for v_h in select distinct heading from public.wo_surfaces where work_order_id = p_work_order_id
  loop
    if (v_s.areas -> v_h -> 'approved_at') is null then
      update public.wo_signoff
         set areas = areas || jsonb_build_object(v_h, coalesce(areas -> v_h, '{}'::jsonb)
               || jsonb_build_object('approved_at', now(), 'via', 'staff', 'note', coalesce(p_note, '')))
       where work_order_id = p_work_order_id;
    end if;
  end loop;

  -- A one-shot session token, so wo_sign runs its on-device path unchanged.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '10 minutes'
   where work_order_id = p_work_order_id;

  v_r := public.wo_sign(v_token, p_name, 'on_device', 'staff');
  if v_r <> 'ok:signed' then
    update public.wo_signoff set walkthrough_session_token = null, walkthrough_session_expires_at = null
     where work_order_id = p_work_order_id;
    return v_r;
  end if;

  update public.wo_signoff
     set captured_on = 'staff_recorded',
         report = jsonb_set(coalesce(report, '{}'::jsonb), '{captured_on}', '"staff_recorded"'::jsonb, true)
   where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'signed_off_by_staff', auth.uid(), 'staff',
            jsonb_build_object('name', trim(p_name), 'note', coalesce(p_note, '')));
  return 'ok:signed';
end $$;
grant execute on function public.wo_staff_sign(uuid, text, text) to authenticated;

-- ---- read-back ---------------------------------------------------------------
select
  (select value->'qaCadence'->'checks' from public.settings where key = 'wo_loop') as checks,
  (select count(*) from information_schema.columns where table_name = 'work_orders' and column_name = 'qa_required') as qa_required_col,
  (select count(*) from pg_proc where proname in ('wo_set_qa_required','wo_add_qa_check','wo_contractor_set_finish_date','wo_staff_sign')) as new_fns,
  (select prosrc not like '%no_walkthrough_booked%' from pg_proc where proname = 'wo_start_walkthrough_mode' limit 1) as start_unbooked_ok,
  (select prosrc like '%qa_required%' from pg_proc where proname = 'wo_schedule_qa' limit 1) as schedule_reads_flag;

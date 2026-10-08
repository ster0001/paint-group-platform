-- =============================================================================
-- A cancelled final walkthrough can be rebooked (Tom, 8 Oct 2026: "When a walk
-- through is cancelled, I am unable to rebook another one — please see 12
-- Cavell Court").
--
-- WHAT HAPPENED (PS-3156, read on production 8 Oct):
--   26 Sep  booking sheet books the final with the client (13 Oct 15:30)
--   27 Sep  the final quality check is scheduled — result null, i.e. OPEN
--    6 Oct  the office cancels the walkthrough on the job page
--   since   every "Book final" answers error:qa_first
--
-- wo_book_walkthrough refuses ANY final while a check is unpassed — the 23 Aug
-- ruling "no final sign-off date with the client until the checks pass". Two
-- days later (25 Aug) the final became something confirmed with the client AT
-- BOOKING, before any check exists, so the refusal now only ever bites a
-- REBOOK: the date can be set once and, once cancelled (or merely moved), never
-- set again until the job has been painted and checked. Cancelling was a
-- one-way door.
--
-- THE RULE NOW: a final that was already agreed with the client — any earlier
-- final row on the job, booked / cancelled / missed / done — can always be
-- rebooked or moved. A job that has never had a final date still waits for the
-- checks, exactly as before (wo-qa-ruling + wo-qa-recheck specs keep that).
-- The sign-off itself is untouched: it still needs the WALKTHROUGH STAGE, which
-- wo_gate_blocked will not reach while a check is open. Only the calendar
-- appointment is freed.
--
-- Body = 20270196's verbatim, with the one predicate widened. Same signature,
-- so the grant carries over; it is restated anyway (20270201 default privileges).
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

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

  -- No FIRST final date before the checks pass; a date already agreed with the
  -- client (any earlier final, whatever became of it) can always be rebooked.
  if p_kind = 'final'
     and public.wo_qa_open_count(p_work_order_id) > 0
     and not exists (select 1 from public.wo_walkthroughs
                      where work_order_id = p_work_order_id and kind = 'final') then
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
revoke execute on function public.wo_book_walkthrough(uuid, text, date, text, time) from public, anon;
grant execute on function public.wo_book_walkthrough(uuid, text, date, text, time) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_book_walkthrough') as overloads, 1 as _expect_overloads,
  (select prosrc like '%wo_qa_open_count%' and prosrc like '%and kind = ''final'') then%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_book_walkthrough') as rebook_allowed, true as _expect_rebook_allowed,
  has_function_privilege('authenticated', 'public.wo_book_walkthrough(uuid, text, date, text, time)', 'execute')
    as authenticated_can_call, true as _expect_authenticated_can_call,
  has_function_privilege('anon', 'public.wo_book_walkthrough(uuid, text, date, text, time)', 'execute')
    as anon_can_call, false as _expect_anon_can_call;

insert into public._prod_migrations(name) values ('20270241000000_walkthrough_rebook_after_cancel.sql') on conflict (name) do nothing;

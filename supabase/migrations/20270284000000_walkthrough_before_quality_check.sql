-- =============================================================================
-- 20270284 · The final walkthrough is booked and run whether or not the quality
-- check has passed (Tom, 21 Oct 2026):
--
--   Tom: please update to allow to book the final walk through, even if a
--   quality check is required - if the quality check hasnt passed, please
--   still allow the contractor to start the walk through in the app.
--
-- THREE RULES CHANGE, nothing else:
--
--   1. wo_book_walkthrough no longer answers error:qa_first. The 23 Aug ruling
--      (no final date until the checks pass) was already narrowed to the FIRST
--      final on 8 Oct (20270241); it is gone now. A final is booked whenever
--      the office agrees it with the client; the check follows it to the
--      working day before (wo_walkthroughs_qa_follows, 20270247) exactly as it
--      does today.
--
--   2. wo_gate_blocked: an open quality check no longer holds the move to the
--      walkthrough stage. It still holds the move straight to closed from prep
--      or qa (the no-walkthrough path keeps waiting for the office), and the
--      colour-match arm is untouched. The 20270277 body verbatim otherwise.
--
--   3. wo_start_walkthrough_mode accepts a job parked at the qa stage: it
--      delivers the evidence pack (the same RPC a passed check uses, stage to
--      walkthrough, sign-off row and customer token minted) and then opens
--      Walkthrough Mode as before. The job records walkthrough_before_qa so
--      the office can see the painter walked a job whose check is still open.
--      The 20261105 body verbatim otherwise.
--
-- WHAT DOES NOT CHANGE: the painter finish still routes a job with an open
-- check to the qa stage (the office keeps its Quality check lane and card);
-- the check stays open and is logged by the office in its own time; a PASSED
-- check still means the office signs the job off (24 Sep ruling, read from the
-- checks by wo_staff_signs_off and its TS twin). Only the walkthrough itself,
-- and its booking, stop waiting.
--
-- Converges on a re-run. Paste with set lock_timeout first. No quotes in comments.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the final can be booked with a check open --------------------------------
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

  -- Tom, 21 Oct 2026: a final is booked whenever it is agreed with the client,
  -- quality check or not. The check follows the final by trigger (20270247).

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

-- ---- 2. an open check no longer holds the walkthrough stage ---------------------
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer; v_txt text;
begin
  if p_from = 'pre_start' and p_to = 'in_progress' then
    -- 18 Sep: no list at all is not a finished list. A job that never
    -- got one waits here, in words, instead of auto-starting past a screen
    -- the office never saw.
    if not exists (
      select 1 from public.wo_checklist_items i
       where i.work_order_id = p_wo_id and i.phase = 'pre_start'
    ) then
      return 'the pre-start list has not been built for this job yet';
    end if;

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
      into v_total, v_done from public.wo_surfaces
     where work_order_id = p_wo_id and not removed_from_scope;
    if v_total > 0 and v_done < v_total then
      return (v_total - v_done)::text || ' of ' || v_total::text || ' surfaces still to tick off';
    end if;
  end if;

  -- Tom, 19 Oct 2026: an undecided variation holds the job only while a
  -- surface in scope is still to tick. Every area done, the painter finishes
  -- and walks the customer through; the decision waits for the office.
  if p_to <> 'in_progress' and p_to <> 'offered' then
    select count(*) into v_waiting
      from public.wo_variations
     where work_order_id = p_wo_id and status in ('raised', 'priced', 'customer_approved');
    if v_waiting > 0 then
      select count(*) into v_open
        from public.wo_surfaces
       where work_order_id = p_wo_id and not removed_from_scope and state <> 'done';
      if v_open > 0 then
        return v_waiting::text || ' variation' || case when v_waiting = 1 then '' else 's' end
               || ' still waiting on a decision';
      end if;
    end if;
  end if;

  -- Prep gates every exit: quality check, the pack, or straight to closed.
  if p_from = 'completion_prep' and p_to in ('qa', 'walkthrough', 'closed') then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'completion_prep'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  -- CHANGED (Tom, 21 Oct 2026): an open quality check no longer holds the
  -- walkthrough. It still holds the move straight to closed from prep or qa,
  -- the path a job with no customer walkthrough takes; that one waits for the
  -- office to log the check. A failed check is open until its re-check exists.
  if p_to = 'closed' and p_from in ('completion_prep', 'qa') then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  -- Tom, 23 Aug: colour-match codes before the hand-over, pack or closed alike.
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    v_txt := public.wo_colour_match_outstanding(p_wo_id);
    if v_txt <> '' then
      return 'colour match codes still needed for ' || v_txt;
    end if;
  end if;

  -- The walkthrough to closed sign path keeps its own QA guard (was p_to = walkthrough only).
  if p_to = 'walkthrough' and p_from = 'closed' then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  return null;
end $$;

-- ---- 3. the painter starts the walkthrough from the qa stage --------------------
create or replace function public.wo_start_walkthrough_mode(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_cid uuid; v_token text; v_r text; v_open integer;
begin
  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_w.contractor_id)) then
    return 'error:not_yours';
  end if;

  -- Tom, 21 Oct 2026: a job waiting at qa for a check that has not passed can
  -- still be walked. The pack goes out the way a passed check sends it (stage
  -- to walkthrough, sign-off row, customer token); the check stays open for
  -- the office. A gate refusal (colour-match codes) comes back in its words.
  if v_w.stage = 'qa' then
    v_open := public.wo_qa_open_count(p_work_order_id);
    v_r := public.wo_deliver_evidence_pack(p_work_order_id);
    if v_r not like 'ok:%' then return v_r; end if;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'walkthrough_before_qa', auth.uid(),
              case when public.is_staff() then 'staff' else 'contractor' end,
              jsonb_build_object('open_checks', v_open));
    select * into v_w from public.work_orders where id = p_work_order_id;
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
revoke execute on function public.wo_start_walkthrough_mode(uuid) from public, anon;
grant execute on function public.wo_start_walkthrough_mode(uuid) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select prosrc not like '%qa_first%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_book_walkthrough') as book_final_any_time, true as _expect_book_final_any_time,
  (select prosrc like '%if p_to = ''closed'' and p_from in (''completion_prep'', ''qa'') then%'
     from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_check_holds_closed_only, true as _expect_gate_check_holds_closed_only,
  (select prosrc like '%wo_colour_match_outstanding%'
     from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_keeps_colour_arm, true as _expect_gate_keeps_colour_arm,
  (select prosrc like '%walkthrough_before_qa%'
     from pg_proc where proname = 'wo_start_walkthrough_mode' limit 1) as walk_from_qa, true as _expect_walk_from_qa,
  has_function_privilege('authenticated', 'public.wo_book_walkthrough(uuid, text, date, text, time)', 'execute')
    as book_authenticated, true as _expect_book_authenticated,
  has_function_privilege('authenticated', 'public.wo_start_walkthrough_mode(uuid)', 'execute')
    as walk_authenticated, true as _expect_walk_authenticated,
  has_function_privilege('anon', 'public.wo_start_walkthrough_mode(uuid)', 'execute')
    as walk_anon, false as _expect_walk_anon;

insert into public._prod_migrations(name) values ('20270284000000_walkthrough_before_quality_check.sql') on conflict (name) do nothing;

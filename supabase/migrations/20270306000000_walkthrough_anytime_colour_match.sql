-- =============================================================================
-- The walkthrough starts whenever the boxes are ticked (Tom, 26 Oct 2026).
--
-- 28 Logan Street, Canterbury: the painter had ticked every surface and answered every
-- finishing-up question and could not start the walkthrough on his phone. Two paints were
-- flagged colour-match-required on the estimate with no code keyed, so wo_gate_blocked refused
-- the pack in words; and once the office logged the quality check as a pass, the painter page
-- hid the Start button behind the office sign-off (that half is the app, not this file).
--
-- Tom: if all of the boxes are ticked off and questions answered they should be able to start
-- the walk through, even if the date changes, or if colour match details are not supplied. If
-- colour matches are outstanding, this is something we should know from our side.
--
--   1. wo_gate_blocked        re-emitted from 20270284 WITHOUT the colour-match arm. Prep items,
--                             surfaces, variations and the open-check-before-close rules stand.
--   2. wo_deliver_evidence_pack  re-emitted from 20261030; after the pack goes it writes a
--                             colour_match_outstanding event naming the paints still without a
--                             code, so the job timeline says what never came.
--   3. wo_colour_matches_outstanding()  NEW, staff only: the office list of jobs at or past
--                             the hand-over whose colour-match codes are still missing, read by
--                             the PC Command work queue (lib/crm/work-queue.ts). Derived from the
--                             same wo_colour_match_outstanding the gate used to read; keying the
--                             codes on either side clears it. Nothing is stored.
--
-- Converges on a re-run. Paste with set lock_timeout first. No quotes in comments.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the gate, without the colour-match arm -------------------------------------------
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

  -- REMOVED (Tom, 26 Oct 2026, 28 Logan Street): colour-match codes no longer
  -- hold the hand-over or the close. The pack records them as outstanding
  -- (wo_deliver_evidence_pack) and PC Command carries the work item instead.

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

-- ---- 2. the pack records the codes still to come --------------------------------------------
create or replace function public.wo_deliver_evidence_pack(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_hours integer; v_token text; v_clock boolean; v_deadline timestamptz; v_cm text;
        v_kind text; v_blocked text; v_wo public.work_orders%rowtype;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif public.current_contractor_id() is not null
        and public.current_contractor_id() = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_staff';
  end if;

  -- Check the gate BEFORE minting anything: a blocked advance must not leave
  -- a signoff row and a live customer token behind it.
  v_blocked := public.wo_gate_blocked(p_work_order_id, v_wo.stage, 'walkthrough');
  if v_blocked is not null then return 'error:gate:' || v_blocked; end if;

  v_clock := coalesce(public.wo_loop_setting(array['signoff','clockEnabled']) = 'true'::jsonb, false);
  v_hours := coalesce((public.wo_loop_setting(array['signoff','residentialHours']))::text::integer, 72);
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_deadline := case when v_clock then now() + make_interval(hours => v_hours) else null end;

  insert into public.wo_signoff (work_order_id, evidence_pack_sent_at, deadline_at, customer_token)
    values (p_work_order_id, now(), v_deadline, v_token)
  on conflict (work_order_id) do update
    set evidence_pack_sent_at = coalesce(public.wo_signoff.evidence_pack_sent_at, now()),
        deadline_at = coalesce(public.wo_signoff.deadline_at, excluded.deadline_at),
        customer_token = coalesce(public.wo_signoff.customer_token, excluded.customer_token);

  select customer_token into v_token from public.wo_signoff where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'evidence_pack_sent', auth.uid(), v_kind,
            jsonb_build_object('deadline_at', v_deadline, 'clock_enabled', v_clock));

  perform public.wo_set_stage(p_work_order_id, 'walkthrough', v_kind,
                              jsonb_build_object('via', 'evidence_pack'));

  -- Tom, 26 Oct 2026 (28 Logan Street): colour-match codes never hold the pack.
  -- What is still missing is written down here, so the office finds out
  -- (PC Command work item colour_match_outstanding reads wo_colour_matches_outstanding).
  v_cm := public.wo_colour_match_outstanding(p_work_order_id);
  if v_cm <> '' then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'colour_match_outstanding', auth.uid(), v_kind,
              jsonb_build_object('products', v_cm));
  end if;

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_deliver_evidence_pack(uuid) to authenticated, service_role;

-- ---- 3. the office list of jobs whose colour-match codes never came ----------------------
-- A job counts from the hand-over (completion_prep, qa, walkthrough) until 30 days after it is
-- signed off; the painter still on the job has the card on their page and needs no office item.
-- Demo property rows never reach PC Command (lib/demo/scope.ts realOnly is the TS wall; this is
-- the SQL one). Staff only: anyone else gets no rows.
create or replace function public.wo_colour_matches_outstanding()
returns table (
  work_order_id uuid, wo_ref text, where_text text, painter text, stage text, products text, since timestamptz
) language sql stable security definer set search_path = public as $$
  select w.id, w.wo_ref,
         coalesce(nullif(w.wo_snapshot->>'jobAddress', ''), nullif(w.wo_snapshot->>'jobTitle', ''), w.wo_ref),
         coalesce(nullif(trim(pr.name), ''), nullif(trim(c.company_name), ''), 'The painter'),
         w.stage::text,
         public.wo_colour_match_outstanding(w.id),
         coalesce(s.evidence_pack_sent_at, (select min(e.created_at) from public.wo_events e
                                             where e.work_order_id = w.id and e.type = 'stage_changed'
                                               and e.created_at >= now() - interval '60 days'), now())
    from public.work_orders w
    left join public.wo_signoff s on s.work_order_id = w.id
    left join public.contractors c on c.id = w.contractor_id
    left join public.profiles pr on pr.id = c.profile_id
   where public.is_staff()
     and not w.is_demo
     and (w.stage in ('completion_prep', 'qa', 'walkthrough')
          or (w.stage = 'closed' and s.signed_at is not null and s.signed_at >= now() - interval '30 days'))
     and public.wo_colour_match_outstanding(w.id) <> ''
   order by coalesce(s.evidence_pack_sent_at, now());
$$;
revoke execute on function public.wo_colour_matches_outstanding() from public, anon;
grant execute on function public.wo_colour_matches_outstanding() to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ----------------------------------
select
  (select prosrc not like '%wo_colour_match_outstanding%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_has_no_colour_arm, true as _expect_gate_has_no_colour_arm,
  (select prosrc like '%completion item%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_keeps_prep_arm, true as _expect_gate_keeps_prep_arm,
  (select prosrc like '%colour_match_outstanding%' from pg_proc where proname = 'wo_deliver_evidence_pack' limit 1) as pack_records_codes, true as _expect_pack_records_codes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'wo_colour_matches_outstanding') as list_fn, 1 as _expect_list_fn,
  has_function_privilege('authenticated', 'public.wo_colour_matches_outstanding()', 'execute') as list_authenticated, true as _expect_list_authenticated,
  has_function_privilege('anon', 'public.wo_colour_matches_outstanding()', 'execute') as list_anon, false as _expect_list_anon,
  has_function_privilege('authenticated', 'public.wo_deliver_evidence_pack(uuid)', 'execute') as pack_authenticated, true as _expect_pack_authenticated;

insert into public._prod_migrations(name) values ('20270306000000_walkthrough_anytime_colour_match.sql') on conflict (name) do nothing;

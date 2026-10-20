-- =============================================================================
-- The walkthrough goes ahead with a variation still undecided, once every area
-- is ticked off (Tom, 19 Oct 2026):
--
--   Tom: currently, if there are pending variations, they are unable to start
--   the walk through on their phone; update it so they can still start the
--   walk through if all of the areas are ticked off.
--
-- wo_gate_blocked held EVERY forward move (anything but → in_progress / →
-- offered) while a variation sat at raised, priced or customer_approved. On the
-- painter phone that read as 1 variation still waiting on a decision, under
-- Start the walkthrough, with the customer standing next to them.
--
-- THE RULE NOW: an undecided variation holds the job only while a surface in
-- scope is still to tick. With every area done the painter finishes and starts
-- the walkthrough; the office decides the variation in its own time. Nothing
-- about the variation changes: it stays open, on the console Variations
-- for approval, and an undecided one is never invoiced (the final reads only
-- customer_approved / contractor_accepted rows).
--
-- A variation the customer approved that ADDS work: its surfaces join the
-- scope (20261116), so until they are ticked the old refusal still stands.
--
-- The 20270173 body VERBATIM (pg_get_functiondef on the test project) with the
-- variation arm changed; every other arm is byte-for-byte what is running now.
-- Converges on a re-run. Paste with set lock_timeout 15s first.
-- =============================================================================
set lock_timeout = '15s';

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

  -- CHANGED (Tom, 19 Oct 2026): an undecided variation holds the job only
  -- while a surface in scope is still to tick. Every area done → the painter
  -- finishes and walks the customer through; the decision waits for the office.
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

  -- Nobody walks around the quality check: not to the pack, not to closed.
  -- A failed check is open until its re-check exists (20270112).
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
    -- Tom, 23 Aug: colour-match codes before the hand-over.
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

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select prosrc like '%and not removed_from_scope and state <> ''done''%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_reads_undone_surfaces, true as _expect_gate_reads_undone_surfaces,
  (select prosrc like '%the pre-start list has not been built%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_keeps_prestart_arm, true as _expect_gate_keeps_prestart_arm,
  (select prosrc like '%wo_colour_match_outstanding%' from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_keeps_colour_arm, true as _expect_gate_keeps_colour_arm;

insert into public._prod_migrations(name) values ('20270277000000_walkthrough_with_open_variations.sql') on conflict (name) do nothing;

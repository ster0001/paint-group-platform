-- =============================================================================
-- The pre-start list exists on EVERY job — contractor or employee
--
-- Tom, 18 Sep: "in PC command the pre-start checklist has been removed from
-- employees. This still needs to happen for both employees and contractors."
--
-- Nothing in the app branches on employment type anywhere near that list: the
-- office's card renders when the job is at pre-start AND the job has pre-start
-- rows. So the fault can only be the rows, and the rows had exactly ONE way of
-- being made — `wo_events_seed_checklists`, which fires on a stage_changed
-- event into 'offered' or 'pre_start'.
--
-- A work order is ISSUED straight into stage 'offered' by an insert, not by
-- wo_set_stage, so no event fires and nothing is seeded. The list is built
-- later, by the move INTO pre-start:
--
--   contractor  the offer is accepted        → offered → pre_start → seeded
--   employee    assign_job's first assignment → offered → pre_start → seeded
--
-- …but only `if v_first and v_wo.stage = 'offered'`. A painter added to a job
-- that is already under way, a job assigned at any other stage, or any job
-- whose one chance was missed, keeps NO list at all — and then, because the
-- gate counts UNTICKED REQUIRED ITEMS, an empty list reads as "nothing left to
-- tick" and `wo_autostart_sweep` walks the job straight into In progress the
-- moment its start date arrives. The office never sees the list; nobody is
-- told. On this test project 2 of the 3 jobs sitting at 'offered' have no list
-- at all, which is the same hole one stage earlier.
--
-- Three parts, all additive — no function body is retyped from memory:
--   1. the list is built when the job is ISSUED, not first when it moves;
--   2. …and again the moment a painter is ASSIGNED (the employee path Tom
--      asked about, including the second painter on a job already booked);
--   3. the gate REFUSES a job whose pre-start list does not exist, instead of
--      reading its emptiness as done. An empty array is not proof of "nothing
--      to do" — the same lesson as the invoicing read and the missing policy.
-- `wo_seed_checklists` is idempotent (it skips any row already there), so the
-- three trigger points are three doors into ONE seeder, not three seeders.
-- =============================================================================

-- ---- 1. seeded at issue -----------------------------------------------------
create or replace function public.wo_seed_checklists_on_issue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.issued_at is not null and new.stage <> 'closed'
     and (tg_op = 'INSERT' or old.issued_at is null) then
    perform public.wo_seed_checklists(new.id);
  end if;
  return null;
end $$;

drop trigger if exists wo_orders_seed_checklists on public.work_orders;
create trigger wo_orders_seed_checklists
  after insert or update of issued_at on public.work_orders
  for each row execute function public.wo_seed_checklists_on_issue();

-- ---- 2. seeded when a painter is assigned -----------------------------------
-- An employee is ASSIGNED, never offered: this is the employee job's own door
-- into the seeder, and it does not care which stage the job is at or whether
-- this is the first painter or the third.
create or replace function public.wo_seed_checklists_on_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.wo_seed_checklists(new.work_order_id);
  return null;
end $$;

drop trigger if exists wo_assignments_seed_checklists on public.wo_assignments;
create trigger wo_assignments_seed_checklists
  after insert on public.wo_assignments
  for each row execute function public.wo_seed_checklists_on_assignment();

-- ---- 3. the gate stops reading "no list" as "nothing left to tick" ----------
-- The live 20261110 definition with ONE block added at the top of the
-- pre_start → in_progress arm; every other arm is byte-for-byte what is
-- running now (pg_get_functiondef on the test project).
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer; v_txt text;
begin
  if p_from = 'pre_start' and p_to = 'in_progress' then
    -- NEW (18 Sep): no list at all is not a finished list. A job that never
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

  if p_to <> 'in_progress' and p_to <> 'offered' then
    select count(*) into v_waiting
      from public.wo_variations
     where work_order_id = p_wo_id and status in ('raised', 'priced', 'customer_approved');
    if v_waiting > 0 then
      return v_waiting::text || ' variation' || case when v_waiting = 1 then '' else 's' end
             || ' still waiting on a decision';
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

  -- Nobody walks around the quality check — not to the pack, not to closed.
  -- A failed check is open until its re-check exists (20270112).
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
    -- NEW (Tom, 23 Aug): colour-match codes before the hand-over.
    v_txt := public.wo_colour_match_outstanding(p_wo_id);
    if v_txt <> '' then
      return 'colour match codes still needed for ' || v_txt;
    end if;
  end if;

  -- The walkthrough → closed sign path keeps its own QA guard (was p_to = 'walkthrough' only).
  if p_to = 'walkthrough' and p_from = 'closed' then
    v_open := public.wo_qa_open_count(p_wo_id);
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  return null;
end $$;

-- ---- 4. the jobs that are already short of a list ---------------------------
-- Only the two stages where the list is meant to be on screen. A job already
-- in progress has passed the gate that reads it; giving it an untouched list
-- now would be noise, not a fix.
do $$
declare v_id uuid; v_made integer := 0;
begin
  for v_id in
    select w.id from public.work_orders w
     where w.stage in ('offered', 'pre_start')
       and not exists (select 1 from public.wo_checklist_items i where i.work_order_id = w.id)
  loop
    perform public.wo_seed_checklists(v_id);
    v_made := v_made + 1;
  end loop;
  raise notice 'pre-start lists built for % job(s)', v_made;
end $$;

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from pg_trigger
    where tgname in ('wo_orders_seed_checklists', 'wo_assignments_seed_checklists')) as new_triggers,
  (select count(*) from pg_trigger where tgname = 'wo_events_seed_checklists') as stage_trigger_still_there,
  (select prosrc like '%has not been built for this job yet%'
     from pg_proc where proname = 'wo_gate_blocked' limit 1) as gate_refuses_a_missing_list,
  (select count(*) from public.work_orders w
    where w.stage in ('offered', 'pre_start')
      and not exists (select 1 from public.wo_checklist_items i
                       where i.work_order_id = w.id and i.phase = 'pre_start')) as jobs_still_without_a_list;

insert into public._prod_migrations(name) values ('20270173000000_pre_start_list_always_exists.sql') on conflict (name) do nothing;

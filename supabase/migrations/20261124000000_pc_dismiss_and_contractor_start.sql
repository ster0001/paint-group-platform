-- ============================================================================
-- PC batch (Tom, 25 Aug 2026): two rulings.
--
-- 1. Attention cards can be CLOSED OFF once actioned — a staff dismissal is
--    an event (`card_dismissed`), and the console skips a dismissed key. The
--    doctrine stands: cards still derive from data; a dismissal is itself
--    data, written by the person who dealt with it.
-- 2. The CONTRACTOR may start the job — pre_start → in_progress, through the
--    same gate the office and the sweep use (every required pre-start item
--    ticked). The transition table is re-seeded canonically with 'contractor'
--    added to that one edge; lib/workorder/stages.ts mirrors THIS file.
--
-- Idempotent; safe to re-run. Ends with read-backs (house law).
-- ============================================================================

-- ---- 1. the canonical transition table (one change: contractor may start) --

insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',       array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff','contractor']),
  ('in_progress',     'completion_prep', 'all surfaces done — prep begins',     array['system','staff','contractor']),
  ('completion_prep', 'qa',              'prep confirmed — quality check due',  array['system','staff','contractor']),
  ('completion_prep', 'walkthrough',     'prep confirmed — evidence pack delivered', array['system','staff','contractor']),
  ('completion_prep', 'closed',          'prep confirmed — no walkthrough required', array['system','staff','contractor']),
  ('qa',              'walkthrough',     'quality check passed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'closed',          'quality check passed — no walkthrough required', array['system','staff','contractor']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer']),
  ('closed',          'walkthrough',     'reopened after sign-off',             array['staff'])
on conflict (from_stage, to_stage) do update
  set label = excluded.label, actors = excluded.actors;

-- ---- 2. the contractor's start button --------------------------------------
-- Mirrors wo_start_now (started-early date move included) but gated to the
-- job's OWN contractor instead of staff. The gate is the same one everywhere:
-- wo_gate_blocked refuses while required pre-start items are unticked.

create or replace function public.wo_contractor_start(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_today date; v_gate text; v_me uuid;
begin
  v_me := public.current_contractor_id();
  if v_me is null then return 'error:not_a_contractor'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is distinct from v_me then return 'error:not_yours'; end if;
  if v_wo.stage <> 'pre_start' then return 'error:not_pre_start'; end if;

  v_gate := public.wo_gate_blocked(p_work_order_id, 'pre_start', 'in_progress');
  if v_gate is not null then return 'error:gate:' || v_gate; end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  if v_wo.start_date is null or v_wo.start_date > v_today then
    update public.work_orders set start_date = v_today where id = p_work_order_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'start_date_moved', auth.uid(), 'contractor',
              jsonb_build_object('from', v_wo.start_date, 'to', v_today, 'why', 'contractor started'));
  end if;

  return public.wo_set_stage(p_work_order_id, 'in_progress', 'contractor',
                             jsonb_build_object('via', 'contractor_start'));
end $$;
grant execute on function public.wo_contractor_start(uuid) to authenticated;

-- ---- 3. closing off an attention card --------------------------------------
-- One event per (job, card key). The console loader collects them and the
-- queue builder drops matching keys. Dismissing is per-card and permanent —
-- the same condition never nags twice once a person has said "dealt with".

create or replace function public.wo_dismiss_card(p_work_order_id uuid, p_key text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_key), '') = '' or length(p_key) > 120 then return 'error:bad_key'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'card_dismissed', auth.uid(), 'staff',
            jsonb_build_object('key', p_key));
  return 'ok:' || p_work_order_id;
end $$;
grant execute on function public.wo_dismiss_card(uuid, text) to authenticated;

-- ---- read-backs -------------------------------------------------------------

-- Expect: contractor present on exactly the pre_start → in_progress row
select from_stage, to_stage, actors from public.wo_stage_transitions
 where 'contractor' = any (actors) and from_stage = 'pre_start';

-- Expect: 2 functions, both security definer
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_contractor_start', 'wo_dismiss_card')
 order by p.proname;

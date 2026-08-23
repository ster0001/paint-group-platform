-- =============================================================================
-- Tom, 23 Aug: a closed job can be moved BACK to the sign-off stage by staff —
-- something picked up within a few days of signing. The customer signs again
-- (their link is still theirs); warranty keeps its original start; the $0
-- draft invoice stub the first signing wrote is removed so the re-sign does
-- not leave two.
--
-- The matrix gains closed → walkthrough (staff). Full reseed — canonical here
-- now; lib/workorder/stages.ts mirrors THIS file and its drift test reads it.
-- =============================================================================

delete from public.wo_stage_transitions;
insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('offered',         'pre_start',       'contractor accepted the offer',       array['system','staff']),
  ('pre_start',       'offered',         'booking released — back to the tray', array['system','staff']),
  ('pre_start',       'in_progress',     'pre-start checklist complete',        array['system','staff']),
  ('in_progress',     'completion_prep', 'all surfaces done — prep begins',     array['system','staff','contractor']),
  ('completion_prep', 'qa',              'prep confirmed — quality check due',  array['system','staff','contractor']),
  ('completion_prep', 'walkthrough',     'prep confirmed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'walkthrough',     'quality check passed — evidence pack delivered', array['system','staff','contractor']),
  ('qa',              'in_progress',     'QA failed — rectification raised',    array['staff']),
  ('walkthrough',     'closed',          'signed off',                          array['system','staff','customer']),
  ('walkthrough',     'in_progress',     'area flagged — rectification raised', array['staff','customer']),
  ('closed',          'walkthrough',     'reopened after sign-off',             array['staff']);

create or replace function public.wo_reopen_signoff(p_work_order_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_s public.wo_signoff%rowtype; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'closed' then return 'error:not_closed'; end if;

  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found then return 'error:no_signoff_row'; end if;

  -- Back to the sign-off stage first: the gate (variations waiting) still applies.
  v_r := public.wo_set_stage(p_work_order_id, 'walkthrough', 'staff',
           jsonb_build_object('via', 'reopen_signoff', 'reason', coalesce(p_reason, '')));
  if v_r not like 'ok:%' then return v_r; end if;

  -- Unsign: the customer's link can sign again; the old report stays until the
  -- re-sign overwrites it. Every area is re-asked — approvals are cleared so the
  -- customer looks again at what was found.
  update public.wo_signoff
     set signed_at = null, signed_name = null, signed_kind = null, signed_device = '',
         captured_on = null, walkthrough_session_token = null, walkthrough_session_expires_at = null,
         areas = '{}'::jsonb
   where work_order_id = p_work_order_id;

  -- The first signing's $0 draft stub — a re-sign writes a fresh one.
  delete from public.invoices
   where estimate_id = v_wo.estimate_id and status = 'draft' and amount_cents = 0;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'signoff_reopened', auth.uid(), 'staff',
            jsonb_build_object('reason', coalesce(p_reason, ''),
                               'was_signed_at', v_s.signed_at, 'was_signed_by', v_s.signed_name));
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_reopen_signoff(uuid, text) to authenticated;

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from public.wo_stage_transitions) as transitions,
  (select actors from public.wo_stage_transitions where from_stage = 'closed' and to_stage = 'walkthrough') as reopen_actors,
  (select count(*) from pg_proc where proname = 'wo_reopen_signoff') as reopen_fn;

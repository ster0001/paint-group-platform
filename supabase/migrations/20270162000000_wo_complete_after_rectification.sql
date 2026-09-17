-- Flagged areas put right → the job completes (Tom, 17 Sep 2026)
--
-- "During the walkthrough, if something gets flagged and then the painter
--  completes it, it goes back to the walkthrough bar which does nothing.
--  Once any flagged areas are fixed, mark it so the flagged areas are sent
--  to the customer along with the completion report and the job is deemed
--  finished."
--
-- Before this, a flag sent the job back to In progress and the painter's
-- finish re-ran the whole tail: a fresh quality check where one is due, a
-- second evidence pack, a second walkthrough for the customer to approve
-- the same areas again. The customer had already looked at everything and
-- named what was wrong; once that is fixed there is nothing left to walk.
--
-- One function does the tail in a single transaction, through the state
-- machine (never a direct status write):
--   in_progress → completion_prep → walkthrough → closed
-- with every gate the normal path applies (surfaces, variations, the
-- finishing-up list, open quality checks, colour codes). The sign-off row
-- is completed as a new kind, 'rectified': signed by nobody, dated now, the
-- flagged areas carry `rectified_at` beside their `flagged_at` and note, and
-- the frozen report gains a `rectified` list — what was flagged, what was
-- said, when it was put right — so the completion report the customer
-- receives says so in as many words. Warranty, review follow-up, the final
-- invoice draft and the contractor's draft fire exactly as a signature does.

alter type public.wo_signoff_kind add value if not exists 'rectified';

create or replace function public.wo_complete_after_rectification(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_s public.wo_signoff%rowtype; v_cid uuid; v_kind text;
        v_r text; v_gate text; v_start date; v_report jsonb; v_areas jsonb; v_rectified jsonb;
        v_open integer; v_flagged integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;

  if v_wo.stage is distinct from 'in_progress' then return 'error:not_in_progress'; end if;

  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found or v_s.evidence_pack_sent_at is null then return 'error:no_walkthrough_yet'; end if;
  if v_s.signed_at is not null then return 'error:already_signed'; end if;

  -- The flagged areas still open: flagged, never put right, never approved since.
  select count(*) into v_flagged
    from jsonb_each(coalesce(v_s.areas, '{}'::jsonb)) a
   where (a.value ? 'flagged_at') and not (a.value ? 'rectified_at');
  if v_flagged = 0 then return 'error:nothing_flagged'; end if;

  -- Every rectification row the flags raised must be done, and so must the
  -- rest of the job — the same words the finish uses.
  select count(*) into v_open from public.wo_surfaces
   where work_order_id = p_work_order_id and rectification and not removed_from_scope
     and state is distinct from 'done';
  if v_open > 0 then
    return 'error:gate:' || v_open::text || ' flagged area' || case when v_open = 1 then '' else 's' end
           || ' still to put right and tick';
  end if;
  v_gate := public.wo_gate_blocked(p_work_order_id, 'in_progress', 'completion_prep');
  if v_gate is not null then return 'error:gate:' || v_gate; end if;
  v_gate := public.wo_gate_blocked(p_work_order_id, 'completion_prep', 'walkthrough');
  if v_gate is not null then return 'error:gate:' || v_gate; end if;

  -- Through the machine, never around it.
  v_r := public.wo_set_stage(p_work_order_id, 'completion_prep', v_kind,
           jsonb_build_object('via', 'rectified'));
  if v_r not like 'ok:%' then return v_r; end if;
  v_r := public.wo_set_stage(p_work_order_id, 'walkthrough', 'system',
           jsonb_build_object('via', 'rectified'));
  if v_r not like 'ok:%' then return v_r; end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  -- Stamp the flagged areas as put right, keeping what was flagged and said.
  select coalesce(jsonb_object_agg(a.key,
           case when (a.value ? 'flagged_at') and not (a.value ? 'rectified_at')
                then a.value || jsonb_build_object('rectified_at', now())
                else a.value end), '{}'::jsonb)
    into v_areas
    from jsonb_each(coalesce(v_s.areas, '{}'::jsonb)) a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'area', a.key,
           'note', coalesce(a.value->>'note', ''),
           'flagged_at', a.value->>'flagged_at',
           'rectified_at', now(),
           'fixes', (select coalesce(jsonb_agg(s.label order by s.sort), '[]'::jsonb)
                       from public.wo_surfaces s
                      where s.work_order_id = p_work_order_id and s.rectification
                        and s.heading = a.key and not s.removed_from_scope)
         ) order by a.key), '[]'::jsonb)
    into v_rectified
    from jsonb_each(coalesce(v_s.areas, '{}'::jsonb)) a
   where (a.value ? 'flagged_at') and not (a.value ? 'rectified_at');

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', 'Flagged areas put right', 'signed_kind', 'rectified',
    'captured_on', null,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = p_work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = p_work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents, 'credit', credit,
                     'signed_name', signed_name, 'signed_at', signed_at)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = p_work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = p_work_order_id),
    'areas', v_areas,
    'rectified', v_rectified
  ) into v_report;

  update public.wo_signoff
     set areas = v_areas,
         signed_at = now(), signed_name = 'Flagged areas put right',
         signed_kind = 'rectified', signed_device = '', captured_on = null,
         walkthrough_session_token = null, walkthrough_session_expires_at = null,
         report = v_report
   where work_order_id = p_work_order_id;

  update public.wo_walkthroughs set status = 'done'
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked';

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (p_work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => 2))::date, 2, 'rectified')
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  perform public.invoice_draft_final(v_wo.estimate_id);
  perform public.contractor_invoice_draft(p_work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'completed_after_rectification', auth.uid(), v_kind,
            jsonb_build_object('areas', v_rectified, 'warranty_starts', v_start));

  v_r := public.wo_set_stage(p_work_order_id, 'closed', 'system',
           jsonb_build_object('signed_kind', 'rectified', 'via', 'rectified'));
  if v_r not like 'ok:%' then return v_r; end if;

  return 'ok:closed';
end $$;
grant execute on function public.wo_complete_after_rectification(uuid) to authenticated, service_role;

-- Read-back: the kind exists, the function exists and is security definer,
-- and the walkthrough→in_progress flag transition is untouched.
select
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
           where t.typname = 'wo_signoff_kind' and e.enumlabel = 'rectified') as kind_ok,
  (select prosecdef from pg_proc where proname = 'wo_complete_after_rectification') as fn_secdef,
  exists (select 1 from public.wo_stage_transitions
           where from_stage = 'walkthrough' and to_stage = 'in_progress') as flag_transition_ok;

insert into public._prod_migrations(name) values ('20270162000000_wo_complete_after_rectification.sql') on conflict (name) do nothing;

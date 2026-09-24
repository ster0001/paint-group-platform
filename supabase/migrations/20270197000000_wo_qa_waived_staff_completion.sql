-- =============================================================================
-- Quality-check overrides and the staff sign-off (Tom, 24 Sep 2026):
--
--   2. "When a job goes to quality check, only staff need to sign the job off
--      as completed." A job the office has quality checked does not wait on
--      the customer's signature: once every check has passed the job sits at
--      05 Walkthrough for the OFFICE to sign off (wo_staff_complete). The
--      customer is not chased for a signature (the nudge ladder skips these
--      jobs) — they receive the signed completion report as on any sign-off.
--   3. "Walkthrough not required" after the job is approved, from the job
--      page, at any open stage — including once the job is already AT the
--      walkthrough stage, which used to strand it (wo_close_without_walkthrough
--      refused 'walkthrough'). Now the office presses "Close the job — no
--      walkthrough required" there too; a booked final is cancelled.
--   4. "Quality check not required" on ONE job — the office's override for a
--      new contractor's cadence (work_orders.qa_waived). Waiving deletes the
--      job's unlogged checks and, if the job is parked at 04 Quality check,
--      routes it on the way a pass would. Flagging a check required again
--      clears the waiver; adding a mid-job check clears it too.
--
-- Bodies are the newest live ones (20270171 wo_schedule_qa, 20261105
-- wo_set_qa_required / wo_add_qa_check, 20261119 wo_close_without_walkthrough,
-- 20261006 wo_signoff_sweep) with only the lines marked NEW added.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

-- ---- 4a. the waiver ----------------------------------------------------------------
alter table public.work_orders add column if not exists qa_waived boolean not null default false;

-- ---- 4b. scheduling honours it (20270171 body + the NEW guard) -----------------------
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_mode text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;

  -- NEW: the office said no check on this job. Wins over the cadence, the
  -- contractor's mode and the job flag alike — a deliberate act on THIS job.
  if coalesce(v_wo.qa_waived, false) then return 'ok:0'; end if;

  select coalesce(qa_mode, 'first_jobs') into v_mode from public.contractors where id = v_wo.contractor_id;

  if v_mode = 'none' and not coalesce(v_wo.qa_required, false) then
    return 'ok:0';
  end if;

  if not (public.wo_contractor_is_new(v_wo.contractor_id) or v_mode = 'every_job'
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

-- ---- 4c. the office waives (or un-waives) the check on one job ----------------------
create or replace function public.wo_set_qa_waived(p_work_order_id uuid, p_waived boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_deleted integer := 0; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;

  if p_waived then
    update public.work_orders set qa_waived = true, qa_required = false where id = p_work_order_id;

    -- Unlogged checks go: a due check nobody will log would hold the gate for
    -- ever. Logged ones (pass or fail) are a record and stay.
    with gone as (
      delete from public.wo_qa_checks
       where work_order_id = p_work_order_id and result is null
      returning id
    )
    select count(*) into v_deleted from gone;

    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'qa_waived', auth.uid(), 'staff',
              jsonb_build_object('checks_removed', v_deleted));

    -- Parked at the check stage with nothing left to log: move on the way a
    -- pass would — the pack to the customer, or straight to closed.
    if v_wo.stage = 'qa' and public.wo_qa_open_count(p_work_order_id) = 0 then
      if not coalesce(v_wo.walkthrough_required, true) then
        v_r := public.wo_close_without_walkthrough(p_work_order_id);
        if v_r not like 'ok:%' then return 'ok:waived:' || v_r; end if;
        return 'ok:waived:closed';
      end if;
      v_r := public.wo_deliver_evidence_pack(p_work_order_id);
      if v_r not like 'ok:%' then return 'ok:waived:' || v_r; end if;
      perform public.wo_generate_report_draft(p_work_order_id);
      return 'ok:waived:walkthrough';
    end if;
    return 'ok:waived';
  end if;

  update public.work_orders set qa_waived = false where id = p_work_order_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_waiver_cleared', auth.uid(), 'staff', '{}'::jsonb);
  -- Back on the cadence: schedule straight away if one is due.
  perform public.wo_schedule_qa(p_work_order_id);
  return 'ok:required';
end $$;
grant execute on function public.wo_set_qa_waived(uuid, boolean) to authenticated;

-- "Required" and "waived" are one decision: flagging a check on clears the
-- waiver (20261105 body + the NEW clause).
create or replace function public.wo_set_qa_required(p_work_order_id uuid, p_required boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.work_orders
     set qa_required = p_required,
         qa_waived = case when p_required then false else qa_waived end   -- NEW
   where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if p_required then perform public.wo_schedule_qa(p_work_order_id); end if;
  return 'ok:' || p_required::text;
end $$;
grant execute on function public.wo_set_qa_required(uuid, boolean) to authenticated;

-- A mid-job check added by hand is the office asking for a check: the waiver
-- goes (20261105 body + the NEW line).
create or replace function public.wo_add_qa_check(p_work_order_id uuid, p_date date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage in ('closed') then return 'error:closed'; end if;

  update public.work_orders set qa_waived = false where id = p_work_order_id and qa_waived;  -- NEW

  insert into public.wo_qa_checks (work_order_id, kind, scheduled_for)
    values (p_work_order_id, 'mid', p_date) returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_check_added', auth.uid(), 'staff',
            jsonb_build_object('check_id', v_id, 'kind', 'mid', 'date', p_date));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_add_qa_check(uuid, date) to authenticated;

-- ---- 2a. which jobs the office signs off -----------------------------------------------
-- A job "went to quality check" when a check on it was logged as a pass. Derived
-- from the checks, never stored: a waived job has none and stays on the
-- customer's signature.
create or replace function public.wo_staff_signs_off(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.wo_qa_checks c
                  where c.work_order_id = p_work_order_id and c.result = 'pass');
$$;
grant execute on function public.wo_staff_signs_off(uuid) to authenticated, service_role;

-- ---- 2b. the office signs a quality-checked job off as complete ------------------------
-- Rides wo_staff_sign (20261105): every area approved on the office's behalf,
-- the on-device sign path, report frozen, warranty started, invoice drafted,
-- stage closed. The name on the record is the staff member's own.
create or replace function public.wo_staff_complete(p_work_order_id uuid, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_name text; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;
  if not public.wo_staff_signs_off(p_work_order_id) then return 'error:not_quality_checked'; end if;
  if public.wo_qa_open_count(p_work_order_id) > 0 then return 'error:qa_open'; end if;

  select coalesce(nullif(trim(name), ''), 'Paint Group') into v_name
    from public.profiles where id = auth.uid();
  v_name := coalesce(v_name, 'Paint Group');

  v_r := public.wo_staff_sign(p_work_order_id, v_name,
           coalesce(nullif(trim(p_note), ''), 'Signed off by the office after the quality check passed'));
  if v_r not in ('ok:signed', 'ok:already') then return v_r; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'completed_by_staff_after_qa', auth.uid(), 'staff',
            jsonb_build_object('name', v_name, 'note', coalesce(p_note, '')));
  return 'ok:completed';
end $$;
grant execute on function public.wo_staff_complete(uuid, text) to authenticated;

-- ---- 2c. no customer chase on a job the office signs off (20261006 body + NEW) -----------
create or replace function public.wo_signoff_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row record; v_nudged integer := 0; v_deemed integer := 0;
        v_clock boolean; v_deemed_on boolean; v_hours integer; v_rung integer; v_elapsed numeric;
begin
  if not (public.is_staff() or public.wo_is_system()) then return '{"error":"not_staff"}'::jsonb; end if;

  v_clock     := coalesce(public.wo_loop_setting(array['signoff','clockEnabled']) = 'true'::jsonb, false);
  v_deemed_on := coalesce(public.wo_loop_setting(array['signoff','deemedEnabled']) = 'true'::jsonb, false);
  v_hours     := coalesce((public.wo_loop_setting(array['signoff','residentialHours']))::text::integer, 72);
  if not v_clock then return jsonb_build_object('nudged', 0, 'deemed', 0, 'clock', false); end if;

  for v_row in
    select s.* from public.wo_signoff s
      join public.work_orders w on w.id = s.work_order_id
     where s.signed_at is null
       and s.evidence_pack_sent_at is not null
       and w.stage = 'walkthrough'
       and (s.extension_requested_at is null or s.extension_approved_at is not null)
       -- NEW: a quality-checked job is the office's to sign; the customer is
       -- not asked for a signature and not nudged for one.
       and not public.wo_staff_signs_off(w.id)
  loop
    v_elapsed := extract(epoch from (now() - v_row.evidence_pack_sent_at)) / 3600.0;

    for v_rung in select x from unnest(array[0, 24, 48]) x loop
      if v_elapsed >= v_rung and (v_row.nudges ->> v_rung::text) is null then
        update public.wo_signoff
           set nudges = nudges || jsonb_build_object(v_rung::text, now())
         where work_order_id = v_row.work_order_id;

        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_row.work_order_id, 'signoff_nudge', 'system',
                  jsonb_build_object('rung', v_rung, 'deemed_enabled', v_deemed_on,
                                     'copy', public.wo_nudge_copy(v_rung, v_deemed_on),
                                     'late', v_elapsed > v_rung + 1));
        v_nudged := v_nudged + 1;
      end if;
    end loop;

    if v_deemed_on and v_row.deadline_at is not null and now() >= v_row.deadline_at then
      perform public.wo_sign(v_row.customer_token, 'Deemed — no response', 'deemed', 'system sweep');
      v_deemed := v_deemed + 1;
    end if;
  end loop;

  return jsonb_build_object('nudged', v_nudged, 'deemed', v_deemed, 'clock', true,
                            'deemed_enabled', v_deemed_on);
end $$;
grant execute on function public.wo_signoff_sweep() to authenticated, service_role;

-- ---- 3. "walkthrough not required" once the job is already at the walkthrough -------------
-- 20261119 body; NEW: 'walkthrough' is an allowed starting stage while unsigned,
-- and any booked walkthrough is cancelled with the close.
create or replace function public.wo_close_without_walkthrough(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_r text; v_start date; v_report jsonb;
        v_signed timestamptz;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if coalesce(v_wo.walkthrough_required, true) then return 'error:walkthrough_required'; end if;
  if v_wo.stage not in ('completion_prep', 'qa', 'walkthrough') then return 'error:not_ready'; end if;   -- NEW
  if v_wo.stage = 'walkthrough' then                                                                       -- NEW
    select signed_at into v_signed from public.wo_signoff where work_order_id = p_work_order_id;
    if v_signed is not null then return 'error:already_signed'; end if;
    -- The quality check still gates the close from here, as it gates the pack.
    if public.wo_qa_open_count(p_work_order_id) > 0 then return 'error:gate:quality check still open'; end if;
    update public.wo_walkthroughs set status = 'cancelled'
     where work_order_id = p_work_order_id and status = 'booked';
  end if;

  v_r := public.wo_set_stage(p_work_order_id, 'closed', v_kind,
           jsonb_build_object('via', 'no_walkthrough'));
  if v_r not like 'ok:%' then return v_r; end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', 'No walkthrough required', 'signed_kind', 'no_walkthrough',
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
    'areas', '{}'::jsonb
  ) into v_report;

  insert into public.wo_signoff (work_order_id, signed_at, signed_name, signed_kind, report)
    values (p_work_order_id, now(), 'No walkthrough required', 'no_walkthrough', v_report)
  on conflict (work_order_id) do update
    set signed_at = coalesce(public.wo_signoff.signed_at, now()),
        signed_name = coalesce(public.wo_signoff.signed_name, 'No walkthrough required'),
        signed_kind = coalesce(public.wo_signoff.signed_kind, 'no_walkthrough'),
        report = coalesce(public.wo_signoff.report, excluded.report);

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (p_work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => 2))::date, 2, 'no_walkthrough')
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  perform public.invoice_draft_final(v_wo.estimate_id);
  perform public.contractor_invoice_draft(p_work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'closed_without_walkthrough', auth.uid(), v_kind,
            jsonb_build_object('warranty_starts', v_start, 'from_stage', v_wo.stage::text));
  return 'ok:closed';
end $$;
grant execute on function public.wo_close_without_walkthrough(uuid) to authenticated, service_role;

-- ---- read-back: ONE row, every column equals its _expect_ ----------------------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'work_orders' and column_name = 'qa_waived') as waived_col, true as _expect_waived_col,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wo_set_qa_waived', 'wo_staff_signs_off', 'wo_staff_complete')) as new_fns, 3 as _expect_new_fns,
  (select prosrc like '%qa_waived%' from pg_proc where proname = 'wo_schedule_qa' limit 1) as schedule_honours_waiver, true as _expect_schedule_honours_waiver,
  (select prosrc like '%wo_staff_signs_off%' from pg_proc where proname = 'wo_signoff_sweep' limit 1) as sweep_skips_staff_jobs, true as _expect_sweep_skips_staff_jobs,
  (select prosrc like '%''walkthrough'')%' from pg_proc where proname = 'wo_close_without_walkthrough' limit 1) as close_from_walkthrough, true as _expect_close_from_walkthrough,
  (select has_function_privilege('authenticated', 'public.wo_staff_complete(uuid, text)', 'execute')) as complete_granted, true as _expect_complete_granted;

insert into public._prod_migrations(name) values ('20270197000000_wo_qa_waived_staff_completion.sql') on conflict (name) do nothing;

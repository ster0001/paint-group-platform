-- Painter status, Step 7 (brief §10 Step 7; rulings R11, R12, R14–R17; ⚑7, ⚑8,
-- ⚑9, ⚑13, ⚑14, ⚑23; §6 rules 2, 5, 6): what the colour CHANGES.
--
--   1. Red block (⚑8): no new offer to a Red painter, and no Red employee set
--      as lead, until the owner records "Spoken with, offers allowed" with a
--      reason. The clearance sits on painter_status and the evaluator's writer
--      clears it the moment the colour changes. Enforced in send_offer, in the
--      booking_offers trigger (the last line of defence) and in assign_job /
--      set_lead_painter.
--   2. Payment terms (⚑14, ⚑23, §6 rule 6): at sign-off a Green contractor's
--      invoice is due 3 business days later (Mon–Fri, Victorian public holidays
--      from Settings → visit_booking_rules.publicHolidays); anyone else keeps
--      the default terms. The PC's hold puts that one invoice back on the
--      default date — never later — with a reason and an event; release puts
--      the fast date back.
--   3. Bonus (⚑9, ⚑13; Tom 8 Oct 2026 on how it is paid): "Tell Tom" hands a
--      due review to the owner; the owner sets the amount and approves or
--      declines — approve refuses while painter_status_rules.bonusApprovalsEnabled
--      is false (ships OFF until ⚑10 / ⚑11 are answered). A contractor is told
--      the amount and CLAIMS it; the claim raises a contractor invoice for the
--      bonus through the normal channel. An employed lead is told the amount and
--      it goes on the payroll CSV — the platform never pays an employee.
-- Every write is a definer RPC; nothing here touches lib/pricing. Converges.
set lock_timeout = '15s';

-- ---- 1. Red clearance -----------------------------------------------------------
alter table public.painter_status
  add column if not exists offers_cleared_at     timestamptz,
  add column if not exists offers_cleared_by     uuid references auth.users (id) on delete set null,
  add column if not exists offers_cleared_reason text not null default '';

-- Is this painter blocked from new offers / new lead roles right now?
create or replace function public.painter_offers_blocked(p_painter_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select colour = 'red' and offers_cleared_at is null from public.painter_status where painter_id = p_painter_id), false);
$$;
revoke all on function public.painter_offers_blocked(uuid) from public, anon;
grant execute on function public.painter_offers_blocked(uuid) to authenticated;

-- The owner's clearance (⚑8). Lasts until the colour next changes (the writer resets it).
create or replace function public.painter_clear_red(p_painter_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_colour text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not public.has_dashboard_role('owner') then return 'error:not_owner'; end if;
  if length(coalesce(trim(p_reason), '')) < 3 then return 'error:no_reason'; end if;
  select colour into v_colour from public.painter_status where painter_id = p_painter_id for update;
  if v_colour is null then return 'error:no_status'; end if;
  if v_colour <> 'red' then return 'error:not_red'; end if;
  update public.painter_status
     set offers_cleared_at = now(), offers_cleared_by = auth.uid(), offers_cleared_reason = trim(p_reason)
   where painter_id = p_painter_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (p_painter_id, 'red_clearance_given', jsonb_build_object('reason', trim(p_reason)), auth.uid());
  return 'ok:cleared';
end $$;
revoke all on function public.painter_clear_red(uuid, text) from public, anon;
grant execute on function public.painter_clear_red(uuid, text) to authenticated;

-- The writer (20270228 body) + ONE change: a colour change resets the clearance.
create or replace function public.painter_status_write(
  p_painter_id uuid, p_results jsonb, p_status jsonb, p_bonus_reviews jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_old record; v_wo uuid; v_result text; v_changed integer := 0; v_removed integer := 0;
  v_prev text; v_colour text; v_bonus integer := 0; v_review jsonb; v_trigger uuid; v_default integer;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then return 'error:not_staff'; end if;
  if not exists (select 1 from public.contractors where id = p_painter_id) then return 'error:not_found'; end if;
  v_default := coalesce((select (value->>'bonusDefaultCents')::integer from public.settings where key = 'painter_status_rules'), 50000);

  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_wo := (r->>'work_order_id')::uuid; v_result := r->>'result';
    select * into v_old from public.painter_job_results where work_order_id = v_wo;
    if not found or v_old.painter_id <> p_painter_id or v_old.result <> v_result
       or v_old.checks_done <> (r->>'checks_done')::integer or v_old.checks_passed <> (r->>'checks_passed')::integer
       or v_old.moments_scored <> (r->>'moments_scored')::integer or v_old.moments_answered <> (r->>'moments_answered')::integer
       or v_old.callbacks_scored <> (r->>'callbacks_scored')::integer or v_old.credits_applied <> (r->>'credits_applied')::integer
       or v_old.counts_for_bonus <> (r->>'counts_for_bonus')::boolean or v_old.signed_on <> (r->>'signed_on')::date then
      insert into public.painter_job_results
        (painter_id, work_order_id, result, reasons, hours, counts_for_bonus, signed_on, checks_done, checks_passed,
         moments_scored, moments_answered, callbacks_scored, credits_applied, finalised_at, computed_at)
      values
        (p_painter_id, v_wo, v_result, coalesce(r->'reasons', '[]'::jsonb), coalesce((r->>'hours')::numeric, 0),
         coalesce((r->>'counts_for_bonus')::boolean, false), (r->>'signed_on')::date,
         (r->>'checks_done')::integer, (r->>'checks_passed')::integer, (r->>'moments_scored')::integer,
         (r->>'moments_answered')::integer, (r->>'callbacks_scored')::integer, (r->>'credits_applied')::integer,
         case when v_result = 'pending' then null else now() end, now())
      on conflict (work_order_id) do update
        set painter_id = excluded.painter_id, result = excluded.result, reasons = excluded.reasons, hours = excluded.hours,
            counts_for_bonus = excluded.counts_for_bonus, signed_on = excluded.signed_on,
            checks_done = excluded.checks_done, checks_passed = excluded.checks_passed, moments_scored = excluded.moments_scored,
            moments_answered = excluded.moments_answered, callbacks_scored = excluded.callbacks_scored, credits_applied = excluded.credits_applied,
            finalised_at = case when excluded.result = 'pending' then null else coalesce(public.painter_job_results.finalised_at, now()) end,
            computed_at = now();
      insert into public.contractor_events (contractor_id, type, detail, actor)
      values (p_painter_id, 'job_result_set', r || jsonb_build_object('previous', case when found then v_old.result else null end), auth.uid());
      v_changed := v_changed + 1;
      if found and v_old.result <> v_result then
        update public.painter_bonuses set qualifying_changed_at = now()
         where painter_id = p_painter_id and status in ('due', 'with_owner') and qualifying_wo_ids ? v_wo::text and qualifying_changed_at is null;
      end if;
    end if;
  end loop;
  delete from public.painter_job_results
   where painter_id = p_painter_id
     and work_order_id not in (select (x->>'work_order_id')::uuid from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x);
  get diagnostics v_removed = row_count;

  v_colour := p_status->>'colour';
  select colour into v_prev from public.painter_status where painter_id = p_painter_id;
  insert into public.painter_status (painter_id, colour, streak, best_streak, measures, bonus_counter, line, computed_at)
  values (p_painter_id, v_colour, coalesce((p_status->>'streak')::integer, 0), coalesce((p_status->>'best_streak')::integer, 0),
          coalesce(p_status->'measures', '{}'::jsonb), coalesce((p_status->>'bonus_counter')::integer, 0), coalesce(p_status->>'line', ''), now())
  on conflict (painter_id) do update
    set colour = excluded.colour, streak = excluded.streak, best_streak = excluded.best_streak, measures = excluded.measures,
        bonus_counter = excluded.bonus_counter, line = excluded.line, computed_at = now(),
        -- ⚑8: a clearance lasts until the colour next changes.
        offers_cleared_at     = case when excluded.colour <> public.painter_status.colour then null else public.painter_status.offers_cleared_at end,
        offers_cleared_by     = case when excluded.colour <> public.painter_status.colour then null else public.painter_status.offers_cleared_by end,
        offers_cleared_reason = case when excluded.colour <> public.painter_status.colour then '' else public.painter_status.offers_cleared_reason end;
  if v_prev is distinct from v_colour then
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_painter_id, 'status_changed', jsonb_build_object('from', v_prev, 'to', v_colour), auth.uid());
  end if;

  for v_review in select * from jsonb_array_elements(coalesce(p_bonus_reviews, '[]'::jsonb)) loop
    v_trigger := (v_review->>'trigger_wo_id')::uuid;
    insert into public.painter_bonuses (painter_id, trigger_wo_id, qualifying_wo_ids, suggested_cents)
    values (p_painter_id, v_trigger, coalesce(v_review->'qualifying_wo_ids', '[]'::jsonb),
            coalesce((select amount_cents from public.painter_bonuses where painter_id = p_painter_id and status in ('approved', 'paid') order by decided_at desc limit 1), v_default))
    on conflict (painter_id, trigger_wo_id) do nothing;
    if found then
      v_bonus := v_bonus + 1;
      insert into public.contractor_events (contractor_id, type, detail, actor)
      values (p_painter_id, 'bonus_review_raised', jsonb_build_object('trigger_wo_id', v_trigger, 'qualifying_wo_ids', v_review->'qualifying_wo_ids'), auth.uid());
    end if;
  end loop;

  return 'ok:' || v_changed || ':' || v_removed || ':' || coalesce(v_prev, '-') || '>' || v_colour || ':' || v_bonus;
end $$;
revoke all on function public.painter_status_write(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.painter_status_write(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- send_offer (20270225 body) + the Red block, right after the standards gate.
create or replace function public.send_offer(
  p_work_order_id uuid, p_contractor_id uuid, p_start date, p_end date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype; v_active boolean; v_offerable boolean; v_hours numeric;
  v_offer_id uuid; v_base integer; v_pay integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;
  select active into v_active from public.contractors where id = p_contractor_id;
  if v_active is null then return 'error:contractor_not_found'; end if;
  if not v_active then return 'error:contractor_suspended'; end if;
  perform public.contractor_recompute_offerable(p_contractor_id);
  select offerable into v_offerable from public.contractors where id = p_contractor_id;
  if not coalesce(v_offerable, false) then return 'error:not_offerable'; end if;
  if public.standards_status_of(p_contractor_id) = 'blocked' then return 'error:standards_not_signed'; end if;
  -- R12 / ⚑8: a Red painter gets no new offer until the owner has cleared them.
  if public.painter_offers_blocked(p_contractor_id) then return 'error:red_no_clearance'; end if;
  if exists (select 1 from public.booking_offers where work_order_id = p_work_order_id and state in ('offered', 'proposed')) then
    return 'conflict:already_offered';
  end if;
  select coalesce(sum((s->>'hours')::numeric), 0) into v_hours
    from jsonb_array_elements(coalesce(v_wo.wo_snapshot->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s;
  v_base := public.wo_base_pay_cents(v_wo);
  v_pay := case when v_base is null then null else greatest(0, v_base + public.wo_contractor_variations_cents(v_wo.id)) end;
  insert into public.booking_offers (work_order_id, contractor_id, start_date, end_date, hours_allowance, payment_cents, staff_note, expires_at)
  values (p_work_order_id, p_contractor_id, p_start, p_end, nullif(v_hours, 0), v_pay, coalesce(p_note, ''), now() + interval '24 hours')
  returning id into v_offer_id;
  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id, 'payment_cents', v_pay, 'base_payment_cents', v_base, 'start', p_start),
            auth.uid());
  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

-- The trigger: ANY new offer to a blocked painter is refused, whichever function wrote it.
create or replace function public.booking_offers_standards_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'offered' and public.standards_status_of(new.contractor_id) = 'blocked' then
    raise exception 'standards_not_signed' using hint = 'This painter has not confirmed the finish standards and their grace period has ended.';
  end if;
  if new.state = 'offered' and public.painter_offers_blocked(new.contractor_id) then
    raise exception 'red_no_clearance' using hint = 'This painter is on Red. The owner records "Spoken with, offers allowed" before any new offer.';
  end if;
  return new;
end $$;
drop trigger if exists t_booking_offers_standards_gate on public.booking_offers;
create trigger t_booking_offers_standards_gate before insert on public.booking_offers for each row execute function public.booking_offers_standards_gate();

-- A Red employee is not set as lead on a new job without the same clearance (⚑8).
create or replace function public.set_lead_painter(p_work_order_id uuid, p_contractor_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_stage public.wo_stage; v_old uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select stage into v_stage from public.work_orders where id = p_work_order_id for update;
  if v_stage is null then return 'error:work_order_not_found'; end if;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if not exists (select 1 from public.wo_assignments where work_order_id = p_work_order_id and contractor_id = p_contractor_id and status <> 'released') then
    return 'error:not_on_job';
  end if;
  select contractor_id into v_old from public.wo_assignments where work_order_id = p_work_order_id and is_lead and status <> 'released';
  if v_old = p_contractor_id then return 'ok:unchanged'; end if;
  if public.painter_offers_blocked(p_contractor_id) then return 'error:red_no_clearance'; end if;
  update public.wo_assignments set is_lead = false where work_order_id = p_work_order_id and status <> 'released' and is_lead;
  update public.wo_assignments set is_lead = true where work_order_id = p_work_order_id and contractor_id = p_contractor_id and status <> 'released';
  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'lead_painter_changed', auth.uid(), 'staff', jsonb_build_object('from', v_old, 'to', p_contractor_id));
  return 'ok:lead_set';
end $$;
grant execute on function public.set_lead_painter(uuid, uuid) to authenticated;

-- assign_job names the lead on the way in: the same rule, as a trigger on the
-- lead flag so every path that sets is_lead meets it (assign_job, set_lead_painter).
create or replace function public.wo_assignments_lead_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_lead and (tg_op = 'INSERT' or not old.is_lead) and new.status <> 'released'
     and public.painter_offers_blocked(new.contractor_id) then
    raise exception 'red_no_clearance' using hint = 'This painter is on Red. The owner records "Spoken with, offers allowed" before they lead another job.';
  end if;
  return new;
end $$;
drop trigger if exists t_wo_assignments_lead_gate on public.wo_assignments;
create trigger t_wo_assignments_lead_gate before insert or update of is_lead on public.wo_assignments
  for each row execute function public.wo_assignments_lead_gate();

-- ---- 2. Payment terms -------------------------------------------------------------
alter table public.contractor_invoices
  add column if not exists terms_kind        text not null default 'default' check (terms_kind in ('default', 'green_fast', 'held')),
  add column if not exists terms_hold_reason text not null default '',
  add column if not exists terms_held_at     timestamptz,
  add column if not exists terms_held_by     uuid references auth.users (id) on delete set null;

update public.settings set value = value || jsonb_build_object('greenTermsBusinessDays', 3, 'bonusApprovalsEnabled', false)
 where key = 'painter_status_rules' and not (value ? 'greenTermsBusinessDays');

-- Business days (⚑14): Monday–Friday less the Victorian public holidays kept
-- under Settings → Booking rules (visit_booking_rules.publicHolidays).
create or replace function public.business_days_after(p_from date, p_n integer)
returns date language plpgsql stable security definer set search_path = public as $$
declare v date := p_from; v_left integer := greatest(0, p_n); v_hol text[];
begin
  select coalesce(array_agg(x), '{}') into v_hol
    from jsonb_array_elements_text(coalesce((select value->'publicHolidays' from public.settings where key = 'visit_booking_rules'), '[]'::jsonb)) x;
  while v_left > 0 loop
    v := v + 1;
    if extract(isodow from v) <= 5 and not (v::text = any (v_hol)) then v_left := v_left - 1; end if;
  end loop;
  return v;
end $$;
revoke all on function public.business_days_after(date, integer) from public, anon;
grant execute on function public.business_days_after(date, integer) to authenticated;

-- The sign-off draft (20270218 body) + the colour AT THAT MOMENT decides the terms.
create or replace function public.contractor_invoice_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype;
        v_a record; v_prev integer; v_ex integer; v_gst integer;
        v_terms integer; v_signed date; v_id uuid; v_green boolean; v_fast integer; v_due date;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'skip:no_contractor'; end if;
  select * into v_c from public.contractors where id = v_wo.contractor_id;
  if v_c.employment_type = 'employee' then return 'skip:employee'; end if;
  if exists (select 1 from public.contractor_invoices
              where work_order_id = p_work_order_id and auto_draft_source = 'signoff' and status <> 'draft') then
    return 'skip:already_submitted';
  end if;
  delete from public.contractor_invoices where work_order_id = p_work_order_id and status = 'draft';

  select * into v_a from public.contractor_invoice_amounts(p_work_order_id);
  v_prev := public.contractor_invoice_invoiced_cents(p_work_order_id);
  v_ex := v_a.total_inc_cents - v_prev;
  if v_ex <= 0 then return 'skip:nothing_remaining'; end if;
  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_ex::bigint, public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed from public.wo_signoff s where s.work_order_id = p_work_order_id;
  v_signed := coalesce(v_signed, (now() at time zone 'Australia/Melbourne')::date);

  -- R11 / §6 rule 6: Green at sign-off → 3 business days; otherwise the default terms.
  v_green := coalesce((select colour = 'green' from public.painter_status where painter_id = v_wo.contractor_id), false);
  v_fast := coalesce((select (value->>'greenTermsBusinessDays')::integer from public.settings where key = 'painter_status_rules'), 3);
  v_due := case when v_green then least(public.business_days_after(v_signed, v_fast), v_signed + v_terms) else v_signed + v_terms end;

  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source, offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents, claimed_ex_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
       status, due_on, rcti, terms_kind)
    values
      (p_work_order_id, v_wo.contractor_id, 'signoff', v_a.offer_cents, v_a.additions_cents, v_a.deduction_lines,
       v_prev, v_ex, v_ex, v_gst, v_ex + v_gst,
       'draft', v_due, v_c.rcti_agreement_signed_at is not null, case when v_green then 'green_fast' else 'default' end)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_drafted', 'system',
            jsonb_build_object('contractor_invoice_id', v_id, 'terms', case when v_green then 'green_fast' else 'default' end, 'due_on', v_due));
  return 'ok:' || v_id::text;
end $$;
revoke execute on function public.contractor_invoice_draft(uuid) from public, anon, authenticated;
grant execute on function public.contractor_invoice_draft(uuid) to service_role;

-- The PC's hold (R11, ⚑23): back to the default date — never later than it.
create or replace function public.contractor_invoice_hold_fast_terms(p_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_terms integer; v_signed date; v_default date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if length(coalesce(trim(p_reason), '')) < 3 then return 'error:no_reason'; end if;
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.status = 'paid' then return 'error:already_paid'; end if;
  if v_ci.terms_kind <> 'green_fast' then return 'error:not_fast_terms'; end if;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed from public.wo_signoff s where s.work_order_id = v_ci.work_order_id;
  v_default := coalesce(v_signed, v_ci.created_at::date) + v_terms;
  update public.contractor_invoices
     set terms_kind = 'held', terms_hold_reason = trim(p_reason), terms_held_at = now(), terms_held_by = auth.uid(),
         due_on = least(v_default, greatest(v_ci.due_on, v_default))   -- the default date, and never later than it
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'payment_terms_held', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id, 'reason', trim(p_reason), 'from_due', v_ci.due_on, 'to_due', v_default));
  return 'ok:held';
end $$;
revoke all on function public.contractor_invoice_hold_fast_terms(uuid, text) from public, anon;
grant execute on function public.contractor_invoice_hold_fast_terms(uuid, text) to authenticated;

create or replace function public.contractor_invoice_release_fast_terms(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_signed date; v_fast integer; v_due date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.status = 'paid' then return 'error:already_paid'; end if;
  if v_ci.terms_kind <> 'held' then return 'error:not_held'; end if;
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed from public.wo_signoff s where s.work_order_id = v_ci.work_order_id;
  v_fast := coalesce((select (value->>'greenTermsBusinessDays')::integer from public.settings where key = 'painter_status_rules'), 3);
  v_due := least(public.business_days_after(coalesce(v_signed, v_ci.created_at::date), v_fast), v_ci.due_on);
  update public.contractor_invoices
     set terms_kind = 'green_fast', terms_hold_reason = '', terms_held_at = null, terms_held_by = null, due_on = v_due
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'payment_terms_released', auth.uid(), 'staff', jsonb_build_object('contractor_invoice_id', p_id, 'to_due', v_due));
  return 'ok:released';
end $$;
revoke all on function public.contractor_invoice_release_fast_terms(uuid) from public, anon;
grant execute on function public.contractor_invoice_release_fast_terms(uuid) to authenticated;

-- ---- 3. Bonus --------------------------------------------------------------------
create or replace function public.bonus_hand_over(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_b public.painter_bonuses%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_b from public.painter_bonuses where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_b.status <> 'due' then return 'error:not_due'; end if;
  update public.painter_bonuses set status = 'with_owner', handed_over_at = now() where id = p_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (v_b.painter_id, 'bonus_sent_to_owner', jsonb_build_object('bonus_id', p_id), auth.uid());
  return 'ok:with_owner';
end $$;
revoke all on function public.bonus_hand_over(uuid) from public, anon;
grant execute on function public.bonus_hand_over(uuid) to authenticated;

-- The owner decides. Approve is refused while the switch is off (⚑10 / ⚑11 open).
create or replace function public.bonus_decide(p_id uuid, p_approve boolean, p_amount_cents integer default null, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_b public.painter_bonuses%rowtype; v_on boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not public.has_dashboard_role('owner') then return 'error:not_owner'; end if;
  select * into v_b from public.painter_bonuses where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_b.status not in ('due', 'with_owner') then return 'error:already_' || v_b.status; end if;
  if p_approve then
    v_on := coalesce((select (value->>'bonusApprovalsEnabled')::boolean from public.settings where key = 'painter_status_rules'), false);
    if not v_on then return 'error:approvals_off'; end if;
    if p_amount_cents is null or p_amount_cents <= 0 then return 'error:no_amount'; end if;
    update public.painter_bonuses
       set status = 'approved', amount_cents = p_amount_cents, decided_by = auth.uid(), decided_at = now(), note = coalesce(trim(p_note), '')
     where id = p_id;
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_b.painter_id, 'bonus_approved', jsonb_build_object('bonus_id', p_id, 'amount_cents', p_amount_cents), auth.uid());
    return 'ok:approved';
  else
    update public.painter_bonuses
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), note = coalesce(trim(p_note), '')
     where id = p_id;
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_b.painter_id, 'bonus_declined', jsonb_build_object('bonus_id', p_id, 'note', coalesce(trim(p_note), '')), auth.uid());
    return 'ok:declined';
  end if;
end $$;
revoke all on function public.bonus_decide(uuid, boolean, integer, text) from public, anon;
grant execute on function public.bonus_decide(uuid, boolean, integer, text) to authenticated;

-- Paying it (Tom, 8 Oct 2026, replacing R14's "no amount" at approval time):
-- a contractor is TOLD the amount and CLAIMS it; the claim raises a contractor
-- invoice for the bonus through the normal channel (submit → approve → pay →
-- remittance). An employed lead is told the amount and it goes on the payroll
-- CSV (⚑11) — the platform never pays an employee. GST on the claim follows the
-- contractor's registration like every other line until ⚑10 rules otherwise.
drop trigger if exists t_contractor_invoice_bonus_lines on public.contractor_invoices;
drop function if exists public.contractor_invoice_bonus_lines();
alter table public.contractor_invoices drop column if exists bonus_lines, drop column if exists bonus_cents;

create or replace function public.bonus_claim(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_b public.painter_bonuses%rowtype; v_c public.contractors%rowtype; v_cid uuid;
        v_gst integer; v_terms integer; v_today date; v_id uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_contractor'; end if;
  select * into v_b from public.painter_bonuses where id = p_id for update;
  if not found or v_b.painter_id <> v_cid then return 'error:not_yours'; end if;
  if v_b.status <> 'approved' then return 'error:not_approved'; end if;
  if v_b.payment_ref <> '' then return 'error:already_claimed'; end if;
  select * into v_c from public.contractors where id = v_cid;
  if v_c.employment_type = 'employee' then return 'error:employee_payroll'; end if;
  if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
  if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then return 'error:profile_incomplete:abn'; end if;
  if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then return 'error:profile_incomplete:bank'; end if;

  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_b.amount_cents::bigint, public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;
  v_terms := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  v_today := (now() at time zone 'Australia/Melbourne')::date;

  -- A submitted invoice in its own right: claimed_ex_cents 0 so it never eats the job's remainder.
  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source, offer_cents, variation_delta_cents, deduction_lines,
       previously_invoiced_cents, claimed_ex_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
       status, submitted_at, number, due_on, rcti, gst_registered_at_submit, entity_snapshot, lines, invoice_date, terms_kind)
    values
      (v_b.trigger_wo_id, v_cid, 'bonus', 0, 0, '[]'::jsonb,
       0, 0, v_b.amount_cents, v_gst, v_b.amount_cents + v_gst,
       'submitted', now(), public.ci_allocate_number(), v_today + v_terms, false, v_c.gst_registered,
       jsonb_build_object('company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address, 'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4),
       jsonb_build_array(jsonb_build_object('label', 'Bonus — clean work on Green, approved ' || to_char(v_b.decided_at at time zone 'Australia/Melbourne', 'DD Mon YYYY'), 'cents', v_b.amount_cents)),
       v_today, 'default')
    returning id into v_id;

  update public.painter_bonuses set payment_ref = v_id::text where id = p_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (v_cid, 'bonus_claimed', jsonb_build_object('bonus_id', p_id, 'contractor_invoice_id', v_id, 'amount_cents', v_b.amount_cents), auth.uid());
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_b.trigger_wo_id, 'contractor_invoice_submitted', auth.uid(), 'contractor', jsonb_build_object('contractor_invoice_id', v_id, 'bonus', true));
  return 'ok:' || v_id::text;
end $$;
revoke all on function public.bonus_claim(uuid) from public, anon;
grant execute on function public.bonus_claim(uuid) to authenticated;

-- Tom's flow: the painter is told the amount and claims it — so they read their
-- own approved / paid bonuses (never a due or declined one, never anyone else's).
drop policy if exists painter_bonuses_own on public.painter_bonuses;
create policy painter_bonuses_own on public.painter_bonuses for select to authenticated
  using (painter_id = public.current_contractor_id() and status in ('approved', 'paid'));

-- The bonus is PAID when its invoice is paid.
create or replace function public.contractor_invoice_bonus_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.auto_draft_source = 'bonus' then
    update public.painter_bonuses set status = 'paid' where payment_ref = new.id::text and status = 'approved';
  end if;
  return new;
end $$;
drop trigger if exists t_contractor_invoice_bonus_paid on public.contractor_invoices;
create trigger t_contractor_invoice_bonus_paid after update of status on public.contractor_invoices
  for each row execute function public.contractor_invoice_bonus_paid();

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'painter_status'
     and column_name in ('offers_cleared_at', 'offers_cleared_by', 'offers_cleared_reason')) as status_cols, 3 as _expect_status_cols,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_invoices'
     and column_name in ('terms_kind', 'terms_hold_reason', 'terms_held_at', 'terms_held_by')) as ci_cols, 4 as _expect_ci_cols,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('painter_offers_blocked', 'painter_clear_red', 'business_days_after', 'contractor_invoice_hold_fast_terms',
                       'contractor_invoice_release_fast_terms', 'bonus_hand_over', 'bonus_decide', 'bonus_claim', 'contractor_invoice_bonus_paid', 'wo_assignments_lead_gate')) as fns, 10 as _expect_fns,
  (select count(*) from pg_trigger where tgname in ('t_contractor_invoice_bonus_paid', 't_wo_assignments_lead_gate', 't_booking_offers_standards_gate')) as triggers, 3 as _expect_triggers,
  (select position('red_no_clearance' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_offer') as offer_gate, true as _expect_offer_gate,
  (select position('green_fast' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'contractor_invoice_draft') as draft_terms, true as _expect_draft_terms,
  has_function_privilege('authenticated', 'public.bonus_decide(uuid, boolean, integer, text)', 'execute') as decide_grant, true as _expect_decide_grant,
  (select value->>'bonusApprovalsEnabled' from public.settings where key = 'painter_status_rules') as approvals, 'false' as _expect_approvals_off,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'painter_bonuses') as bonus_policies, 2 as _expect_bonus_policies,
  public.business_days_after('2026-10-09'::date, 3) as fri_plus_3, '2026-10-14'::date as _expect_wed;

insert into public._prod_migrations(name) values ('20270230000000_status_offers_payment_bonus.sql') on conflict (name) do nothing;

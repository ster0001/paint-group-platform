-- 20270286 · Job offers wait for a signed, unexpired subcontractor agreement (ruling 1)
--
-- Contractor-agreement brief (21 Oct 2026), Step 6. The gate is agreement_gate_of
-- (20270285), a definer helper with no grant, mirrored word for word by
-- lib/agreements/status.ts. It is read in the SAME two places as the induction
-- gate and nowhere else: send_offer, and the booking_offers before-insert trigger.
-- Both bodies are the 20270270 bodies plus one block each, placed after the
-- induction gate so a painter is told about the induction first. Existing
-- contractors keep their offers until the office asks them to sign and the grace
-- window (settings.agreement_rules.graceDays, ruling 14 pending) has run out.
-- The demo job is exempt as before. Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. send_offer: the 20270270 body plus the agreement block ------------------------------
create or replace function public.send_offer(
  p_work_order_id uuid, p_contractor_id uuid, p_start date, p_end date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype; v_active boolean; v_offerable boolean; v_hours numeric;
  v_offer_id uuid; v_base integer; v_pay integer; v_gate text;
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
  -- Induction Step 5 (ruling 1): no offer before the induction is complete and the check passed.
  v_gate := public.induction_gate_of(p_contractor_id);
  if v_gate <> 'ok' then return 'error:' || v_gate; end if;
  -- Agreement brief (ruling 1): no offer without a signed, unexpired subcontractor agreement.
  v_gate := public.agreement_gate_of(p_contractor_id);
  if v_gate <> 'ok' then return 'error:' || v_gate; end if;
  -- R12 / ruling 8: a Red painter gets no new offer until the owner has cleared them.
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

-- ---- 2. the trigger: the 20270270 body plus the agreement block ------------------------------
create or replace function public.booking_offers_standards_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_gate text;
begin
  if new.is_demo then return new; end if;
  if new.state = 'offered' and public.standards_status_of(new.contractor_id) = 'blocked' then
    raise exception 'standards_not_signed' using hint = 'This painter has not confirmed the finish standards and their grace period has ended.';
  end if;
  if new.state = 'offered' then
    v_gate := public.induction_gate_of(new.contractor_id);
    if v_gate <> 'ok' then
      raise exception '%', v_gate using hint = 'This painter has not completed the induction, or the practical check has not been passed. No job offers until both are in.';
    end if;
    v_gate := public.agreement_gate_of(new.contractor_id);
    if v_gate <> 'ok' then
      raise exception '%', v_gate using hint = 'This painter has no signed, unexpired subcontractor agreement. No job offers until it is signed in the portal or a paper copy is uploaded.';
    end if;
  end if;
  if new.state = 'offered' and public.painter_offers_blocked(new.contractor_id) then
    raise exception 'red_no_clearance' using hint = 'This painter is on Red. The owner records Spoken with, offers allowed before any new offer.';
  end if;
  return new;
end $$;
drop trigger if exists t_booking_offers_standards_gate on public.booking_offers;
create trigger t_booking_offers_standards_gate before insert on public.booking_offers for each row execute function public.booking_offers_standards_gate();

-- ---- 3. read-back: compare each column to its _expect_ twin before calling this live --------
select
  (select position('agreement_gate_of' in pg_get_functiondef('public.send_offer(uuid, uuid, date, date, text)'::regprocedure)) > 0) as send_offer_reads_gate, true as _expect_send_offer_reads_gate,
  (select position('agreement_gate_of' in pg_get_functiondef('public.booking_offers_standards_gate()'::regprocedure)) > 0) as trigger_reads_gate, true as _expect_trigger_reads_gate,
  (select count(*) from pg_trigger where tgname = 't_booking_offers_standards_gate' and tgrelid = 'public.booking_offers'::regclass) as trigger_on, 1 as _expect_trigger_on,
  has_function_privilege('authenticated', 'public.send_offer(uuid, uuid, date, date, text)', 'execute') as send_offer_callable, true as _expect_send_offer_callable,
  has_function_privilege('authenticated', 'public.agreement_gate_of(uuid)', 'execute') as gate_by_session, false as _expect_gate_by_session,
  (select count(*) from public.contractors c where c.active and c.profile_id is not null and public.agreement_gate_of(c.id) <> 'ok') as contractors_blocked_right_now;

insert into public._prod_migrations(name) values ('20270286000000_agreement_offer_gate.sql') on conflict (name) do nothing;

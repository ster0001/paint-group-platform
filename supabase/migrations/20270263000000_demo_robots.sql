-- 20270263 · The demo robots — Step 2 of the induction brief
-- (docs/briefs/claude-code-brief-induction-demo-property.md §4.1, §4.2, §8 Step 2;
-- the rulings Tom gave on 14 Oct 2026, docs/briefs/induction-demo-property-s0-report.md §7).
--
-- The robots that answer a painter inside 12 Demo Street are TypeScript
-- (lib/demo/robots.ts), signed in as the Paint Group robot staff login and
-- calling the SAME RPCs the office and the customer use. The database side of
-- Step 2 is three small things:
--
--   · settings.demo_rules — the robot login and its reply delay (⚑7: 5 s).
--     The login is created by scripts/create-demo-robot.ts, never by SQL
--     (auth users are not rows this file can write).
--   · contractor_invoice_submit skips the profile checks (company, address,
--     ABN, bank) on a DEMO invoice — ruling 5: the practice invoice must
--     submit before a new painter has given bank details.
--   · wo_contractor_set_finish_date gains p_reason — ruling 4: the painter
--     gives a reason, it is logged on the event and the re-booked walkthrough,
--     and nothing waits on the office. The two-argument signature is dropped so
--     PostgREST never sees two overloads.
--
-- Converges on a re-run.

set lock_timeout = '15s';

-- ---- 1. settings ---------------------------------------------------------------------------
insert into public.settings (key, value) values ('demo_rules', jsonb_build_object(
  'robotDelayMs', 5000,                              -- ⚑7: the room sees it happen
  'robotEmail', 'robot@paintgroup.com.au',           -- the staff login the robots sign in as
  'robotName', 'Paint Group robot'
)) on conflict (key) do nothing;

-- ---- 2. contractor_invoice_submit: the 20270218 body, profile checks skipped on a demo row ----
create or replace function public.contractor_invoice_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_cid uuid; v_a record; v_prev integer; v_ex integer; v_gst integer; v_reimb record;
begin
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if v_cid is null or v_ci.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  if v_ci.status <> 'draft' then return 'error:already_' || v_ci.status::text; end if;

  select * into v_c from public.contractors where id = v_ci.contractor_id;
  -- 20270263 (ruling 5, 14 Oct): a practice invoice submits without the profile
  -- being complete — the induction runs before the painter has given bank details.
  if not v_ci.is_demo then
    if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
    if coalesce(trim(v_c.address), '') = '' then return 'error:profile_incomplete:address'; end if;
    if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then
      return 'error:profile_incomplete:abn';
    end if;
    if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then
      return 'error:profile_incomplete:bank';
    end if;
  end if;

  if exists (select 1 from public.wo_variations v
              where v.work_order_id = v_ci.work_order_id
                and v.credit and v.needs_manual_deduction and v.deduction_cents is null
                and v.status in ('customer_approved', 'contractor_accepted')) then
    return 'error:deduction_pending';
  end if;

  select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
  v_prev := public.contractor_invoice_invoiced_cents(v_ci.work_order_id);
  v_ex := v_a.total_inc_cents - v_prev;            -- the agreed figure is EX GST
  if v_ex <= 0 then return 'error:nothing_remaining'; end if;

  -- GST on top when registered; the net amount only when not.
  v_gst := case when v_c.gst_registered
                then public.gst_on_ex_cents(v_ex::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;

  -- Approved expenses ride along as at-cost reimbursement lines (6c).
  select * into v_reimb from public.contractor_expense_sweep(v_ci.work_order_id, v_ci.contractor_id);

  update public.contractor_invoices
     set status = 'submitted', submitted_at = now(),
         number = coalesce(number, public.ci_allocate_number()),
         offer_cents = v_a.offer_cents,
         variation_delta_cents = v_a.additions_cents,
         deduction_lines = v_a.deduction_lines,
         previously_invoiced_cents = v_prev,
         claimed_ex_cents = v_ex,
         subtotal_ex_cents = v_ex + (v_reimb.r_cents - v_reimb.r_gst),
         gst_cents = v_gst + v_reimb.r_gst,
         total_inc_cents = v_ex + v_gst + v_reimb.r_cents,
         reimbursement_lines = v_reimb.r_lines,
         reimbursement_cents = v_reimb.r_cents,
         gst_registered_at_submit = v_c.gst_registered,
         entity_snapshot = jsonb_build_object(
           'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
           'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
   where id = p_id;

  update public.contractor_expenses set invoice_id = p_id
   where id = any(v_reimb.r_ids);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:submitted';
end $$;
grant execute on function public.contractor_invoice_submit(uuid) to authenticated;

-- ---- 3. wo_contractor_set_finish_date: the 20261222 body plus a reason (ruling 4) ------------
drop function if exists public.wo_contractor_set_finish_date(uuid, date);
create or replace function public.wo_contractor_set_finish_date(p_work_order_id uuid, p_date date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_o public.booking_offers%rowtype; v_id uuid;
        v_kind text; v_old date; v_time time; v_reason text := left(coalesce(trim(p_reason), ''), 300);
begin
  if p_date is null then return 'error:no_date'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if v_wo.stage in ('offered', 'closed') then return 'error:not_live'; end if;

  select * into v_o from public.booking_offers
   where work_order_id = p_work_order_id and state = 'accepted'
   order by accepted_at desc nulls last limit 1;
  if not found then return 'error:no_booking'; end if;
  if p_date < v_o.start_date then return 'error:before_start'; end if;

  v_old := v_o.end_date;
  update public.booking_offers set end_date = p_date where id = v_o.id;
  -- The sync trigger listens to state only; write the work order here.
  update public.work_orders set end_date = p_date where id = p_work_order_id;

  -- Keep the client-confirmed TIME when the day moves.
  select scheduled_time into v_time from public.wo_walkthroughs
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked'
   order by created_at desc limit 1;

  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = 'final' and status = 'booked';
  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, scheduled_time, booked_by, note)
    values (p_work_order_id, 'final', p_date, v_time, auth.uid(),
            case when v_kind = 'contractor' then 'Finish date set by the painter' else '' end
              || case when v_reason <> '' then ' — ' || v_reason else '' end)
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'finish_date_changed', auth.uid(), v_kind,
            jsonb_build_object('from', v_old, 'to', p_date, 'walkthrough_id', v_id, 'reason', v_reason));
  return 'ok:' || p_date::text;
end $$;
grant execute on function public.wo_contractor_set_finish_date(uuid, date, text) to authenticated;

-- ---- 3b. the reminder moment behind the DEMO text (ruling I12) ---------------------------------------
-- wo_reminder_moments is written only by its RPCs and the reminder sweep
-- (lib/painterStatus/boundary.test.ts). The DEMO text the facilitator sends plants
-- the moment for today on the PRACTICE job through this one, so the next
-- tick or photo answers it by the existing trigger. Staff only, demo only.
create or replace function public.demo_prompt_plant(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_day date; v_id uuid;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if not v_wo.is_demo then return 'error:not_demo'; end if;
  v_day := (now() at time zone 'Australia/Melbourne')::date;
  insert into public.wo_reminder_moments (work_order_id, kind, day, due_at, is_demo)
    values (p_work_order_id, 'day1', v_day, now(), true)
    on conflict (work_order_id, kind) do update
      set day = excluded.day, due_at = excluded.due_at, answered_at = null, answered_event = null,
          skipped_reason = null, skipped_at = null
    returning id into v_id;
  return 'ok:' || v_id;
end $$;
revoke all on function public.demo_prompt_plant(uuid) from public, anon;
grant execute on function public.demo_prompt_plant(uuid) to authenticated, service_role;

-- ---- 4. read-back: compare every column to its _expect_ before calling this live ----------
select
  (select value->>'robotEmail' from public.settings where key = 'demo_rules') as robot_email, 'robot@paintgroup.com.au' as _expect_robot_email,
  (select (value->>'robotDelayMs')::integer from public.settings where key = 'demo_rules') as robot_delay_ms, 5000 as _expect_robot_delay_ms,
  (select prosrc like '%if not v_ci.is_demo then%' from pg_proc where proname = 'contractor_invoice_submit') as submit_skips_demo_profile, true as _expect_submit_skips_demo_profile,
  (select prosrc like '%error:deduction_pending%' from pg_proc where proname = 'contractor_invoice_submit') as submit_keeps_deduction_check, true as _expect_submit_keeps_deduction_check,
  (select count(*) from pg_proc where proname = 'wo_contractor_set_finish_date') as finish_date_overloads, 1 as _expect_finish_date_overloads,
  (select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'wo_contractor_set_finish_date') as finish_date_args, 'p_work_order_id uuid, p_date date, p_reason text' as _expect_finish_date_args,
  has_function_privilege('authenticated', 'public.wo_contractor_set_finish_date(uuid, date, text)', 'execute') as auth_can_set_finish, true as _expect_auth_can_set_finish,
  has_function_privilege('authenticated', 'public.contractor_invoice_submit(uuid)', 'execute') as auth_can_submit, true as _expect_auth_can_submit,
  has_function_privilege('authenticated', 'public.demo_prompt_plant(uuid)', 'execute') as auth_can_plant, true as _expect_auth_can_plant,
  has_function_privilege('anon', 'public.demo_prompt_plant(uuid)', 'execute') as anon_can_plant, false as _expect_anon_can_plant;

insert into public._prod_migrations(name) values ('20270263000000_demo_robots.sql') on conflict (name) do nothing;

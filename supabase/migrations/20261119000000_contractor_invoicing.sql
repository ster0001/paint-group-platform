-- =============================================================================
-- Invoicing Step 5 — contractor invoicing v2 (brief §6.3 / §8.5).
--
-- The 20261112 table (contractor_invoices + ci_status + RLS) finally gets its
-- machinery. The shape of the money, held everywhere:
--
--   total (inc GST) = offer + Σ accepted addition deltas − Σ deductions
--
--   · the OFFER is work_orders.contractor_payment_cents — server truth
--   · addition deltas are hours × the stamped rate (already SQL-computed)
--   · deductions are the acknowledged credits: the engine's figure for clean
--     removals, the PC's hand-set deduction_cents when work had started
--     (⚑10 — never automatic; submit REFUSES while one is still unset)
--   · INC-ANCHORED like every other invoice (⚑14): what we pay does not move
--     with GST registration — a registered contractor's document backs GST out
--     of the same total; an unregistered one shows GST 0 and is headed
--     "Invoice", never "Tax Invoice". Flag for the accountant in the PR body.
--
-- Client writes on the table were revoked in 20261112, so everything here is
-- a SECURITY DEFINER RPC. Auto-draft hooks into BOTH sign-off tails
-- (wo_sign, wo_close_without_walkthrough); a reopen drops the draft.
-- RCTI (⚑9): inert until contractors.rcti_agreement_signed_at — then the
-- submit step collapses (staff approve straight from draft, issued on the
-- contractor's behalf).
-- =============================================================================

-- ---- 1. columns + numbering -------------------------------------------------

alter table public.contractor_invoices
  add column if not exists number text unique,
  add column if not exists due_on date,               -- ⚑8: signed_at + terms days
  add column if not exists gst_registered_at_submit boolean,
  -- Entity details pinned at submission: gst_registered can flip later, the
  -- document must not.
  add column if not exists entity_snapshot jsonb not null default '{}'::jsonb;

create sequence if not exists public.ci_no_seq;

create or replace function public.ci_allocate_number()
returns text language sql volatile as
$$ select coalesce(public.invoice_setting_text('{numbering,contractor}'), 'CI-')
          || lpad(nextval('public.ci_no_seq')::text, 4, '0') $$;

-- remittance_no_seq existed since 20261112; nothing ever allocated from it.
create or replace function public.remittance_allocate_number()
returns text language sql volatile as
$$ select coalesce(public.invoice_setting_text('{numbering,remittance}'), 'REM-')
          || lpad(nextval('public.remittance_no_seq')::text, 4, '0') $$;

-- The CI- prefix joins the numbering object (only if absent — Tom may rename).
update public.settings
   set value = jsonb_set(value, '{numbering,contractor}', '"CI-"'::jsonb)
 where key = 'invoicing'
   and (value #> '{numbering,contractor}') is null;

-- ---- 2. the state guard -----------------------------------------------------
-- draft → submitted → approved → paid, plus the RCTI shortcut draft → approved.
-- Money columns freeze at submission; only drafts delete. service_role exempt
-- (e2e teardown, admin repair) — same rule as invoices.

create or replace function public.contractor_invoice_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and current_user <> 'service_role' then
      raise exception 'only draft contractor invoices can be deleted';
    end if;
    return old;
  end if;

  if current_user = 'service_role' then return new; end if;

  if new.status is distinct from old.status then
    if not ( (old.status = 'draft'     and new.status = 'submitted')
          or (old.status = 'submitted' and new.status = 'approved')
          or (old.status = 'approved'  and new.status = 'paid')
          -- ⚑9 RCTI: the platform issues on the contractor's behalf.
          or (old.status = 'draft'     and new.status = 'approved' and old.rcti) ) then
      raise exception 'contractor invoice cannot move % -> %', old.status, new.status;
    end if;
  end if;

  -- Frozen once it stops being a draft (the transition row itself may write
  -- the submit-time recompute, which is why the check is on OLD status).
  if old.status <> 'draft' and (
       new.offer_cents           is distinct from old.offer_cents
    or new.variation_delta_cents is distinct from old.variation_delta_cents
    or new.deduction_lines       is distinct from old.deduction_lines
    or new.subtotal_ex_cents     is distinct from old.subtotal_ex_cents
    or new.gst_cents             is distinct from old.gst_cents
    or new.total_inc_cents       is distinct from old.total_inc_cents
    or new.number                is distinct from old.number
    or new.entity_snapshot       is distinct from old.entity_snapshot ) then
    raise exception 'a submitted contractor invoice is immutable';
  end if;

  return new;
end $$;

drop trigger if exists contractor_invoices_guard on public.contractor_invoices;
create trigger contractor_invoices_guard
  before update or delete on public.contractor_invoices
  for each row execute function public.contractor_invoice_guard();

-- ---- 3. the money, computed in ONE place ------------------------------------
-- Internal: both the auto-draft and the submit-time recompute call this. The
-- TS twin is lib/workorder/contractorPay.ts — the contract test diffs them.

create or replace function public.contractor_invoice_amounts(p_work_order_id uuid)
returns table (offer_cents integer, additions_cents integer,
               deduction_lines jsonb, total_inc_cents integer)
language sql stable set search_path = public as $$
  with wo as (
    select coalesce(w.contractor_payment_cents, 0) as offer
      from public.work_orders w where w.id = p_work_order_id
  ),
  adds as (
    select coalesce(sum(v.contractor_delta_cents), 0)::integer as cents
      from public.wo_variations v
     where v.work_order_id = p_work_order_id
       and v.status = 'contractor_accepted' and not v.credit
  ),
  deducts as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'variation_id', v.id,
             'label', coalesce(nullif(trim(v.comment), ''), initcap(replace(v.category, '_', ' '))),
             'cents', case when v.needs_manual_deduction
                           then coalesce(v.deduction_cents, 0)
                           else coalesce(v.deduction_cents, v.contractor_delta_cents, 0) end,
             'note', v.deduction_note,
             'manual', v.needs_manual_deduction) order by v.created_at)
             filter (where (case when v.needs_manual_deduction
                                 then coalesce(v.deduction_cents, 0)
                                 else coalesce(v.deduction_cents, v.contractor_delta_cents, 0) end) > 0),
             '[]'::jsonb) as lines,
           coalesce(sum(case when v.needs_manual_deduction
                             then coalesce(v.deduction_cents, 0)
                             else coalesce(v.deduction_cents, v.contractor_delta_cents, 0) end), 0)::integer as cents
      from public.wo_variations v
     where v.work_order_id = p_work_order_id
       and v.status = 'contractor_accepted' and v.credit
  )
  select wo.offer, adds.cents, deducts.lines,
         greatest(wo.offer + adds.cents - deducts.cents, 0)::integer
    from wo, adds, deducts
$$;
revoke execute on function public.contractor_invoice_amounts(uuid) from public, anon, authenticated;

-- ---- 4. the auto-draft ------------------------------------------------------
-- Called from the sign-off tails. Idempotent: a standing DRAFT is replaced;
-- a submitted+ invoice is never touched.

create or replace function public.contractor_invoice_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_c public.contractors%rowtype;
        v_a record; v_gst integer; v_terms integer; v_signed date; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.contractor_id is null then return 'skip:no_contractor'; end if;
  select * into v_c from public.contractors where id = v_wo.contractor_id;

  if exists (select 1 from public.contractor_invoices
              where work_order_id = p_work_order_id and status <> 'draft') then
    return 'skip:already_submitted';
  end if;
  delete from public.contractor_invoices
   where work_order_id = p_work_order_id and status = 'draft';

  select * into v_a from public.contractor_invoice_amounts(p_work_order_id);

  -- Inc-anchored (⚑14): registration changes the document, never our cost.
  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_a.total_inc_cents::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;

  v_terms  := coalesce(public.invoice_setting_num('{contractorTermsDays}', 7)::integer, 7);
  select (s.signed_at at time zone 'Australia/Melbourne')::date into v_signed
    from public.wo_signoff s where s.work_order_id = p_work_order_id;

  insert into public.contractor_invoices
      (work_order_id, contractor_id, auto_draft_source,
       offer_cents, variation_delta_cents, deduction_lines,
       subtotal_ex_cents, gst_cents, total_inc_cents,
       status, due_on, rcti)
    values
      (p_work_order_id, v_wo.contractor_id, 'signoff',
       v_a.offer_cents, v_a.additions_cents, v_a.deduction_lines,
       v_a.total_inc_cents - v_gst, v_gst, v_a.total_inc_cents,
       'draft',
       coalesce(v_signed, (now() at time zone 'Australia/Melbourne')::date) + v_terms,
       v_c.rcti_agreement_signed_at is not null)
    returning id into v_id;

  -- No amounts in wo_events meta — the customer can read their job's events.
  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (p_work_order_id, 'contractor_invoice_drafted', 'system',
            jsonb_build_object('contractor_invoice_id', v_id));

  return 'ok:' || v_id::text;
end $$;
revoke execute on function public.contractor_invoice_draft(uuid) from public, anon, authenticated;
grant execute on function public.contractor_invoice_draft(uuid) to service_role;

-- ---- 5. the contractor submits ----------------------------------------------
-- One tap in the portal — but validated, not hoped: entity details present,
-- ABN 11 digits, bank on file, and NO credit still waiting on the PC's
-- deduction figure. Totals recompute at submission (a deduction may have been
-- set since sign-off) and the entity + GST registration are pinned.

create or replace function public.contractor_invoice_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_cid uuid; v_a record; v_gst integer;
begin
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if v_cid is null or v_ci.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  if v_ci.status <> 'draft' then return 'error:already_' || v_ci.status::text; end if;

  select * into v_c from public.contractors where id = v_ci.contractor_id;
  if coalesce(trim(v_c.company_name), '') = '' then return 'error:profile_incomplete:company_name'; end if;
  if coalesce(trim(v_c.address), '') = '' then return 'error:profile_incomplete:address'; end if;
  if length(regexp_replace(coalesce(v_c.abn, ''), '\D', '', 'g')) <> 11 then
    return 'error:profile_incomplete:abn';
  end if;
  if coalesce(trim(v_c.bank_bsb), '') = '' or coalesce(trim(v_c.bank_account_last4), '') = '' then
    return 'error:profile_incomplete:bank';
  end if;

  -- ⚑10: the contractor must see every deduction before their invoice goes in.
  if exists (select 1 from public.wo_variations v
              where v.work_order_id = v_ci.work_order_id
                and v.credit and v.needs_manual_deduction and v.deduction_cents is null
                and v.status in ('customer_approved', 'contractor_accepted')) then
    return 'error:deduction_pending';
  end if;

  select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
  v_gst := case when v_c.gst_registered
                then public.gst_from_inc_cents(v_a.total_inc_cents::bigint,
                       public.invoice_setting_num('{gstRatePct}', 10))::integer
                else 0 end;

  update public.contractor_invoices
     set status = 'submitted', submitted_at = now(),
         number = coalesce(number, public.ci_allocate_number()),
         offer_cents = v_a.offer_cents,
         variation_delta_cents = v_a.additions_cents,
         deduction_lines = v_a.deduction_lines,
         total_inc_cents = v_a.total_inc_cents,
         gst_cents = v_gst,
         subtotal_ex_cents = v_a.total_inc_cents - v_gst,
         gst_registered_at_submit = v_c.gst_registered,
         entity_snapshot = jsonb_build_object(
           'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
           'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
   where id = p_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'contractor',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:submitted';
end $$;
grant execute on function public.contractor_invoice_submit(uuid) to authenticated;

-- ---- 6. the PC approves -----------------------------------------------------
-- submitted → approved; or, with ⚑9 RCTI signed, draft → approved (the
-- platform issues on the contractor's behalf — same recompute and pinning the
-- submit would have done, actor recorded as staff).

create or replace function public.contractor_invoice_approve(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype; v_c public.contractors%rowtype;
        v_a record; v_gst integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;

  if v_ci.status = 'draft' then
    if not v_ci.rcti then return 'error:not_submitted'; end if;
    select * into v_c from public.contractors where id = v_ci.contractor_id;
    select * into v_a from public.contractor_invoice_amounts(v_ci.work_order_id);
    v_gst := case when v_c.gst_registered
                  then public.gst_from_inc_cents(v_a.total_inc_cents::bigint,
                         public.invoice_setting_num('{gstRatePct}', 10))::integer
                  else 0 end;
    update public.contractor_invoices
       set status = 'submitted', submitted_at = now(),
           number = coalesce(number, public.ci_allocate_number()),
           offer_cents = v_a.offer_cents,
           variation_delta_cents = v_a.additions_cents,
           deduction_lines = v_a.deduction_lines,
           total_inc_cents = v_a.total_inc_cents,
           gst_cents = v_gst,
           subtotal_ex_cents = v_a.total_inc_cents - v_gst,
           gst_registered_at_submit = v_c.gst_registered,
           entity_snapshot = jsonb_build_object(
             'company_name', v_c.company_name, 'abn', v_c.abn, 'address', v_c.address,
             'bank_bsb', v_c.bank_bsb, 'bank_last4', v_c.bank_account_last4)
     where id = p_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_ci.work_order_id, 'contractor_invoice_submitted', auth.uid(), 'staff',
              jsonb_build_object('contractor_invoice_id', p_id, 'rcti', true));
  elsif v_ci.status <> 'submitted' then
    return 'error:already_' || v_ci.status::text;
  end if;

  update public.contractor_invoices
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_approved', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:approved';
end $$;
grant execute on function public.contractor_invoice_approve(uuid) to authenticated;

-- ---- 7. mark paid -----------------------------------------------------------
-- Records, never moves money (the rulings): bank transfer date + reference,
-- and the remittance number is allocated here.

create or replace function public.contractor_invoice_mark_paid(
  p_id uuid, p_reference text default '', p_paid_on date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.status <> 'approved' then return 'error:not_approved'; end if;

  update public.contractor_invoices
     set status = 'paid',
         paid_at = coalesce(p_paid_on::timestamptz, now()),
         bank_reference = coalesce(trim(p_reference), ''),
         remittance_number = coalesce(remittance_number, public.remittance_allocate_number())
   where id = p_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_ci.work_order_id, 'contractor_invoice_paid', auth.uid(), 'staff',
            jsonb_build_object('contractor_invoice_id', p_id));

  return 'ok:paid';
end $$;
grant execute on function public.contractor_invoice_mark_paid(uuid, text, date) to authenticated;

-- Attach-once for the remittance PDF (the pdf layer writes the file, then this).
create or replace function public.contractor_invoice_attach_remittance_pdf(p_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ci public.contractor_invoices%rowtype;
begin
  select * into v_ci from public.contractor_invoices where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_ci.remittance_pdf_path is not null then return 'ok:already'; end if;
  update public.contractor_invoices set remittance_pdf_path = p_path where id = p_id;
  return 'ok:attached';
end $$;
grant execute on function public.contractor_invoice_attach_remittance_pdf(uuid, text) to authenticated, service_role;

-- ---- 8. the sign-off tails draft it -----------------------------------------
-- wo_sign — BODY BASIS 20261112 (which was 20261028 + the final-invoice
-- draft). TWO changes: the report's variations now carry the drawn-signature
-- record (A1 ruling: "show on the completion report"), and the contractor
-- invoice drafts beside the customer's final.

create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_wo public.work_orders%rowtype;
        v_kind public.wo_signoff_kind; v_captured text;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb;
begin
  -- Record-then-unpack: a %rowtype var cannot sit in a multi-item INTO (42601).
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  -- Which signature this really is. The caller's claim only survives for
  -- 'deemed', and only once the clock has genuinely run out.
  if p_kind = 'deemed' then
    if v_via <> 'customer' then return 'error:deemed_needs_customer_token'; end if;
    if v_s.deadline_at is null or now() < v_s.deadline_at then
      return 'error:deemed_too_early';
    end if;
    v_kind := 'deemed'; v_captured := null;
  elsif v_via = 'session' then
    v_kind := 'on_device'; v_captured := 'contractor_device';
  else
    -- Mode B: remote, from the customer's own link — FALLBACK ONLY.
    if v_s.client_unavailable_at is null and not exists (
      select 1 from public.wo_walkthroughs
       where work_order_id = v_s.work_order_id and kind = 'final' and status = 'missed'
    ) then
      return 'error:walkthrough_first';
    end if;
    v_kind := 'remote'; v_captured := 'customer_device';
  end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  -- Every area the job actually has must be approved. A deemed sign-off is the
  -- one exception, because there the silence IS the answer.
  if v_kind <> 'deemed' then
    select array_agg(h) into v_unapproved from (
      select distinct heading as h from public.wo_surfaces
       where work_order_id = v_s.work_order_id
    ) x
    where (v_s.areas -> x.h -> 'approved_at') is null;

    if v_unapproved is not null and array_length(v_unapproved, 1) > 0 then
      return 'error:areas_outstanding:' || array_to_string(v_unapproved, ',');
    end if;
  end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;   -- ⚑4: sign-off date

  update public.wo_signoff
     set signed_at = now(), signed_name = trim(p_name),
         signed_kind = v_kind, signed_device = coalesce(p_device, ''),
         captured_on = v_captured,
         walkthrough_session_token = null, walkthrough_session_expires_at = null
   where work_order_id = v_s.work_order_id;

  -- The booked walkthrough this signature completes.
  update public.wo_walkthroughs set status = 'done'
   where work_order_id = v_s.work_order_id and kind = 'final' and status = 'booked'
     and v_kind = 'on_device';

  -- 1. warranty
  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, v_kind)
  on conflict (work_order_id) do nothing;

  -- 2. the review request, as a task for the follow-up phase to pick up
  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- 3. the completion report — built from the events, not written by anyone
  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', trim(p_name), 'signed_kind', v_kind::text,
    'captured_on', v_captured,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = v_s.work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = v_s.work_order_id),
    -- Declined variations are IN the report. That is the point of keeping them.
    -- A1: signed ones carry who signed, when, and which way the money went.
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents, 'credit', credit,
                     'signed_name', signed_name, 'signed_at', signed_at)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = v_s.work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = v_s.work_order_id),
    'areas', v_s.areas
  ) into v_report;

  update public.wo_signoff set report = v_report where work_order_id = v_s.work_order_id;

  -- 4. the sign-off stub becomes the DRAFT FINAL INVOICE (Invoicing Step 1):
  -- adjusted contract − previously invoiced, lines pulled by source refs.
  perform public.invoice_draft_final(v_wo.estimate_id);

  -- 5. Step 5: the contractor's platform-drafted invoice, from the same facts.
  perform public.contractor_invoice_draft(v_s.work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(),
            case when v_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', v_kind::text, 'name', trim(p_name),
                               'captured_on', v_captured,
                               'warranty_starts', v_start, 'deemed', v_kind = 'deemed'));

  perform public.wo_set_stage(v_s.work_order_id, 'closed',
                              case when v_kind = 'deemed' then 'system' else 'customer' end,
                              jsonb_build_object('signed_kind', v_kind::text));

  return 'ok:signed';
end $$;

grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- wo_close_without_walkthrough — BODY BASIS 20261112. Same two changes.

create or replace function public.wo_close_without_walkthrough(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_r text; v_start date; v_report jsonb;
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
  if v_wo.stage not in ('completion_prep', 'qa') then return 'error:not_ready'; end if;

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

  -- Invoicing Step 1: the stub becomes the drafted final invoice.
  perform public.invoice_draft_final(v_wo.estimate_id);

  -- Step 5: the contractor's platform-drafted invoice, from the same facts.
  perform public.contractor_invoice_draft(p_work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'closed_without_walkthrough', auth.uid(), v_kind,
            jsonb_build_object('warranty_starts', v_start));
  return 'ok:closed';
end $$;
grant execute on function public.wo_close_without_walkthrough(uuid) to authenticated, service_role;

-- wo_reopen_signoff — BODY BASIS 20261112. ONE change: the contractor's draft
-- is dropped beside the customer's (a re-sign drafts both fresh). Submitted+
-- contractor invoices survive, exactly like issued finals.

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

  -- The first signing's draft final invoice — a re-sign drafts a fresh one.
  delete from public.invoices
   where estimate_id = v_wo.estimate_id and status = 'draft'
     and kind = 'final'::public.invoice_kind;

  -- Step 5: and the contractor's draft goes the same way.
  delete from public.contractor_invoices
   where work_order_id = p_work_order_id and status = 'draft';

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'signoff_reopened', auth.uid(), 'staff',
            jsonb_build_object('reason', coalesce(p_reason, ''),
                               'was_signed_at', v_s.signed_at, 'was_signed_by', v_s.signed_name));
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_reopen_signoff(uuid, text) to authenticated;

-- ---- 9. ⚑9: staff record the RCTI agreement ---------------------------------

create or replace function public.contractor_set_rcti(p_contractor_id uuid, p_signed boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.contractors
     set rcti_agreement_signed_at = case when p_signed then coalesce(rcti_agreement_signed_at, now()) end
   where id = p_contractor_id;
  if not found then return 'error:not_found'; end if;
  return 'ok';
end $$;
grant execute on function public.contractor_set_rcti(uuid, boolean) to authenticated;

-- ---- Verification (read this back after running) ----------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'contractor_invoices'
      and column_name in ('number','due_on','gst_registered_at_submit','entity_snapshot')) as ci_cols_4,
  (select count(*) from pg_sequences where sequencename = 'ci_no_seq') as ci_seq_1,
  (select count(*) from pg_trigger where tgname = 'contractor_invoices_guard') as guard_1,
  (select count(*) from pg_proc where proname in
    ('contractor_invoice_amounts','contractor_invoice_draft','contractor_invoice_submit',
     'contractor_invoice_approve','contractor_invoice_mark_paid',
     'contractor_invoice_attach_remittance_pdf','ci_allocate_number',
     'remittance_allocate_number','contractor_set_rcti')) as new_fns_9,
  (select prosrc like '%contractor_invoice_draft%' from pg_proc
    where proname = 'wo_sign' limit 1) as sign_drafts_ci,
  (select prosrc like '%contractor_invoice_draft%' from pg_proc
    where proname = 'wo_close_without_walkthrough' limit 1) as close_drafts_ci,
  (select prosrc like '%contractor_invoices%' from pg_proc
    where proname = 'wo_reopen_signoff' limit 1) as reopen_drops_ci,
  (select value #>> '{numbering,contractor}' from public.settings
    where key = 'invoicing') as ci_prefix;

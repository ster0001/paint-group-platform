-- =============================================================================
-- One offer per job: the revision builder's changes go to the customer as a
-- LIST with a total, signed or declined once (Tom, 23 Sep 2026).
--
-- "It proposes to send each update to the scope individually … all changes
--  made to the scope get added to a list of variations with the total amount,
--  and it is accepted or declined as one offer — if one change is made, or 5
--  changes made, the client sees a list and a price and accepts them."
--
-- The row stays the unit of record — one wo_variations row per scope block,
-- because the strike, the contractor's pay, the invoice line and the /e
-- changes list all hang off it. What changes is the TOKEN: every open revision
-- draft on a work order shares one customer_token, so the signing link is the
-- offer, /v/<token> lists every row behind it, and the sign/decline RPCs
-- answer them all in one transaction. A contractor-raised variation priced
-- through wo_price_variation still gets a token of its own (a list of one).
--
-- And the painter (same day): "Contractors must be able to see all approved
-- variations from the revision working scope in their work order. If it is
-- before the job is sent, then it just gets added in; if after, it is sent
-- for approval to the contractor once the client has approved."
--   * No painter on the job yet (no live/accepted offer, no employee
--     assignment) → the signed variation FOLDS IN: it lands contractor_accepted
--     on signature, and send_offer prices the offer as base pay + every
--     accepted variation, so the first painter to see the job sees one figure.
--   * A painter already on the job → unchanged: released to them on signature
--     (auto since 20261229), accepted on their job page.
--   * Either way the job sheet lists the approved changes — scope and hours,
--     never the customer's price — through get_work_order_scope_changes_by_token
--     for the token link and the same read on the portal.
--
-- Converges on re-run. Paste starts with the lock timeout so a busy table
-- fails loudly instead of hanging (CLAUDE.md, 19 Sep).
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the token is an OFFER, not a row --------------------------------------
-- The inline `unique` on customer_token (20260927) made one-link-per-row a
-- constraint. Drop whichever unique constraint or index covers exactly that
-- column, then index it plainly — every by-token read still needs the index.
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.wo_variations'::regclass
       and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attnum)
              from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['customer_token']
  loop
    execute format('alter table public.wo_variations drop constraint %I', r.conname);
  end loop;
end $$;
drop index if exists public.wo_variations_customer_token_key;
create index if not exists wo_variations_customer_token_idx
  on public.wo_variations (customer_token)
  where customer_token is not null;

-- ---- 2. helpers --------------------------------------------------------------
-- Is anyone on this job? A contractor named on the work order (an offer sets
-- it; so does a direct assignment by staff, which lib/contractor/jobs.ts
-- already treats as the commitment), a live or accepted offer, or an employee
-- assignment. Before this is true a signed change has nobody to ask.
create or replace function public.wo_has_painter(p_work_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.work_orders w
                  where w.id = p_work_order_id and w.contractor_id is not null)
      or exists (select 1 from public.booking_offers o
                  where o.work_order_id = p_work_order_id
                    and o.state in ('offered', 'proposed', 'accepted'))
      or exists (select 1 from public.wo_assignments a
                  where a.work_order_id = p_work_order_id and a.status <> 'released')
$$;
grant execute on function public.wo_has_painter(uuid) to authenticated;

-- The contractor's variation money, in SQL: the twin of
-- lib/workorder/contractorPay.ts (accepted additions add; acknowledged credits
-- deduct — the PC's manual figure when the removal hit started work, else the
-- engine's). Only contractor_accepted rows count.
create or replace function public.wo_contractor_variations_cents(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(
           case
             when not v.credit then coalesce(v.contractor_delta_cents, 0)
             when v.needs_manual_deduction then -coalesce(v.deduction_cents, 0)
             else -coalesce(v.deduction_cents, v.contractor_delta_cents, 0)
           end), 0)::integer
    from public.wo_variations v
   where v.work_order_id = p_work_order_id
     and v.status = 'contractor_accepted'
$$;
grant execute on function public.wo_contractor_variations_cents(uuid) to authenticated;

-- ---- 3. drafting joins the open offer -----------------------------------------
-- 20261117 body verbatim, except the token: a NEW draft takes the token of any
-- draft already awaiting the customer on this job, so every pending change
-- sits behind one link. A fresh token only when nothing is pending.
create or replace function public.wo_draft_revision_variation(
  p_estimate_id uuid, p_block_ref text, p_category text, p_comment text,
  p_credit boolean, p_surface_keys text[], p_price_cents integer,
  p_inputs jsonb, p_priced_lines jsonb, p_hours numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo uuid; v_v public.wo_variations%rowtype; v_rate integer; v_delta integer; v_token text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  if v_wo is null then return 'error:no_work_order'; end if;

  if coalesce(trim(p_block_ref), '') = '' then return 'error:no_block_ref'; end if;
  if coalesce(trim(p_category), '') = '' then return 'error:no_category'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  if p_price_cents is null or p_price_cents < 0 then return 'error:bad_price'; end if;
  if p_hours is null or p_hours < 0 then return 'error:bad_hours'; end if;

  select * into v_v
    from public.wo_variations
   where work_order_id = v_wo and revision_block_ref = p_block_ref
     and status = 'priced'
   for update;

  -- The change has netted back to nothing: retire any standing draft.
  if p_price_cents = 0 and p_hours = 0 then
    if found then
      update public.wo_variations set status = 'cancelled' where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_wo, 'variation_revision_cancelled', auth.uid(), 'staff',
                jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref));
      return 'ok:cancelled';
    end if;
    return 'ok:no_change';
  end if;

  v_rate  := public.wo_contractor_rate_cents();
  v_delta := round(p_hours * v_rate)::integer;

  if found then
    update public.wo_variations
       set category = trim(p_category), comment = trim(p_comment),
           credit = p_credit, surface_keys = p_surface_keys,
           price_cents = p_price_cents, priced_inputs = p_inputs,
           priced_lines = p_priced_lines, est_hours = p_hours,
           contractor_rate_cents = v_rate, contractor_delta_cents = v_delta
     where id = v_v.id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo, 'variation_revision_updated', auth.uid(), 'staff',
              jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                                 'price_cents', p_price_cents, 'credit', p_credit,
                                 'hours', p_hours));
    return 'ok:' || v_v.customer_token;
  end if;

  -- The open offer on this job, if there is one — the new draft joins it.
  select customer_token into v_token
    from public.wo_variations
   where work_order_id = v_wo and status = 'priced'
     and revision_block_ref is not null and customer_token is not null
   order by created_at
   limit 1;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment,
       est_hours, status, priced_inputs, priced_lines, price_cents,
       contractor_rate_cents, contractor_delta_cents, customer_token,
       credit, surface_keys, revision_block_ref)
    values
      (v_wo, auth.uid(), 'staff', false, trim(p_category), trim(p_comment),
       p_hours, 'priced', p_inputs, p_priced_lines, p_price_cents,
       v_rate, v_delta, v_token,
       p_credit, p_surface_keys, trim(p_block_ref))
    returning * into v_v;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_wo, 'variation_priced', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_v.id, 'block_ref', p_block_ref,
                               'price_cents', p_price_cents, 'credit', p_credit,
                               'hours', p_hours, 'contractor_rate_cents', v_rate,
                               'contractor_delta_cents', v_delta, 'revision', true));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_draft_revision_variation(uuid, text, text, text, boolean, text[], integer, jsonb, jsonb, numeric) to authenticated;

-- ---- 4. the token read returns the whole offer --------------------------------
-- Same columns as 20261120; no `limit 1`. /v lists every row and totals them.
drop function if exists public.wo_variation_by_token(text);
create function public.wo_variation_by_token(p_token text)
returns table (id uuid, wo_ref text, category text, comment text, price_cents integer,
               status public.wo_variation_status, job_title text, photo_count integer,
               credit boolean, priced_lines jsonb, signed_name text, signed_at timestamptz,
               adjusted_contract_cents bigint, estimate_token text)
language sql security definer set search_path = public as $$
  select v.id, w.wo_ref, v.category, v.comment, v.price_cents, v.status,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         (select count(*)::integer from public.wo_photos p where p.variation_id = v.id),
         v.credit, v.priced_lines, v.signed_name, v.signed_at,
         (select l.adjusted_contract_cents from public.invoice_ledger(w.estimate_id) l),
         (select e.share_token from public.estimates e where e.id = w.estimate_id)
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where v.customer_token = p_token
     and v.status in ('priced', 'customer_approved', 'contractor_accepted', 'declined')
   order by v.created_at;
$$;
grant execute on function public.wo_variation_by_token(text) to anon, authenticated;

-- ---- 5. one signature answers the offer ---------------------------------------
-- 20261117 per-row body, run for EVERY pending row behind the token in one
-- transaction: the strike, the manual-deduction route, the auto-release and
-- the no-site-work skip all apply per row exactly as before. New at the end
-- of each row: with nobody on the job, the change folds in (contractor_accepted
-- now) — there is no painter to ask, and send_offer will price them in.
create or replace function public.wo_customer_sign_variation(
  p_token text, p_name text, p_signature text
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
        v_started integer; v_struck integer; v_manual boolean; v_status public.wo_variation_status;
        v_answered integer := 0; v_prior public.wo_variation_status; v_painter boolean;
begin
  if coalesce(trim(p_name), '') = '' then return 'error:name_required'; end if;
  if p_signature is null
     or p_signature not like 'data:image/png;base64,%'
     or length(p_signature) < 100 then
    return 'error:signature_required';
  end if;
  if length(p_signature) > 400000 then return 'error:signature_too_big'; end if;

  select coalesce(public.wo_loop_setting(array['variationRelease']) = '"auto"'::jsonb, false) into v_auto;

  for v_v in
    select * from public.wo_variations
     where customer_token = p_token and status = 'priced'
     order by created_at
     for update
  loop
    v_answered := v_answered + 1;
    v_started := 0; v_struck := 0;
    v_painter := public.wo_has_painter(v_v.work_order_id);

    update public.wo_variations
       set status = 'customer_approved', customer_responded_at = now(),
           signed_name = trim(p_name), signature = p_signature, signed_at = now()
     where id = v_v.id;

    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'variation_customer_approved', 'customer',
              jsonb_build_object('variation_id', v_v.id, 'price_cents', v_v.price_cents,
                                 'credit', v_v.credit, 'signed', true,
                                 'signed_name', trim(p_name), 'offer_token', p_token));

    if v_v.credit then
      -- The strike. Only untouched surfaces are struck; work that happened is a
      -- record, and the removal of already-worked scope is a money conversation
      -- for the PC, not a computation.
      select count(*) into v_started
        from public.wo_surfaces
       where work_order_id = v_v.work_order_id
         and surface_key = any (coalesce(v_v.surface_keys, '{}'::text[]))
         and state <> 'todo';

      update public.wo_surfaces
         set removed_from_scope = true, removed_by_variation = v_v.id
       where work_order_id = v_v.work_order_id
         and surface_key = any (coalesce(v_v.surface_keys, '{}'::text[]))
         and state = 'todo'
         and not removed_from_scope;
      get diagnostics v_struck = row_count;

      insert into public.wo_events (work_order_id, type, actor_kind, meta)
        values (v_v.work_order_id, 'surfaces_struck', 'system',
                jsonb_build_object('variation_id', v_v.id, 'struck', v_struck,
                                   'already_worked', v_started));

      if v_started > 0 then
        update public.wo_variations set needs_manual_deduction = true where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id, 'variation_needs_manual_deduction', 'system',
                  jsonb_build_object('variation_id', v_v.id, 'started_surfaces', v_started));
      end if;
    else
      -- Additions: unchanged release behaviour (⚑2 — a human between the two
      -- money events unless the setting says auto).
      if v_auto then
        update public.wo_variations set released_at = now() where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id, 'variation_released', 'system',
                  jsonb_build_object('variation_id', v_v.id, 'auto', true));
      end if;
    end if;

    -- No site work → nothing for the contractor to accept or acknowledge
    -- (ruling 3). Advance so the stage gate never waits on nobody.
    if coalesce(v_v.est_hours, 0) = 0 then
      select needs_manual_deduction into v_manual from public.wo_variations where id = v_v.id;
      if not coalesce(v_manual, false) then
        update public.wo_variations
           set status = 'contractor_accepted', contractor_accepted_at = now()
         where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id, 'variation_no_site_work', 'system',
                  jsonb_build_object('variation_id', v_v.id));
      end if;
    end if;

    -- Nobody on the job yet → it just gets added in (Tom, 23 Sep). The row
    -- lands where a painter's accept would have put it; the offer that goes
    -- out later carries the money (send_offer below). A removal that somehow
    -- hit started work still waits on the PC's deduction.
    if not v_painter then
      select status, needs_manual_deduction into v_status, v_manual
        from public.wo_variations where id = v_v.id;
      if v_status = 'customer_approved' and not coalesce(v_manual, false) then
        update public.wo_variations
           set status = 'contractor_accepted', contractor_accepted_at = now(),
               released_at = coalesce(released_at, now())
         where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id, 'variation_folded_into_offer', 'system',
                  jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours,
                                     'credit', v_v.credit,
                                     'contractor_delta_cents', v_v.contractor_delta_cents));
      end if;
    end if;
  end loop;

  if v_answered = 0 then
    select status into v_prior from public.wo_variations
     where customer_token = p_token order by created_at desc limit 1;
    if v_prior is null then return 'error:not_found'; end if;
    return 'error:already_' || v_prior::text;
  end if;

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- ---- 6. one "no thanks" declines the offer ------------------------------------
create or replace function public.wo_customer_respond_variation(
  p_token text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_answered integer := 0; v_prior public.wo_variation_status;
begin
  if p_approve then
    -- Ruling 1 (24 Aug): the customer SIGNS every variation.
    return 'error:signature_required';
  end if;

  for v_v in
    select * from public.wo_variations
     where customer_token = p_token and status = 'priced'
     order by created_at
     for update
  loop
    v_answered := v_answered + 1;
    -- Declined variations are KEPT, never deleted: they appear on the completion
    -- report as raised-and-declined, which is what protects the job later.
    update public.wo_variations
       set status = 'declined', customer_responded_at = now(),
           declined_reason = coalesce(p_note, '')
     where id = v_v.id;

    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'variation_declined', 'customer',
              jsonb_build_object('variation_id', v_v.id, 'note', coalesce(p_note, ''),
                                 'offer_token', p_token));
  end loop;

  if v_answered = 0 then
    select status into v_prior from public.wo_variations
     where customer_token = p_token order by created_at desc limit 1;
    if v_prior is null then return 'error:not_found'; end if;
    return 'error:already_' || v_prior::text;
  end if;
  return 'ok:declined';
end $$;
grant execute on function public.wo_customer_respond_variation(text, boolean, text) to anon, authenticated;

-- ---- 7. the offer carries the folded-in money ---------------------------------
-- 20260909 body verbatim, except payment_cents: base pay + every accepted
-- variation on the job, so a painter offered a job after the customer signed
-- changes sees ONE figure. After acceptance the portal's own arithmetic
-- (contractor_payment_cents + accepted variations) reaches the same number.
create or replace function public.send_offer(
  p_work_order_id uuid,
  p_contractor_id uuid,
  p_start date,
  p_end date default null,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_active boolean;
  v_offerable boolean;
  v_hours numeric;
  v_offer_id uuid;
  v_pay integer;
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

  if exists (
    select 1 from public.booking_offers
     where work_order_id = p_work_order_id and state in ('offered', 'proposed')
  ) then
    return 'conflict:already_offered';
  end if;

  -- Hours allowance comes from the frozen work-order document, not the caller.
  select coalesce(sum((s->>'hours')::numeric), 0) into v_hours
    from jsonb_array_elements(coalesce(v_wo.wo_snapshot->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s;

  -- Server-side truth, never the client's number: the job's base pay plus
  -- what the customer has already signed and nobody was on the job to accept.
  v_pay := case when v_wo.contractor_payment_cents is null then null
                else greatest(0, v_wo.contractor_payment_cents
                                 + public.wo_contractor_variations_cents(v_wo.id)) end;

  insert into public.booking_offers (
    work_order_id, contractor_id, start_date, end_date,
    hours_allowance, payment_cents, staff_note, expires_at
  ) values (
    p_work_order_id, p_contractor_id, p_start, p_end,
    nullif(v_hours, 0),
    v_pay,
    coalesce(p_note, ''),
    now() + interval '24 hours'
  ) returning id into v_offer_id;

  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id,
                               'payment_cents', v_pay, 'base_payment_cents', v_wo.contractor_payment_cents,
                               'start', p_start),
            auth.uid());

  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

-- ---- 8. the job sheet lists the approved changes ------------------------------
-- The token link's read: scope and hours only. price_cents and
-- contractor_delta_cents are not in the return type, so no caller can leak
-- them (the pattern of get_work_order_variations_by_crew_token). Approved
-- rows only — a pending or declined change is not work.
create or replace function public.get_work_order_scope_changes_by_token(p_token text)
returns table (id uuid, category text, comment text, est_hours numeric, credit boolean,
               status text, approved_at timestamptz)
language sql security definer set search_path = public as $$
  select v.id, v.category, v.comment, v.est_hours, coalesce(v.credit, false), v.status::text,
         coalesce(v.customer_responded_at, v.created_at)
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where w.share_token = p_token
     and w.issued_at is not null
     and v.status in ('customer_approved', 'contractor_accepted')
   order by coalesce(v.customer_responded_at, v.created_at);
$$;
grant execute on function public.get_work_order_scope_changes_by_token(text) to anon, authenticated;

-- ---- Read-back: compare each column to its _expect_ before calling this live --
select
  (select count(*) from pg_constraint c
     where c.conrelid = 'public.wo_variations'::regclass and c.contype = 'u'
       and (select array_agg(a.attname::text) from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['customer_token'])
    as token_unique_constraints, 0 as _expect_token_unique_constraints,
  (select count(*) from pg_indexes where indexname = 'wo_variations_customer_token_idx')
    as token_index, 1 as _expect_token_index,
  (select count(*) from pg_proc where proname in
     ('wo_has_painter', 'wo_contractor_variations_cents', 'get_work_order_scope_changes_by_token'))
    as new_fns, 3 as _expect_new_fns,
  (select prosrc like '%order by created_at%' and prosrc not like '%limit 1%'
     from pg_proc where proname = 'wo_variation_by_token' limit 1)
    as by_token_lists_all, true as _expect_by_token_lists_all,
  (select prosrc like '%variation_folded_into_offer%' from pg_proc
     where proname = 'wo_customer_sign_variation' limit 1)
    as sign_folds_in, true as _expect_sign_folds_in,
  (select prosrc like '%wo_contractor_variations_cents%' from pg_proc
     where proname = 'send_offer' limit 1)
    as offer_prices_variations, true as _expect_offer_prices_variations,
  (select prosrc like '%order by created_at%' from pg_proc
     where proname = 'wo_draft_revision_variation' limit 1)
    as draft_joins_offer, true as _expect_draft_joins_offer,
  (select has_function_privilege('anon', 'public.get_work_order_scope_changes_by_token(text)', 'execute'))
    as anon_reads_scope_changes, true as _expect_anon_reads_scope_changes;

insert into public._prod_migrations(name) values ('20270192000000_variation_offer_bundle.sql') on conflict (name) do nothing;

-- =============================================================================
-- 20270253 · Revise scope reaches the painter (Tom, 12 Oct 2026)
-- =============================================================================
-- 1. Hours-only changes go straight to the painter. A change in Revise scope
--    that moves the contractor's hours but not the customer's price (an
--    imported, price-overridden job — 73 Kerferd Rd) used to be drafted as a
--    $0 offer for the CUSTOMER to sign, so it never reached the painter.
--      wo_apply_hours_only_change   NEW staff RPC: a priced $0 revision row with
--                                   hours is approved without a signature and
--                                   leaves the customer's offer. Painter on the
--                                   job → released to them to Accept (an
--                                   addition) or acknowledge (fewer hours).
--                                   Nobody yet → folds into the job sheet.
-- 2. Before anyone has the job, the job sheet becomes the new scope. "If changes
--    are made before it is sent to a contractor, the work order just updates to
--    the new scope — they see the updated scope with no variations."
--      wo_variations.in_sheet_at    set when a change is folded into the sheet.
--      wo_variations.hours_only     an hours-only change (item 1) — the painter's card names it.
--      wo_fold_scope_into_sheet     helper (no grant): wo_snapshot := the sheet
--                                   the office drafted from (priced_inputs.sheet,
--                                   the builder's woDoc), keeping the base pay
--                                   figure (the money stays on the rows); marks
--                                   folded rows in_sheet_at.
--      wo_customer_sign_variation   20270220 body + the fold when no painter.
--      get_work_order_scope_changes_by_token, employee_variations
--                                   20270192 / 20270158 bodies, minus in_sheet rows.
-- Converges on a re-run: add column if not exists, or-replace, idempotent grants.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wo_variations add column if not exists in_sheet_at timestamptz;
-- An hours-only change the customer never signed (the painter's card says so).
alter table public.wo_variations add column if not exists hours_only boolean not null default false;

-- ---- the fold (helper — other definer functions call it, so no grant) ---------
create or replace function public.wo_fold_scope_into_sheet(p_work_order_id uuid, p_sheet jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_marked integer := 0; v_old jsonb;
begin
  if p_work_order_id is null then return 0; end if;
  if public.wo_has_painter(p_work_order_id) then return 0; end if;
  -- No sheet (a draft from before 20270253): the changes stay listed beside
  -- the old sheet — hiding them with nothing to replace them would lose work.
  if jsonb_typeof(p_sheet) is distinct from 'object' then return 0; end if;

  update public.wo_variations
     set in_sheet_at = now()
   where work_order_id = p_work_order_id
     and revision_block_ref is not null
     and status = 'contractor_accepted'
     and in_sheet_at is null;
  get diagnostics v_marked = row_count;

  select wo_snapshot into v_old from public.work_orders where id = p_work_order_id for update;
  -- The sheet's own pay figure is the WHOLE working scope; the base pay
  -- stays what it was and the folded rows carry the difference (send_offer
  -- adds them), so nothing is counted twice.
  update public.work_orders
     set wo_snapshot = case when jsonb_typeof(v_old) = 'object'
                            then v_old || (p_sheet - 'contractorPaymentCents')
                            else p_sheet - 'contractorPaymentCents' end
   where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (p_work_order_id, 'scope_folded_into_sheet', 'system',
            jsonb_build_object('variations_folded', v_marked));
  return v_marked;
end $$;
revoke execute on function public.wo_fold_scope_into_sheet(uuid, jsonb) from public, anon, authenticated;

-- ---- 1. the customer signs (20270220 body + the fold) -------------------------
create or replace function public.wo_customer_sign_variation(
  p_token text, p_name text, p_signature text
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
        v_started integer; v_struck integer; v_manual boolean; v_status public.wo_variation_status;
        v_answered integer := 0; v_prior public.wo_variation_status; v_painter boolean;
        v_wo uuid; v_sheet jsonb;
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
    v_wo := v_v.work_order_id;
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
    -- Tom, 24 Sep: a change from the REVISION WORKING SCOPE is the office's
    -- and the customer's decision — the painter is told, never asked, whether
    -- or not someone is on the job. (A painter-raised variation still travels
    -- release → accept: they asked, they confirm.) A removal that hit started
    -- work still waits on the PC's deduction.
    -- Tom, 7 Oct 2026: a painter ON the job is ASKED, not told — a revision
    -- change the customer signs is released to them straight away (the office
    -- already chose the price) and waits on their Accept or Decline. With no
    -- painter yet it folds into the job as before.
    select status, needs_manual_deduction into v_status, v_manual
      from public.wo_variations where id = v_v.id;
    if not v_painter then
      if v_status = 'customer_approved' and not coalesce(v_manual, false) then
        update public.wo_variations
           set status = 'contractor_accepted', contractor_accepted_at = now(),
               released_at = coalesce(released_at, now())
         where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id, 'variation_folded_into_offer', 'system',
                  jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours,
                                     'credit', v_v.credit, 'painter_on_job', false,
                                     'contractor_delta_cents', v_v.contractor_delta_cents));
      end if;
    elsif v_v.revision_block_ref is not null and v_status = 'customer_approved' and not v_v.credit then
      update public.wo_variations set released_at = coalesce(released_at, now()) where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor_kind, meta)
        values (v_v.work_order_id, 'variation_sent_to_painter', 'system',
                jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours,
                                   'contractor_delta_cents', v_v.contractor_delta_cents));
    end if;
  end loop;

  -- 20270253 (Tom, 12 Oct 2026): nobody has the job yet → the job sheet IS
  -- the new scope. The sheet the office drafted this offer from replaces the
  -- painter's copy and the folded changes stop reading as variations, so the
  -- painter who is offered it later sees one scope and one price.
  if v_answered > 0 and not public.wo_has_painter(v_wo) then
    select priced_inputs -> 'sheet' into v_sheet
      from public.wo_variations
     where customer_token = p_token and jsonb_typeof(priced_inputs -> 'sheet') = 'object'
     order by created_at desc limit 1;
    perform public.wo_fold_scope_into_sheet(v_wo, v_sheet);
  end if;

  if v_answered = 0 then
    select status into v_prior from public.wo_variations
     where customer_token = p_token order by created_at desc limit 1;
    if v_prior is null then return 'error:not_found'; end if;
    return 'error:already_' || v_prior::text;
  end if;

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- ---- 2. an hours-only change: no customer signature ----------------------------
create or replace function public.wo_apply_hours_only_change(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_painter boolean; v_started integer := 0; v_status public.wo_variation_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.revision_block_ref is null then return 'error:not_revision'; end if;
  if v_v.status <> 'priced' then return 'error:not_priced'; end if;
  if coalesce(v_v.price_cents, 0) <> 0 then return 'error:has_price'; end if;
  if coalesce(v_v.est_hours, 0) <= 0 then return 'error:no_hours'; end if;

  v_painter := public.wo_has_painter(v_v.work_order_id);

  -- Out of the customer's offer: there is nothing for them to sign.
  update public.wo_variations
     set status = 'customer_approved', customer_responded_at = now(), customer_token = null, hours_only = true
   where id = v_v.id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_hours_only_approved', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours, 'credit', v_v.credit,
                               'contractor_delta_cents', v_v.contractor_delta_cents, 'painter_on_job', v_painter));

  -- Fewer hours with surfaces gone: strike the untouched rows, exactly as a
  -- signed removal would.
  if v_v.credit and coalesce(array_length(v_v.surface_keys, 1), 0) > 0 then
    select count(*) into v_started from public.wo_surfaces
     where work_order_id = v_v.work_order_id and surface_key = any (v_v.surface_keys) and state <> 'todo';
    update public.wo_surfaces
       set removed_from_scope = true, removed_by_variation = v_v.id
     where work_order_id = v_v.work_order_id and surface_key = any (v_v.surface_keys)
       and state = 'todo' and not removed_from_scope;
    if v_started > 0 then
      update public.wo_variations set needs_manual_deduction = true where id = v_v.id;
    end if;
  end if;

  select status into v_status from public.wo_variations where id = v_v.id;  -- an employee job auto-applies
  if v_status <> 'customer_approved' then return 'ok:applied'; end if;

  if v_painter then
    -- The painter is asked: an addition waits on their Accept, fewer hours on
    -- their acknowledgement.
    if not v_v.credit then
      update public.wo_variations set released_at = coalesce(released_at, now()) where id = v_v.id;
      insert into public.wo_events (work_order_id, type, actor_kind, meta)
        values (v_v.work_order_id, 'variation_sent_to_painter', 'system',
                jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours,
                                   'contractor_delta_cents', v_v.contractor_delta_cents, 'hours_only', true));
    end if;
    return 'ok:with_painter';
  end if;

  if v_started > 0 then return 'ok:needs_deduction'; end if;
  update public.wo_variations
     set status = 'contractor_accepted', contractor_accepted_at = now(), released_at = coalesce(released_at, now())
   where id = v_v.id;
  perform public.wo_fold_scope_into_sheet(v_v.work_order_id, v_v.priced_inputs -> 'sheet');
  return 'ok:in_sheet';
end $$;
grant execute on function public.wo_apply_hours_only_change(uuid) to authenticated;

-- ---- 3. folded changes are the sheet, not a list beside it ----------------------
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
     and v.in_sheet_at is null
   order by coalesce(v.customer_responded_at, v.created_at);
$$;
grant execute on function public.get_work_order_scope_changes_by_token(text) to anon, authenticated;

create or replace function public.employee_variations(p_work_order_id uuid)
returns table (
  id uuid, work_order_id uuid, category text, comment text, est_hours numeric,
  outcome text, scope_lines jsonb, office_note text, credit boolean,
  created_at timestamptz, decided_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select v.id, v.work_order_id, v.category, v.comment, v.est_hours,
         case v.status::text
           when 'raised' then 'with_office'
           when 'priced' then 'with_customer'
           when 'customer_approved' then 'approved'
           when 'contractor_accepted' then 'approved'
           when 'declined' then 'not_going_ahead'
           else 'not_going_ahead' end,
         coalesce(public.jsonb_strip_money(v.priced_lines), '[]'::jsonb),
         coalesce(v.declined_reason, ''),
         coalesce(v.credit, false),
         v.created_at, v.customer_responded_at
    from public.wo_variations v
   where public.is_employee()
     and v.work_order_id = p_work_order_id
     and v.work_order_id in (select public.wo_my_job_ids_as_contractor())
     and v.status <> 'cancelled'
     and v.in_sheet_at is null
   order by v.created_at desc
$$;
grant execute on function public.employee_variations(uuid) to authenticated;

-- ---- read-back: compare each column to its _expect_ before calling this live ----
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_variations' and column_name in ('in_sheet_at', 'hours_only')) as new_cols, 2 as _expect_new_cols,
  (select prosrc like '%wo_fold_scope_into_sheet%' from pg_proc where proname = 'wo_customer_sign_variation' limit 1) as sign_folds_sheet, true as _expect_sign_folds_sheet,
  (select has_function_privilege('authenticated', 'public.wo_apply_hours_only_change(uuid)', 'execute')) as hours_only_granted, true as _expect_hours_only_granted,
  (select has_function_privilege('authenticated', 'public.wo_fold_scope_into_sheet(uuid, jsonb)', 'execute')) as fold_granted, false as _expect_fold_granted,
  (select has_function_privilege('anon', 'public.wo_customer_sign_variation(text, text, text)', 'execute')) as sign_anon, true as _expect_sign_anon,
  (select prosrc like '%in_sheet_at is null%' from pg_proc where proname = 'get_work_order_scope_changes_by_token' limit 1) as token_list_skips_sheet, true as _expect_token_list_skips_sheet,
  (select prosrc like '%in_sheet_at is null%' from pg_proc where proname = 'employee_variations' limit 1) as employee_list_skips_sheet, true as _expect_employee_list_skips_sheet;

insert into public._prod_migrations(name) values ('20270253000000_revise_scope_reaches_painter.sql') on conflict (name) do nothing;

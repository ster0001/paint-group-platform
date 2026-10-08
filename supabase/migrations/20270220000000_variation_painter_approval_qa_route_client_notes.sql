-- =============================================================================
-- PC Command, Tom 7 Oct 2026 — four things in one paste.
--
-- 1. A painter ON the job approves a change the client approved.
--    "When a contractor submits a variation and we choose the price in Revise
--    scope, when the variation is approved by the customer we send it to the
--    contractor for their approval." Since 20270195 a revision change was FOLDED
--    straight in when a painter was on the job (told, never asked). Now:
--      wo_customer_sign_variation   20270195 body; with a painter on the job a signed
--                                   revision addition is RELEASED to them (released_at)
--                                   and waits at customer_approved for their answer;
--                                   with no painter it folds in as before.
--      wo_contractor_decline_variation  NEW: the painter's Decline, with a note
--                                   ("please advise us of any further changes"). The
--                                   row goes to 'declined' with contractor_declined_at
--                                   + the note; tick rows the approval added and nobody
--                                   started are removed; the gate no longer waits on it;
--                                   the office gets a card and an alert (app side).
--    Columns: wo_variations.contractor_declined_at, contractor_decline_note — the
--    customer's approval stands on the row (signed_*), so a token page can tell a
--    painter's decline from the customer's.
--
-- 2. A quality-check job with no check on it moves on (25 Bunney Road).
--      wo_qa_route_passed           20270196 body; zero checks at qa routes like a pass
--                                   instead of answering ok:0 for ever.
--
-- 3. Client-update notes on the job (Felipe's log), on the job's own record.
--      wo_add_client_update_note    staff-only RPC → wo_events 'client_update_note'.
--                                   The CRM copy is written by the server action
--                                   through crm_log_event (note_added, origin
--                                   client_update) — one table each, no new table.
--
-- Converges on a re-run: or-replace, add column if not exists, idempotent grants.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 0. the painter's decline, on the row -------------------------------------
alter table public.wo_variations
  add column if not exists contractor_declined_at timestamptz,
  add column if not exists contractor_decline_note text not null default '';

-- ---- 1. the customer signs: a painter on the job is asked -----------------------
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

  if v_answered = 0 then
    select status into v_prior from public.wo_variations
     where customer_token = p_token order by created_at desc limit 1;
    if v_prior is null then return 'error:not_found'; end if;
    return 'error:already_' || v_prior::text;
  end if;

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- ---- 1b. the painter declines, with a note ---------------------------------------
create or replace function public.wo_contractor_decline_variation(p_variation_id uuid, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_note text; v_removed integer := 0;
begin
  v_note := left(trim(coalesce(p_note, '')), 1000);
  if length(v_note) < 3 then return 'error:note_required'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where id = v_v.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_v.status = 'declined' and v_v.contractor_declined_at is not null then return 'ok:already'; end if;
  if v_v.credit then return 'error:credit_not_declinable'; end if;
  if v_v.status <> 'customer_approved' or v_v.customer_responded_at is null then return 'error:customer_not_approved'; end if;
  if v_v.released_at is null then return 'error:not_released'; end if;

  update public.wo_variations
     set status = 'declined', declined_at = now(), declined_reason = v_note,
         contractor_declined_at = now(), contractor_decline_note = v_note
   where id = p_variation_id;

  -- The approval put rows on the tick list (20270193); the ones nobody started go.
  with gone as (
    delete from public.wo_surfaces
     where work_order_id = v_v.work_order_id and added_by_variation = p_variation_id and state = 'todo'
    returning id
  ) select count(*) into v_removed from gone;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_declined', auth.uid(), v_kind,
            jsonb_build_object('variation_id', p_variation_id, 'note', v_note,
                               'hours', v_v.est_hours, 'contractor_delta_cents', v_v.contractor_delta_cents,
                               'tick_rows_removed', v_removed));
  return 'ok:declined';
end $$;
grant execute on function public.wo_contractor_decline_variation(uuid, text) to authenticated;

-- ---- 2. nothing to check is nothing in the way ------------------------------------
create or replace function public.wo_qa_route_passed(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_total integer; v_open integer; v_r text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or public.wo_is_system()
          or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;

  if v_wo.stage is distinct from 'qa' then return 'ok:0'; end if;

  select count(*) into v_total
    from public.wo_qa_checks where work_order_id = p_work_order_id;
  v_open := public.wo_qa_open_count(p_work_order_id);
  if v_open > 0 then return 'ok:0'; end if;
  -- Tom, 7 Oct 2026 (25 Bunney Road): a job parked at the check stage with
  -- NO check on it used to answer ok:0 for ever — the checks had been turned
  -- off or removed after the job arrived here, and nothing could move it.
  -- Nothing to check is nothing in the way: it routes the way a pass does.

  if not coalesce(v_wo.walkthrough_required, true) then
    v_r := public.wo_close_without_walkthrough(p_work_order_id);
    if v_r not like 'ok:%' then return v_r; end if;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'qa_passed_routed', auth.uid(),
              case when public.is_staff() then 'staff'
                   when public.wo_is_system() then 'system'
                   else 'contractor' end,
              jsonb_build_object('checks', v_total, 'to', 'closed', 'none_scheduled', v_total = 0));
    return 'ok:closed';
  end if;

  v_r := public.wo_deliver_evidence_pack(p_work_order_id);
  if v_r not like 'ok:%' then return v_r; end if;
  perform public.wo_generate_report_draft(p_work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_passed_routed', auth.uid(),
            case when public.is_staff() then 'staff'
                 when public.wo_is_system() then 'system'
                 else 'contractor' end,
            jsonb_build_object('checks', v_total, 'none_scheduled', v_total = 0));
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_qa_route_passed(uuid) to authenticated, service_role;

-- ---- 3. client-update notes ---------------------------------------------------------
create or replace function public.wo_add_client_update_note(p_work_order_id uuid, p_body text)
returns text language plpgsql security definer set search_path = public as $$
declare v_body text; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  v_body := left(trim(coalesce(p_body, '')), 2000);
  if length(v_body) < 2 then return 'error:empty'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'client_update_note', auth.uid(), 'staff', jsonb_build_object('body', v_body))
    returning id into v_id;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_add_client_update_note(uuid, text) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wo_variations'
     and column_name in ('contractor_declined_at', 'contractor_decline_note')) as decline_columns, 2 as _expect_decline_columns,
  (select prosrc like '%variation_sent_to_painter%' from pg_proc where proname = 'wo_customer_sign_variation') as sign_asks_painter, true as _expect_sign_asks_painter,
  (select has_function_privilege('anon', 'public.wo_customer_sign_variation(text, text, text)', 'execute')) as anon_can_sign, true as _expect_anon_can_sign,
  (select has_function_privilege('authenticated', 'public.wo_contractor_decline_variation(uuid, text)', 'execute')) as decline_granted, true as _expect_decline_granted,
  (select prosrc like '%none_scheduled%' from pg_proc where proname = 'wo_qa_route_passed') as qa_routes_no_checks, true as _expect_qa_routes_no_checks,
  (select has_function_privilege('service_role', 'public.wo_qa_route_passed(uuid)', 'execute')) as qa_route_system_granted, true as _expect_qa_route_system_granted,
  (select has_function_privilege('authenticated', 'public.wo_add_client_update_note(uuid, text)', 'execute')) as note_granted, true as _expect_note_granted;

insert into public._prod_migrations(name) values ('20270220000000_variation_painter_approval_qa_route_client_notes.sql') on conflict (name) do nothing;

-- =============================================================================
-- Invoice-builder addendum A2 — revision-drafted variations.
--
-- QuoteBuilder mode "revision" edits the working scope; the server action
-- diffs it against the accepted scope through lib/pricing and drafts each net
-- change here. One RPC per change, all guarantees in the database:
--
-- * ONE live draft per change: revision_block_ref ties a draft to the block it
--   came from; re-drafting after another edit UPDATES the same row (token and
--   all) instead of littering; a change that nets back to zero CANCELS it. The
--   partial unique index makes the one-draft rule a constraint, not a hope.
-- * The contractor's money is computed HERE (hours × settings rate, stamped),
--   exactly as wo_price_variation does — the action sends hours, never cents.
-- * Zero site-work variations (hours = 0) skip the contractor entirely
--   (ruling 3): on signing they advance straight to contractor_accepted so the
--   stage gate never waits on an accept nobody needs to give.
-- =============================================================================

alter table public.wo_variations
  add column if not exists revision_block_ref text;

create unique index if not exists wo_variations_revision_draft_uidx
  on public.wo_variations (work_order_id, revision_block_ref)
  where status = 'priced' and revision_block_ref is not null;

-- ---- drafting (staff, from the revision builder's server action) ------------

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

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

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

-- Staff can retire a pending draft explicitly (customer never saw it, or the
-- office thought better of it). Signed variations are untouchable here.
create or replace function public.wo_cancel_variation_draft(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status <> 'priced' then return 'error:already_' || v_v.status::text; end if;

  update public.wo_variations set status = 'cancelled' where id = p_variation_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_cancelled', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id));
  return 'ok:cancelled';
end $$;
grant execute on function public.wo_cancel_variation_draft(uuid) to authenticated;

-- ---- signing: zero-site-work variations skip the contractor -----------------
-- 20261116 body verbatim + the no-site-work auto-advance at the end.

create or replace function public.wo_customer_sign_variation(
  p_token text, p_name text, p_signature text
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
        v_started integer := 0; v_struck integer := 0; v_manual boolean;
begin
  select * into v_v from public.wo_variations where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status <> 'priced' then return 'error:already_' || v_v.status::text; end if;

  if coalesce(trim(p_name), '') = '' then return 'error:name_required'; end if;
  if p_signature is null
     or p_signature not like 'data:image/png;base64,%'
     or length(p_signature) < 100 then
    return 'error:signature_required';
  end if;
  if length(p_signature) > 400000 then return 'error:signature_too_big'; end if;

  update public.wo_variations
     set status = 'customer_approved', customer_responded_at = now(),
         signed_name = trim(p_name), signature = p_signature, signed_at = now()
   where id = v_v.id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (v_v.work_order_id, 'variation_customer_approved', 'customer',
            jsonb_build_object('variation_id', v_v.id, 'price_cents', v_v.price_cents,
                               'credit', v_v.credit, 'signed', true,
                               'signed_name', trim(p_name)));

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
    select coalesce(public.wo_loop_setting(array['variationRelease']) = '"auto"'::jsonb, false) into v_auto;
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

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- ---- Verification (read this back after running) ----------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'wo_variations' and column_name = 'revision_block_ref') as block_ref_col_1,
  (select count(*) from pg_indexes
    where indexname = 'wo_variations_revision_draft_uidx') as draft_uidx_1,
  (select count(*) from pg_proc where proname in
    ('wo_draft_revision_variation', 'wo_cancel_variation_draft')) as new_fns_2,
  (select prosrc like '%variation_no_site_work%' from pg_proc
    where proname = 'wo_customer_sign_variation' limit 1) as sign_skips_contractor;

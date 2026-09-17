-- Tom, 17 Sep 2026: "allow for pc command to confirm a variation on behalf of
-- the customer with verbal approval, which sends a confirmation to the
-- customer of the approved variation."
--
-- 1. wo_variations gains verbal_confirmed_by / verbal_confirmed_at /
--    verbal_note. `signed_name` carries the name of the person who gave the
--    approval (same column the /v page and the console already read), the
--    drawn `signature` stays NULL — that difference is what marks a verbal
--    approval, and verbal_confirmed_at says when and who recorded it.
-- 2. wo_variation_apply_approval: the credit strike / auto-release arm that
--    used to live inline in wo_customer_sign_variation, extracted so the two
--    approval paths cannot drift. Returns whether it released.
-- 3. wo_customer_sign_variation: same checks, same result, body now calls
--    the helper.
-- 4. wo_staff_confirm_variation: staff-only, priced-only, name required.
--    Lands at customer_approved exactly as a signature would, stamped as
--    verbal, one wo_events row with actor_kind 'staff' and meta.verbal = true.
--    Returns 'ok:approved' or 'ok:approved_released'.
-- 5. wo_variation_by_token gains verbal_confirmed_at so /v can say "approved
--    by phone" instead of "signed by". Return type changes → drop first.

-- ---- 1. columns -------------------------------------------------------------
alter table public.wo_variations
  add column if not exists verbal_confirmed_by uuid references auth.users (id) on delete set null,
  add column if not exists verbal_confirmed_at timestamptz,
  add column if not exists verbal_note text not null default '';

comment on column public.wo_variations.verbal_confirmed_at is
  'Set when the office recorded the customer''s verbal approval (wo_staff_confirm_variation). signature is NULL on these rows; signed_name holds who gave the approval.';

-- ---- 2. the shared post-approval arm --------------------------------------
create or replace function public.wo_variation_apply_approval(p_variation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
        v_started integer := 0; v_struck integer := 0;
begin
  select * into v_v from public.wo_variations where id = p_variation_id;
  if not found then return false; end if;

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
    return false;
  end if;

  -- Additions: a human between the two money events unless the setting says auto.
  select coalesce(public.wo_loop_setting(array['variationRelease']) = '"auto"'::jsonb, false) into v_auto;
  if v_auto then
    update public.wo_variations set released_at = now() where id = v_v.id;
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'variation_released', 'system',
              jsonb_build_object('variation_id', v_v.id, 'auto', true));
    return true;
  end if;
  return false;
end $$;
revoke execute on function public.wo_variation_apply_approval(uuid) from public, anon, authenticated;

-- ---- 3. the customer's signature, unchanged in behaviour -------------------
create or replace function public.wo_customer_sign_variation(
  p_token text, p_name text, p_signature text
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
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

  perform public.wo_variation_apply_approval(v_v.id);
  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- ---- 4. the office records a verbal approval --------------------------------
create or replace function public.wo_staff_confirm_variation(
  p_variation_id uuid, p_confirmed_with text, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_released boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  -- Only a PRICED variation can be approved: the customer must have been told
  -- the figure they are agreeing to. raised → 'not_priced', anything after →
  -- 'already_<status>', the same wording the signature path uses.
  if v_v.status = 'raised' then return 'error:not_priced'; end if;
  if v_v.status <> 'priced' then return 'error:already_' || v_v.status::text; end if;
  if coalesce(trim(p_confirmed_with), '') = '' then return 'error:name_required'; end if;

  update public.wo_variations
     set status = 'customer_approved', customer_responded_at = now(),
         signed_name = trim(p_confirmed_with), signature = null, signed_at = null,
         verbal_confirmed_by = auth.uid(), verbal_confirmed_at = now(),
         verbal_note = coalesce(trim(p_note), ''),
         override = true
   where id = v_v.id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_customer_approved', auth.uid(), 'staff',
            jsonb_build_object('variation_id', v_v.id, 'price_cents', v_v.price_cents,
                               'credit', v_v.credit, 'signed', false, 'verbal', true,
                               'signed_name', trim(p_confirmed_with),
                               'note', coalesce(trim(p_note), '')));

  v_released := public.wo_variation_apply_approval(v_v.id);
  return case when v_released then 'ok:approved_released' else 'ok:approved' end;
end $$;
grant execute on function public.wo_staff_confirm_variation(uuid, text, text) to authenticated;

-- ---- 5. the customer's page learns the difference ---------------------------
drop function if exists public.wo_variation_by_token(text);
create function public.wo_variation_by_token(p_token text)
returns table (id uuid, wo_ref text, category text, comment text, price_cents integer,
               status public.wo_variation_status, job_title text, photo_count integer,
               credit boolean, priced_lines jsonb, signed_name text, signed_at timestamptz,
               adjusted_contract_cents bigint, estimate_token text,
               verbal_confirmed_at timestamptz)
language sql security definer set search_path = public as $$
  select v.id, w.wo_ref, v.category, v.comment, v.price_cents, v.status,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         (select count(*)::integer from public.wo_photos p where p.variation_id = v.id),
         v.credit, v.priced_lines, v.signed_name, v.signed_at,
         (select l.adjusted_contract_cents from public.invoice_ledger(w.estimate_id) l),
         (select e.share_token from public.estimates e where e.id = w.estimate_id),
         v.verbal_confirmed_at
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where v.customer_token = p_token
     and v.status in ('priced', 'customer_approved', 'contractor_accepted', 'declined')
   limit 1;
$$;
grant execute on function public.wo_variation_by_token(text) to anon, authenticated;

-- ---- read this back ----------------------------------------------------------
-- Expect FOUR function rows (apply_approval, customer_sign, staff_confirm,
-- by_token) and THREE column rows. Fewer means the tail did not apply.
select 'function' as what, p.proname as name, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_variation_apply_approval', 'wo_customer_sign_variation',
                     'wo_staff_confirm_variation', 'wo_variation_by_token')
union all
select 'column', column_name, null
  from information_schema.columns
 where table_schema = 'public' and table_name = 'wo_variations'
   and column_name in ('verbal_confirmed_by', 'verbal_confirmed_at', 'verbal_note')
 order by 1, 2;

insert into public._prod_migrations(name) values ('20270158000000_variation_verbal_confirm.sql') on conflict (name) do nothing;

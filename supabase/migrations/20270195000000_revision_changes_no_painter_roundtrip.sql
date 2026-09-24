-- =============================================================================
-- A revision change the customer signed is on the painter's job — no accept
-- round trip (Tom, 24 Sep 2026: "if we send a variation from the revision
-- working scope and the client approves, it currently wants to send the job
-- to the contractor for their approval and then back to the customer again").
--
-- 20270192 folded a signed revision change straight in when NOBODY was on
-- the job; with a painter it went release → the painter's accept. Now a
-- change from the revision working scope (revision_block_ref set) folds in
-- either way: contractor_accepted at the signature, on the sheet and the tick
-- list (20270193), in the pay (wo_contractor_variations_cents). The painter
-- is told by text (contractor_variation_added). Painter-RAISED variations
-- keep release → accept — they asked for the change and confirm the figure.
-- A removal that hit started work still waits on the PC's deduction.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

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
    if not v_painter or v_v.revision_block_ref is not null then
      select status, needs_manual_deduction into v_status, v_manual
        from public.wo_variations where id = v_v.id;
      if v_status = 'customer_approved' and not coalesce(v_manual, false) then
        update public.wo_variations
           set status = 'contractor_accepted', contractor_accepted_at = now(),
               released_at = coalesce(released_at, now())
         where id = v_v.id;
        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_v.work_order_id,
                  case when v_painter then 'variation_added_to_job' else 'variation_folded_into_offer' end,
                  'system',
                  jsonb_build_object('variation_id', v_v.id, 'hours', v_v.est_hours,
                                     'credit', v_v.credit, 'painter_on_job', v_painter,
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

-- ---- read-back ---------------------------------------------------------------
select
  (select prosrc like '%variation_added_to_job%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_customer_sign_variation') as sign_folds_revision_changes, true as _expect_sign_folds_revision_changes,
  (select has_function_privilege('anon', 'public.wo_customer_sign_variation(text, text, text)', 'execute')) as anon_can_sign, true as _expect_anon_can_sign;

insert into public._prod_migrations(name) values ('20270195000000_revision_changes_no_painter_roundtrip.sql') on conflict (name) do nothing;

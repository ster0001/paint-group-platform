-- =============================================================================
-- WO completion loop, step 3 — variations, both-sided
--
-- The flow, and the order is the whole point:
--   contractor raises (category + comment + PHOTOS, hours optional)
--     -> office prices it through lib/pricing
--       -> customer approves it as a mini-estimate on a token link
--         -> contractor one-taps the adjusted offer
--           -> only now may the work happen
--
-- Two rules this file exists to make unbreakable:
--
-- 1. NOTHING reaches contractor_accepted without BOTH approvals recorded. The
--    customer's yes and the contractor's yes are separate columns, each written
--    by its own RPC, and the accept refuses unless the customer's is already
--    there. Both write events.
--
-- 2. THE CONTRACTOR'S MONEY IS COMPUTED HERE, from the settings rate × hours.
--    It is never accepted from a caller. Change "Contractor rate" in Settings
--    and the next variation prices at the new rate with no code change — which
--    is also why the rate is read at pricing time and stamped onto the row, so
--    an already-approved variation cannot silently reprice underneath anyone.
--
-- The customer price DOES arrive from the server action, because lib/pricing is
-- TypeScript and cannot be called from SQL. That is the same boundary the rest
-- of the app uses: the BROWSER never computes money, a server action does, and
-- the inputs are stored alongside the output so any figure can be recomputed
-- and audited later.
-- =============================================================================

alter table public.wo_photos
  add column if not exists variation_id uuid references public.wo_variations (id) on delete set null;
create index if not exists wo_photos_variation_idx on public.wo_photos (variation_id);

alter table public.wo_variations
  add column if not exists priced_inputs jsonb,        -- what was fed to the engine
  add column if not exists contractor_rate_cents integer,  -- the rate used, stamped
  add column if not exists released_at timestamptz,    -- PC released the adjusted offer
  add column if not exists released_by uuid references auth.users (id) on delete set null;

-- ---- helpers ----------------------------------------------------------------
create or replace function public.wo_contractor_rate_cents()
returns integer language sql stable set search_path = public as $$
  -- Settings hold dollars; everything downstream is integer cents.
  select coalesce(((value->>'value')::numeric * 100)::integer, 6000)
    from public.settings where key = 'Contractor rate';
$$;

create or replace function public.wo_loop_setting(p_path text[])
returns jsonb language sql stable set search_path = public as $$
  select value #> p_path from public.settings where key = 'wo_loop';
$$;

-- ---- 1. the contractor raises it -------------------------------------------
-- Photos are not optional. The RPC takes the ids of photos already uploaded
-- against this job and links them; passing none is refused, because a variation
-- without evidence is the thing that becomes an argument three months later.
create or replace function public.wo_raise_variation(
  p_work_order_id uuid, p_category text, p_comment text,
  p_photo_ids uuid[], p_est_hours numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_id uuid; v_photos integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if coalesce(trim(p_category), '') = '' then return 'error:no_category'; end if;
  if coalesce(trim(p_comment), '') = '' then return 'error:no_comment'; end if;
  if p_est_hours is not null and p_est_hours <= 0 then return 'error:bad_hours'; end if;

  select count(*) into v_photos
    from public.wo_photos
   where id = any (coalesce(p_photo_ids, '{}'::uuid[]))
     and work_order_id = p_work_order_id;
  if v_photos = 0 then return 'error:photos_required'; end if;

  insert into public.wo_variations
      (work_order_id, raised_by, raised_kind, override, category, comment, est_hours, status)
    values (p_work_order_id, auth.uid(), v_kind,
            -- A PC-entered variation is a verbal approval being written down.
            -- It still travels the whole flow; it is just marked for what it is.
            v_kind = 'staff', trim(p_category), trim(p_comment), p_est_hours, 'raised')
    returning id into v_id;

  update public.wo_photos
     set variation_id = v_id, kind = 'variation'
   where id = any (p_photo_ids) and work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'variation_raised', auth.uid(), v_kind,
            jsonb_build_object('variation_id', v_id, 'category', trim(p_category),
                               'est_hours', p_est_hours, 'photos', v_photos,
                               'override', v_kind = 'staff'));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_raise_variation(uuid, text, text, uuid[], numeric) to authenticated;

-- ---- 2. the office prices it ------------------------------------------------
-- p_price_cents is the engine's output, computed by the server action that
-- called lib/pricing; p_inputs is what it was given. The contractor's side is
-- computed HERE and cannot be supplied.
create or replace function public.wo_price_variation(
  p_variation_id uuid, p_price_cents integer, p_inputs jsonb,
  p_priced_lines jsonb, p_hours numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_rate integer; v_delta integer; v_token text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status not in ('raised', 'priced') then return 'error:already_' || v_v.status::text; end if;
  if p_price_cents is null or p_price_cents < 0 then return 'error:bad_price'; end if;
  if p_hours is null or p_hours <= 0 then return 'error:bad_hours'; end if;

  v_rate  := public.wo_contractor_rate_cents();
  v_delta := round(p_hours * v_rate)::integer;
  v_token := coalesce(v_v.customer_token,
                      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

  update public.wo_variations
     set status = 'priced',
         price_cents = p_price_cents,
         priced_inputs = p_inputs,
         priced_lines = p_priced_lines,
         est_hours = p_hours,
         contractor_rate_cents = v_rate,
         contractor_delta_cents = v_delta,
         customer_token = v_token
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_priced', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id, 'price_cents', p_price_cents,
                               'hours', p_hours, 'contractor_rate_cents', v_rate,
                               'contractor_delta_cents', v_delta));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_price_variation(uuid, integer, jsonb, jsonb, numeric) to authenticated;

-- ---- 3. the customer answers, on a token link -------------------------------
-- Token-only, like the quote. No id in the URL, and an unknown token is simply
-- not found — the route turns that into a 404, never a 403.
create or replace function public.wo_variation_by_token(p_token text)
returns table (id uuid, wo_ref text, category text, comment text, price_cents integer,
               status public.wo_variation_status, job_title text, photo_count integer)
language sql security definer set search_path = public as $$
  select v.id, w.wo_ref, v.category, v.comment, v.price_cents, v.status,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         (select count(*)::integer from public.wo_photos p where p.variation_id = v.id)
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where v.customer_token = p_token
     and v.status in ('priced', 'customer_approved', 'contractor_accepted', 'declined')
   limit 1;
$$;
grant execute on function public.wo_variation_by_token(text) to anon, authenticated;

create or replace function public.wo_customer_respond_variation(
  p_token text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
begin
  select * into v_v from public.wo_variations where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status <> 'priced' then return 'error:already_' || v_v.status::text; end if;

  if not p_approve then
    -- Declined variations are KEPT, never deleted: they appear on the completion
    -- report as raised-and-declined, which is what protects the job later.
    update public.wo_variations
       set status = 'declined', customer_responded_at = now(),
           declined_reason = coalesce(p_note, '')
     where id = v_v.id;

    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'variation_declined', 'customer',
              jsonb_build_object('variation_id', v_v.id, 'note', coalesce(p_note, '')));
    return 'ok:declined';
  end if;

  update public.wo_variations
     set status = 'customer_approved', customer_responded_at = now()
   where id = v_v.id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (v_v.work_order_id, 'variation_customer_approved', 'customer',
            jsonb_build_object('variation_id', v_v.id, 'price_cents', v_v.price_cents));

  -- ⚑2: a human between the two money events by default. With the setting on
  -- 'auto' the adjusted offer releases itself the moment the customer says yes.
  select coalesce(public.wo_loop_setting(array['variationRelease']) = '"auto"'::jsonb, false) into v_auto;
  if v_auto then
    update public.wo_variations set released_at = now() where id = v_v.id;
    insert into public.wo_events (work_order_id, type, actor_kind, meta)
      values (v_v.work_order_id, 'variation_released', 'system',
              jsonb_build_object('variation_id', v_v.id, 'auto', true));
  end if;

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_respond_variation(text, boolean, text) to anon, authenticated;

-- ---- 4. the PC releases the adjusted offer (default path) -------------------
create or replace function public.wo_release_variation(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status <> 'customer_approved' then return 'error:not_approved'; end if;
  if v_v.released_at is not null then return 'ok:already'; end if;

  update public.wo_variations set released_at = now(), released_by = auth.uid() where id = p_variation_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_released', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id, 'auto', false));
  return 'ok:released';
end $$;
grant execute on function public.wo_release_variation(uuid) to authenticated;

-- ---- 5. the contractor accepts the adjusted offer ---------------------------
-- The gate that matters: the customer's approval must already be recorded.
create or replace function public.wo_contractor_accept_variation(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_wo public.work_orders%rowtype; v_cid uuid;
begin
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where id = v_v.work_order_id;

  v_cid := public.current_contractor_id();
  if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;

  -- Both approvals, in order, or nothing.
  if v_v.status <> 'customer_approved' or v_v.customer_responded_at is null then
    return 'error:customer_not_approved';
  end if;
  if v_v.released_at is null then return 'error:not_released'; end if;

  update public.wo_variations
     set status = 'contractor_accepted', contractor_accepted_at = now()
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_accepted', auth.uid(), 'contractor',
            jsonb_build_object('variation_id', p_variation_id,
                               'contractor_delta_cents', v_v.contractor_delta_cents,
                               'hours', v_v.est_hours));

  return 'ok:accepted';
end $$;
grant execute on function public.wo_contractor_accept_variation(uuid) to authenticated;

-- ---- 6. the gate ------------------------------------------------------------
-- A job cannot leave in_progress while a variation is still waiting on someone.
create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer;
begin
  if p_from = 'in_progress' and p_to in ('qa', 'completion_prep') then
    select count(*), count(*) filter (where state = 'done')
      into v_total, v_done
      from public.wo_surfaces where work_order_id = p_wo_id;
    if v_total > 0 and v_done < v_total then
      return (v_total - v_done)::text || ' of ' || v_total::text || ' surfaces still to tick off';
    end if;
  end if;

  -- Any forward move: an open variation is an unfinished money conversation.
  if p_to <> 'in_progress' and p_to <> 'offered' then
    select count(*) into v_waiting
      from public.wo_variations
     where work_order_id = p_wo_id
       and status in ('raised', 'priced', 'customer_approved');
    if v_waiting > 0 then
      return v_waiting::text || ' variation' || case when v_waiting = 1 then '' else 's' end
             || ' still waiting on a decision';
    end if;
  end if;

  -- step 5 fills: qa -> completion_prep   (all due checks passed)
  --              completion_prep -> walkthrough (prep checklist ticked)
  --              walkthrough -> closed     (every area approved + signed)
  return null;
end $$;

-- ---- Verification -----------------------------------------------------------
--   select public.wo_raise_variation('<wo>', 'rot', 'Three boards gone', '{}');
--     -> 'error:photos_required'
-- After pricing at 3 hours with Settings "Contractor rate" = 60:
--   select est_hours, contractor_rate_cents, contractor_delta_cents from wo_variations …
--     -> 3.00 | 6000 | 18000        (and 18000 = 3 × 6000, computed in the DB)
-- As the contractor, before the customer has answered:
--   select public.wo_contractor_accept_variation('<id>');
--     -> 'error:customer_not_approved'

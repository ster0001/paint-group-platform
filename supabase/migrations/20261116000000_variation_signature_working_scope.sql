-- =============================================================================
-- Invoice-builder addendum A1 — the drawn signature, the working scope, and
-- the strike/acknowledge machinery.
-- (docs/briefs/invoice-builder-addendum.md; Tom's rulings 24 Aug 2026, and the
--  four §4 flags ruled at their defaults in-session.)
--
-- What this file makes true:
--
-- 1. A variation is APPROVED only with a DRAWN signature. The new
--    wo_customer_sign_variation requires a name and a PNG data URL and stores
--    both with a timestamp; the old one-tap approve path in
--    wo_customer_respond_variation now refuses with error:signature_required.
--    Decline stays one tap — nobody has to sign to say no.
--
-- 2. The accepted estimate becomes DB-frozen, not just client-locked. A
--    trigger refuses any change to builder_state / sent_snapshot / the money
--    columns while status = 'accepted'. Post-acceptance edits belong on the
--    per-job WORKING SCOPE (wo_working_scopes), a clone of the accepted
--    builder_state that QuoteBuilder mode "revision" edits. The clone's
--    accepted_state is the diff baseline and is itself immutable.
--
-- 3. A signed CREDIT variation strikes its wo_surfaces rows — visible, marked
--    removed-from-scope, never deleted. Surfaces already prepped/done are
--    NEVER struck automatically: the variation is flagged
--    needs_manual_deduction and the card routes to the PC, who sets the
--    contractor deduction by hand (ruling 3 / the ⚑10 "deductions are never
--    automatic" rule). Untouched removals carry the engine-hours delta with
--    credit=true — the ≥0 check on contractor_delta_cents stays; credit flips
--    the sign wherever the figure is summed, exactly like the customer side.
--
-- 4. Acknowledge machinery: the contractor ACKNOWLEDGES a credit (scope owner
--    is the customer — no veto); additions keep the existing release → accept.
-- =============================================================================

-- ---- 0. a fresh database prices instead of nulling --------------------------
-- wo_contractor_rate_cents() defaulted to 6000 only when the settings ROW held
-- a null value; with no row at all (a fresh install — C1 found this) the
-- function returned NULL and wo_price_variation stamped a NULL delta. The
-- subselect makes "no row" and "null value" fall back the same way, matching
-- lib/pricing's TS default (60 $/hr).

create or replace function public.wo_contractor_rate_cents()
returns integer language sql stable set search_path = public as $$
  select coalesce((select ((value->>'value')::numeric * 100)::integer
                     from public.settings where key = 'Contractor rate'), 6000);
$$;

-- ---- 1. columns -------------------------------------------------------------

alter table public.wo_variations
  add column if not exists signed_name text,
  -- The signature image, a PNG data URL — same storage approach as
  -- estimates.accepted_signature (a text column, no bucket).
  add column if not exists signature text,
  add column if not exists signed_at timestamptz,
  -- The snapshot surface keys a scope change touches (set by the revision
  -- builder for removals; what the strike below matches on).
  add column if not exists surface_keys text[],
  add column if not exists contractor_acknowledged_at timestamptz,
  -- Ruling 3: work already started on removed scope → the deduction is set
  -- manually by the PC, never computed.
  add column if not exists needs_manual_deduction boolean not null default false,
  add column if not exists deduction_cents integer
    check (deduction_cents is null or deduction_cents >= 0),
  add column if not exists deduction_note text not null default '',
  add column if not exists deduction_set_by uuid references auth.users (id) on delete set null,
  add column if not exists deduction_set_at timestamptz;

alter table public.wo_surfaces
  add column if not exists removed_from_scope boolean not null default false,
  add column if not exists removed_by_variation uuid
    references public.wo_variations (id) on delete set null;

create index if not exists wo_surfaces_removed_idx
  on public.wo_surfaces (work_order_id) where removed_from_scope;

-- ---- 2. the working scope ---------------------------------------------------
-- One row per job. accepted_state is the byte-copy of builder_state taken at
-- first open — the diff baseline — and is never updated; working_state is what
-- the revision builder edits. Writes go through the two RPCs only.

create table if not exists public.wo_working_scopes (
  work_order_id uuid primary key references public.work_orders (id) on delete cascade,
  estimate_id   uuid not null unique references public.estimates (id) on delete cascade,
  accepted_state jsonb not null,
  working_state  jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wo_working_scopes enable row level security;

drop policy if exists wo_working_scopes_staff_read on public.wo_working_scopes;
create policy wo_working_scopes_staff_read on public.wo_working_scopes
  for select to authenticated using (public.is_staff());

grant select on public.wo_working_scopes to authenticated;

-- The baseline cannot drift, even through a future buggy RPC.
create or replace function public.wo_working_scope_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.accepted_state is distinct from old.accepted_state
     and current_user <> 'service_role' then
    raise exception 'wo_working_scopes.accepted_state is the frozen diff baseline';
  end if;
  return new;
end $$;

drop trigger if exists wo_working_scopes_baseline on public.wo_working_scopes;
create trigger wo_working_scopes_baseline
  before update on public.wo_working_scopes
  for each row execute function public.wo_working_scope_guard();

create or replace function public.wo_open_working_scope(p_estimate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.estimates%rowtype; v_wo uuid; v_row public.wo_working_scopes%rowtype;
        v_created boolean := false;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'not_staff'); end if;

  select * into v_e from public.estimates where id = p_estimate_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_e.status <> 'accepted' then return jsonb_build_object('error', 'not_accepted'); end if;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  if v_wo is null then return jsonb_build_object('error', 'no_work_order'); end if;

  select * into v_row from public.wo_working_scopes where estimate_id = p_estimate_id;
  if not found then
    insert into public.wo_working_scopes (work_order_id, estimate_id, accepted_state, working_state)
      values (v_wo, p_estimate_id,
              coalesce(v_e.builder_state, '{}'::jsonb),
              coalesce(v_e.builder_state, '{}'::jsonb))
      returning * into v_row;
    v_created := true;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_wo, 'working_scope_opened', auth.uid(), 'staff',
              jsonb_build_object('estimate_id', p_estimate_id));
  end if;

  return jsonb_build_object(
    'created', v_created,
    'work_order_id', v_row.work_order_id,
    'accepted_state', v_row.accepted_state,
    'working_state', v_row.working_state,
    'updated_at', v_row.updated_at);
end $$;
grant execute on function public.wo_open_working_scope(uuid) to authenticated;

create or replace function public.wo_save_working_scope(p_estimate_id uuid, p_state jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then return 'error:bad_state'; end if;

  update public.wo_working_scopes
     set working_state = p_state, updated_at = now()
   where estimate_id = p_estimate_id;
  if not found then return 'error:not_found'; end if;

  return 'ok';
end $$;
grant execute on function public.wo_save_working_scope(uuid, jsonb) to authenticated;

-- ---- 3. the accepted estimate is frozen at the database ---------------------
-- Until now "byte-frozen" was a client-side `locked` flag; authenticated still
-- held UPDATE on builder_state. This closes it. Columns that legitimately move
-- after acceptance (viewed_at, accepted_signature) are untouched by the guard.
-- service_role stays exempt for e2e teardown and admin repairs.

create or replace function public.estimate_frozen_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'accepted' and current_user <> 'service_role' then
    if new.builder_state is distinct from old.builder_state
       or new.sent_snapshot is distinct from old.sent_snapshot
       or new.subtotal_cents is distinct from old.subtotal_cents
       or new.total_cents is distinct from old.total_cents
       or new.accepted_total_cents is distinct from old.accepted_total_cents
       or new.selected_options is distinct from old.selected_options then
      raise exception 'accepted estimate is frozen — revisions belong on the working scope';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists estimates_frozen on public.estimates;
create trigger estimates_frozen
  before update on public.estimates
  for each row execute function public.estimate_frozen_guard();

-- ---- 4. approval now requires the drawn signature ---------------------------
-- The signing RPC. Same token gate as the old approve, plus: a non-empty name,
-- a PNG data URL of plausible size. On a credit it performs the strike and the
-- started-work routing in the SAME transaction as the approval — the ledger
-- move and the scope consequence are never split.

create or replace function public.wo_customer_sign_variation(
  p_token text, p_name text, p_signature text
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_auto boolean;
        v_started integer := 0; v_struck integer := 0;
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

  return 'ok:approved';
end $$;
grant execute on function public.wo_customer_sign_variation(text, text, text) to anon, authenticated;

-- The old respond RPC keeps decline exactly as it was; the approve arm now
-- refuses so no caller can approve without a signature. Same argument list —
-- replaced in place, no second overload left behind.
create or replace function public.wo_customer_respond_variation(
  p_token text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  select * into v_v from public.wo_variations where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_v.status <> 'priced' then return 'error:already_' || v_v.status::text; end if;

  if p_approve then
    -- Ruling 1 (24 Aug): the customer SIGNS every variation.
    return 'error:signature_required';
  end if;

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
end $$;
grant execute on function public.wo_customer_respond_variation(text, boolean, text) to anon, authenticated;

-- The token read gains what the signing page needs: the credit flag, the
-- engine's line detail, the signed record, and the job's current adjusted
-- contract so the page can show old → new. Return type changes, so drop first
-- (exact signature — no overload ghosts).
drop function if exists public.wo_variation_by_token(text);
create function public.wo_variation_by_token(p_token text)
returns table (id uuid, wo_ref text, category text, comment text, price_cents integer,
               status public.wo_variation_status, job_title text, photo_count integer,
               credit boolean, priced_lines jsonb, signed_name text, signed_at timestamptz,
               adjusted_contract_cents bigint)
language sql security definer set search_path = public as $$
  select v.id, w.wo_ref, v.category, v.comment, v.price_cents, v.status,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         (select count(*)::integer from public.wo_photos p where p.variation_id = v.id),
         v.credit, v.priced_lines, v.signed_name, v.signed_at,
         (select l.adjusted_contract_cents from public.invoice_ledger(w.estimate_id) l)
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where v.customer_token = p_token
     and v.status in ('priced', 'customer_approved', 'contractor_accepted', 'declined')
   limit 1;
$$;
grant execute on function public.wo_variation_by_token(text) to anon, authenticated;

-- ---- 5. the contractor side of a credit -------------------------------------
-- Acknowledge, not accept: the scope belongs to the customer. Available only
-- when the deduction is computed (not routed to the PC). Terminal state is the
-- same contractor_accepted the ledger already counts.

create or replace function public.wo_contractor_acknowledge_variation(p_variation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_wo public.work_orders%rowtype; v_cid uuid;
begin
  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where id = v_v.work_order_id;

  v_cid := public.current_contractor_id();
  if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;

  if not v_v.credit then return 'error:not_a_credit'; end if;
  if v_v.status <> 'customer_approved' or v_v.customer_responded_at is null then
    return 'error:customer_not_approved';
  end if;
  if v_v.needs_manual_deduction and v_v.deduction_cents is null then
    return 'error:awaiting_pc_deduction';
  end if;

  update public.wo_variations
     set status = 'contractor_accepted',
         contractor_accepted_at = now(),
         contractor_acknowledged_at = now()
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_contractor_acknowledged', auth.uid(), 'contractor',
            jsonb_build_object('variation_id', p_variation_id,
                               'contractor_delta_cents', v_v.contractor_delta_cents,
                               'deduction_cents', v_v.deduction_cents,
                               'hours', v_v.est_hours));
  return 'ok:acknowledged';
end $$;
grant execute on function public.wo_contractor_acknowledge_variation(uuid) to authenticated;

-- The PC sets the manual deduction (ruling 3). Setting it completes the
-- variation — the contractor sees the figure on their job page and again
-- before their invoice submits; they are informed, not asked.
create or replace function public.wo_set_variation_deduction(
  p_variation_id uuid, p_cents integer, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;
  if not v_v.credit then return 'error:not_a_credit'; end if;
  if v_v.status not in ('customer_approved', 'contractor_accepted') then
    return 'error:not_approved';
  end if;
  if p_cents is null or p_cents < 0 then return 'error:bad_amount'; end if;

  update public.wo_variations
     set deduction_cents = p_cents,
         deduction_note = coalesce(trim(p_note), ''),
         deduction_set_by = auth.uid(),
         deduction_set_at = now(),
         status = 'contractor_accepted',
         contractor_accepted_at = coalesce(contractor_accepted_at, now())
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_deduction_set', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id, 'deduction_cents', p_cents,
                               'note', coalesce(trim(p_note), '')));
  return 'ok:set';
end $$;
grant execute on function public.wo_set_variation_deduction(uuid, integer, text) to authenticated;

-- ---- 6. struck surfaces leave the working set -------------------------------
-- wo_tick_surface: 20260930 body verbatim + the removed-from-scope refusal.

create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  -- Struck by a signed credit: display-only from here on.
  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  -- Ticking only makes sense while the job is being worked. QA fails and
  -- walkthrough flags both return the job to in_progress, which is exactly why
  -- rectification uses this same list rather than a parallel one.
  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- The gate: is anything on this elevation already under way?
  select not exists (
    select 1 from public.wo_surfaces
     where work_order_id = v_s.work_order_id and heading = v_s.heading and state <> 'todo'
  ) into v_first_tick;

  if v_first_tick and p_to <> 'todo'
     and not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
    return 'error:before_photo_required:' || v_s.heading;
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

-- wo_gate_blocked: 20261110 body verbatim + struck surfaces don't count toward
-- the tick gate (a struck row can never be ticked, so counting it would wedge
-- the job at in_progress forever).

create or replace function public.wo_gate_blocked(p_wo_id uuid, p_from public.wo_stage, p_to public.wo_stage)
returns text language plpgsql stable set search_path = public as $$
declare v_total integer; v_done integer; v_waiting integer; v_open integer; v_txt text;
begin
  if p_from = 'pre_start' and p_to = 'in_progress' then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'pre_start'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' pre-start item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  if p_from = 'in_progress' and p_to = 'completion_prep' then
    select count(*), count(*) filter (where state = 'done')
      into v_total, v_done from public.wo_surfaces
     where work_order_id = p_wo_id and not removed_from_scope;
    if v_total > 0 and v_done < v_total then
      return (v_total - v_done)::text || ' of ' || v_total::text || ' surfaces still to tick off';
    end if;
  end if;

  if p_to <> 'in_progress' and p_to <> 'offered' then
    select count(*) into v_waiting
      from public.wo_variations
     where work_order_id = p_wo_id and status in ('raised', 'priced', 'customer_approved');
    if v_waiting > 0 then
      return v_waiting::text || ' variation' || case when v_waiting = 1 then '' else 's' end
             || ' still waiting on a decision';
    end if;
  end if;

  -- Prep gates every exit: quality check, the pack, or straight to closed.
  if p_from = 'completion_prep' and p_to in ('qa', 'walkthrough', 'closed') then
    select count(*) into v_open
      from public.wo_checklist_items i
     where i.work_order_id = p_wo_id and i.phase = 'completion_prep'
       and i.required = true and not public.wo_checklist_done(i);
    if v_open > 0 then
      return v_open::text || ' completion item' || case when v_open = 1 then '' else 's' end
             || ' still to tick';
    end if;
  end if;

  -- Nobody walks around the quality check — not to the pack, not to closed.
  if p_to in ('walkthrough', 'closed') and p_from in ('completion_prep', 'qa') then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
    -- NEW (Tom, 23 Aug): colour-match codes before the hand-over.
    v_txt := public.wo_colour_match_outstanding(p_wo_id);
    if v_txt <> '' then
      return 'colour match codes still needed for ' || v_txt;
    end if;
  end if;

  -- The walkthrough → closed sign path keeps its own QA guard (was p_to = 'walkthrough' only).
  if p_to = 'walkthrough' and p_from = 'closed' then
    select count(*) into v_open
      from public.wo_qa_checks
     where work_order_id = p_wo_id and (result is null or result = 'fail');
    if v_open > 0 then
      return v_open::text || ' quality check' || case when v_open = 1 then '' else 's' end
             || ' still open';
    end if;
  end if;

  return null;
end $$;

-- wo_seed_surfaces: 20261001 body verbatim + a reseed never deletes a struck
-- row (it is evidence of the signed removal, todo or not).

create or replace function public.wo_seed_surfaces(p_work_order_id uuid, p_rows jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_upserted integer; v_removed integer; v_kept integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then return 'error:bad_rows'; end if;

  create temp table _seed on commit drop as
  select r->>'heading' as heading,
         coalesce(r->>'headingMeta', '') as heading_meta,
         r->>'label' as label,
         nullif(r->>'surfaceKey', '') as surface_key,
         coalesce((r->>'sort')::integer, 0) as sort
    from jsonb_array_elements(p_rows) r
   where nullif(r->>'heading', '') is not null
     and nullif(r->>'label', '') is not null;

  insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
  select p_work_order_id, heading, heading_meta, label, surface_key, sort from _seed
  on conflict (work_order_id, surface_key) where surface_key is not null
  do update set heading = excluded.heading,
                heading_meta = excluded.heading_meta,
                label = excluded.label,
                sort = excluded.sort;   -- state deliberately untouched
  get diagnostics v_upserted = row_count;

  -- Gone from the scope and never touched: drop it. A struck row is kept — it
  -- documents the signed removal.
  with dropped as (
    delete from public.wo_surfaces s
     where s.work_order_id = p_work_order_id
       and s.surface_key is not null
       and s.rectification = false
       and s.removed_from_scope = false
       and s.state = 'todo'
       and not exists (select 1 from _seed z where z.surface_key = s.surface_key)
    returning s.id
  )
  select count(*) into v_removed from dropped;

  -- Gone from the scope but already worked: kept, and said out loud.
  select count(*) into v_kept
    from public.wo_surfaces s
   where s.work_order_id = p_work_order_id
     and s.surface_key is not null
     and s.state <> 'todo'
     and not exists (select 1 from _seed z where z.surface_key = s.surface_key);

  if v_removed > 0 or v_kept > 0 then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'surfaces_reseeded', auth.uid(), 'staff',
              jsonb_build_object('removed', v_removed, 'kept_because_worked', v_kept));
  end if;

  return 'ok:' || v_upserted::text || ':removed=' || v_removed::text || ':kept=' || v_kept::text;
end $$;
grant execute on function public.wo_seed_surfaces(uuid, jsonb) to authenticated;

-- ---- Verification (read this back after running) ----------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'wo_variations'
      and column_name in ('signed_name','signature','signed_at','surface_keys',
                          'contractor_acknowledged_at','needs_manual_deduction',
                          'deduction_cents','deduction_note','deduction_set_by',
                          'deduction_set_at')) as variation_cols_10,
  (select count(*) from information_schema.columns
    where table_name = 'wo_surfaces'
      and column_name in ('removed_from_scope','removed_by_variation')) as surface_cols_2,
  (select count(*) from information_schema.tables
    where table_name = 'wo_working_scopes') as working_scope_table_1,
  (select count(*) from pg_trigger where tgname in ('estimates_frozen','wo_working_scopes_baseline')) as triggers_2,
  (select count(*) from pg_proc where proname in
    ('wo_customer_sign_variation','wo_contractor_acknowledge_variation',
     'wo_set_variation_deduction','wo_open_working_scope','wo_save_working_scope')) as new_fns_5,
  (select prosrc like '%signature_required%' from pg_proc
    where proname = 'wo_customer_respond_variation' limit 1) as respond_refuses_approve,
  (select prosrc like '%removed_from_scope%' from pg_proc
    where proname = 'wo_tick_surface' limit 1) as tick_refuses_struck,
  (select prosrc like '%not removed_from_scope%' from pg_proc
    where proname = 'wo_gate_blocked' limit 1) as gate_skips_struck,
  (select count(*) from pg_policies where tablename = 'wo_working_scopes') as ws_policies_1;

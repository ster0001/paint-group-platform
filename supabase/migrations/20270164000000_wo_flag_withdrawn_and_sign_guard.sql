-- Flag, then "Happy with this" straight after → sign-off must still work (Tom, 17 Sep 2026)
--
-- "After flagging an item in the work order, and then immediately ticking it
--  as I'm happy, I am unable to sign the job off."
--
-- Reproduced on the test project. The flag moved the job to In progress and
-- raised a RECTIFY row; the immediate approve overwrote the flag in the
-- sign-off's areas (so every area read approved) but left the job at In
-- progress with the rectify row open; wo_sign then wrote the signature, the
-- warranty, the report and both invoice drafts, `perform`ed the close, and
-- the machine refused it — in_progress → closed is not a transition — with
-- nobody listening. Result: a signed sign-off on a job that never closes.
--
-- Three things, one file:
--   1. A customer who changes their mind WITHDRAWS the flag. Approving an
--      area that carries a flag deletes the untouched rectify rows that flag
--      raised, marks the area flag_withdrawn_at, and — when nothing else is
--      open — returns the job from In progress to Walkthrough through a new,
--      gated transition. Rows a painter has already put right stay (they are
--      work done, and the report says so).
--   2. wo_sign refuses, in words, unless the job is AT walkthrough, before it
--      writes anything; and if the close is refused after all, it raises, so
--      the whole signature rolls back instead of half-landing.
--   3. Jobs already caught (signed sign-off, stage In progress) are put
--      through the same door and listed in the read-back.

-- ---- 1. the transition -----------------------------------------------------------
insert into public.wo_stage_transitions (from_stage, to_stage, label, actors) values
  ('in_progress', 'walkthrough', 'flag withdrawn — back to sign-off', array['system','staff','customer'])
on conflict (from_stage, to_stage) do update
  set label = excluded.label, actors = excluded.actors;

-- ---- 1b. approve / flag — BODY BASIS 20261028, the withdraw path added ---------------
create or replace function public.wo_walkthrough_area(
  p_token text, p_area text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_sort integer;
        v_prev jsonb; v_withdrawn boolean := false; v_open integer; v_todo integer; v_r text;
begin
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'error:already_signed'; end if;
  if coalesce(trim(p_area), '') = '' then return 'error:no_area'; end if;

  v_prev := coalesce(v_s.areas -> p_area, '{}'::jsonb);

  if p_approve and (v_prev ? 'flagged_at') and not (v_prev ? 'rectified_at') then
    -- A change of mind. The flag's own untouched rows go; anything the painter
    -- has already put right stays on the record.
    delete from public.wo_surfaces
     where work_order_id = v_s.work_order_id and rectification
       and heading = p_area and heading_meta = 'flagged at walkthrough'
       and state is distinct from 'done';
    v_withdrawn := true;
  end if;

  update public.wo_signoff
     set areas = areas || jsonb_build_object(p_area,
           case when v_withdrawn
                then (v_prev - 'flagged_at') || jsonb_build_object(
                       'approved_at', now(), 'note', coalesce(p_note, ''), 'via', v_via,
                       'flag_withdrawn_at', now(), 'withdrawn_note', coalesce(v_prev->>'note', ''))
                else jsonb_build_object(
                       case when p_approve then 'approved_at' else 'flagged_at' end, now(),
                       'note', coalesce(p_note, ''), 'via', v_via)
           end)
   where work_order_id = v_s.work_order_id;

  if not p_approve then
    select coalesce(max(sort), 0) into v_sort
      from public.wo_surfaces where work_order_id = v_s.work_order_id;

    insert into public.wo_surfaces
        (work_order_id, heading, heading_meta, label, sort, rectification)
      values (v_s.work_order_id, p_area, 'flagged at walkthrough',
              coalesce(nullif(trim(p_note), ''), 'Customer flagged this area'),
              v_sort + 1, true);

    perform public.wo_set_stage(v_s.work_order_id, 'in_progress', 'customer',
      jsonb_build_object('via', 'walkthrough_flag', 'area', p_area));
  end if;

  if v_withdrawn then
    -- Back to sign-off only when nothing is left to do: no open rectify row
    -- from any flag, every working surface done.
    select count(*) filter (where rectification and state is distinct from 'done'),
           count(*) filter (where state is distinct from 'done')
      into v_open, v_todo
      from public.wo_surfaces
     where work_order_id = v_s.work_order_id and not removed_from_scope;
    if v_open = 0 and v_todo = 0 then
      v_r := public.wo_set_stage(v_s.work_order_id, 'walkthrough', 'customer',
               jsonb_build_object('via', 'flag_withdrawn', 'area', p_area));
      -- Already at walkthrough (never left) reads ok; a gate refusal is left
      -- for the painter's screen to explain — the approval itself stands.
    end if;
  end if;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (v_s.work_order_id,
            case when v_withdrawn then 'flag_withdrawn'
                 when p_approve then 'area_approved' else 'area_flagged' end, 'customer',
            jsonb_build_object('area', p_area, 'note', coalesce(p_note, ''), 'via', v_via,
                               'withdrawn_note', case when v_withdrawn then v_prev->>'note' else null end));

  return 'ok:' || case when p_approve then 'approved' else 'flagged' end;
end $$;
grant execute on function public.wo_walkthrough_area(text, text, boolean, text) to anon, authenticated;

-- ---- 2. wo_sign — BODY BASIS 20261119. Two changes: the stage check up front, and
-- the close's result is CHECKED (raise → the whole signature rolls back).
create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_wo public.work_orders%rowtype;
        v_kind public.wo_signoff_kind; v_captured text;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb; v_r text;
begin
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;
  -- NEW: a signature closes the job, and only a job AT walkthrough can close.
  -- Say so before anything is written (the 17 Sep half-landed signature).
  if v_wo.stage is distinct from 'walkthrough' then
    return 'error:not_at_walkthrough:' || v_wo.stage::text;
  end if;

  if p_kind = 'deemed' then
    if v_via <> 'customer' then return 'error:deemed_needs_customer_token'; end if;
    if v_s.deadline_at is null or now() < v_s.deadline_at then
      return 'error:deemed_too_early';
    end if;
    v_kind := 'deemed'; v_captured := null;
  elsif v_via = 'session' then
    v_kind := 'on_device'; v_captured := 'contractor_device';
  else
    if v_s.client_unavailable_at is null and not exists (
      select 1 from public.wo_walkthroughs
       where work_order_id = v_s.work_order_id and kind = 'final' and status = 'missed'
    ) then
      return 'error:walkthrough_first';
    end if;
    v_kind := 'remote'; v_captured := 'customer_device';
  end if;

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

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  update public.wo_signoff
     set signed_at = now(), signed_name = trim(p_name),
         signed_kind = v_kind, signed_device = coalesce(p_device, ''),
         captured_on = v_captured,
         walkthrough_session_token = null, walkthrough_session_expires_at = null
   where work_order_id = v_s.work_order_id;

  update public.wo_walkthroughs set status = 'done'
   where work_order_id = v_s.work_order_id and kind = 'final' and status = 'booked'
     and v_kind = 'on_device';

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, v_kind)
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

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

  perform public.invoice_draft_final(v_wo.estimate_id);
  perform public.contractor_invoice_draft(v_s.work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(),
            case when v_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', v_kind::text, 'name', trim(p_name),
                               'captured_on', v_captured,
                               'warranty_starts', v_start, 'deemed', v_kind = 'deemed'));

  v_r := public.wo_set_stage(v_s.work_order_id, 'closed',
           case when v_kind = 'deemed' then 'system' else 'customer' end,
           jsonb_build_object('signed_kind', v_kind::text));
  if v_r not like 'ok:%' then
    -- NEW: never a signed sign-off on a job that did not close.
    raise exception 'wo_sign: the job could not be closed (%)', v_r;
  end if;

  return 'ok:signed';
end $$;
grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- 3. repair: signed sign-offs on jobs still In progress -----------------------------
-- The untouched flag rows go, then the same door the withdraw uses:
-- in_progress → walkthrough → closed, as the system. Anything a gate still
-- refuses is left alone and shows up in the read-back below.
do $$
declare v record; v_r text;
begin
  for v in
    select s.work_order_id, s.signed_kind
      from public.wo_signoff s join public.work_orders w on w.id = s.work_order_id
     where s.signed_at is not null and w.stage = 'in_progress'
  loop
    delete from public.wo_surfaces
     where work_order_id = v.work_order_id and rectification
       and heading_meta = 'flagged at walkthrough' and state is distinct from 'done';
    v_r := public.wo_set_stage(v.work_order_id, 'walkthrough', 'system',
             jsonb_build_object('via', 'repair_20270164'));
    if v_r like 'ok:%' then
      v_r := public.wo_set_stage(v.work_order_id, 'closed', 'system',
               jsonb_build_object('via', 'repair_20270164', 'signed_kind', v.signed_kind::text));
    end if;
    raise notice 'repair %: %', v.work_order_id, v_r;
  end loop;
end $$;

-- Read-back: transition present, both functions carry the new lines, and
-- how many signed-but-in-progress jobs remain (expect 0).
select
  exists (select 1 from public.wo_stage_transitions where from_stage = 'in_progress' and to_stage = 'walkthrough') as transition_ok,
  (select prosrc like '%flag_withdrawn_at%' from pg_proc where proname = 'wo_walkthrough_area') as withdraw_ok,
  (select prosrc like '%error:not_at_walkthrough%' from pg_proc where proname = 'wo_sign') as sign_guard_ok,
  (select count(*) from public.wo_signoff s join public.work_orders w on w.id = s.work_order_id
    where s.signed_at is not null and w.stage = 'in_progress') as still_stuck;

insert into public._prod_migrations(name) values ('20270164000000_wo_flag_withdrawn_and_sign_guard.sql') on conflict (name) do nothing;

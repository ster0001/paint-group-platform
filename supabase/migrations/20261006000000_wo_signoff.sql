-- =============================================================================
-- WO completion loop, step 5b — walkthrough, sign-off, and everything it fires
--
-- TOM'S RULING (21 Aug), and it is the reason this file is shaped the way it is:
--
--   (a) the sign-off CLOCK and the nudge ladder MAY run           -> default on
--   (b) DEEMED EXECUTION does not                                 -> default OFF
--
-- While (b) is off a job simply waits at walkthrough for a human signature, and
-- — the part that matters — the nudges must read as plain reminders. No mention
-- of deemed signing, no mention of payment falling due automatically. That copy
-- is chosen here, in wo_nudge_copy(), so there is one place it can be got wrong
-- and one place a test can pin it.
--
-- The nudge rule: each rung fires at most once, and a sweep that runs late
-- sends a late nudge rather than the whole ladder at once. Timestamps are
-- computed from the deadline; communications are never backdated.
--
-- Sign-off is ONE transaction. Warranty, review task, completion report and the
-- invoice stub either all exist or none do — a job that is closed but has no
-- warranty is worse than a job that failed to close.
-- =============================================================================

create table if not exists public.warranties (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null unique references public.work_orders (id) on delete cascade,
  estimate_id   uuid references public.estimates (id) on delete set null,
  starts_on     date not null,
  ends_on       date not null,
  years         integer not null default 2,
  signed_kind   public.wo_signoff_kind not null,
  created_at    timestamptz not null default now()
);
create index if not exists warranties_wo_idx on public.warranties (work_order_id);

alter table public.wo_signoff
  add column if not exists customer_token text unique,
  add column if not exists report jsonb;

alter table public.warranties enable row level security;

drop policy if exists warranties_staff on public.warranties;
create policy warranties_staff on public.warranties
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists warranties_customer on public.warranties;
create policy warranties_customer on public.warranties
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = warranties.work_order_id and c.profile_id = auth.uid())
  );
revoke insert, update, delete on public.warranties from authenticated;

-- ---- the evidence pack starts the clock -------------------------------------
create or replace function public.wo_deliver_evidence_pack(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_hours integer; v_token text; v_clock boolean; v_deadline timestamptz;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;

  v_clock := coalesce(public.wo_loop_setting(array['signoff','clockEnabled']) = 'true'::jsonb, false);
  v_hours := coalesce((public.wo_loop_setting(array['signoff','residentialHours']))::text::integer, 72);
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- The deadline is COMPUTED from delivery, so a sweep that runs late still
  -- works out the same moment it always would have.
  v_deadline := case when v_clock then now() + make_interval(hours => v_hours) else null end;

  insert into public.wo_signoff (work_order_id, evidence_pack_sent_at, deadline_at, customer_token)
    values (p_work_order_id, now(), v_deadline, v_token)
  on conflict (work_order_id) do update
    set evidence_pack_sent_at = coalesce(public.wo_signoff.evidence_pack_sent_at, now()),
        deadline_at = coalesce(public.wo_signoff.deadline_at, excluded.deadline_at),
        customer_token = coalesce(public.wo_signoff.customer_token, excluded.customer_token);

  select customer_token into v_token from public.wo_signoff where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'evidence_pack_sent', auth.uid(),
            case when public.is_staff() then 'staff' else 'system' end,
            jsonb_build_object('deadline_at', v_deadline, 'clock_enabled', v_clock));

  perform public.wo_set_stage(p_work_order_id, 'walkthrough',
                              case when public.is_staff() then 'staff' else 'system' end,
                              jsonb_build_object('via', 'evidence_pack'));

  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_deliver_evidence_pack(uuid) to authenticated, service_role;

-- ---- the customer's view ----------------------------------------------------
create or replace function public.wo_walkthrough_by_token(p_token text)
returns table (wo_ref text, job_title text, areas jsonb, signed_at timestamptz,
               signed_name text, deadline_at timestamptz, headings jsonb)
language sql security definer set search_path = public as $$
  select w.wo_ref,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         s.areas, s.signed_at, s.signed_name, s.deadline_at,
         (select coalesce(jsonb_agg(distinct x.heading), '[]'::jsonb)
            from public.wo_surfaces x where x.work_order_id = w.id)
    from public.wo_signoff s
    join public.work_orders w on w.id = s.work_order_id
   where s.customer_token = p_token
   limit 1;
$$;
grant execute on function public.wo_walkthrough_by_token(text) to anon, authenticated;

-- A viewed-but-unsigned pack is the fact that makes a deemed sign-off
-- defensible, so views are recorded even though nobody acts on them.
create or replace function public.wo_record_signoff_view(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wo_signoff
     set views = views || jsonb_build_array(jsonb_build_object('at', now()))
   where customer_token = p_token and signed_at is null;
end $$;
grant execute on function public.wo_record_signoff_view(text) to anon, authenticated;

-- ---- area by area -----------------------------------------------------------
-- A flag is not a complaint to be triaged: it becomes a rectification row on
-- the painter's own list and the job goes back to in_progress.
create or replace function public.wo_walkthrough_area(
  p_token text, p_area text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_signoff%rowtype; v_sort integer;
begin
  select * into v_s from public.wo_signoff where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_s.signed_at is not null then return 'error:already_signed'; end if;
  if coalesce(trim(p_area), '') = '' then return 'error:no_area'; end if;

  update public.wo_signoff
     set areas = areas || jsonb_build_object(p_area, jsonb_build_object(
           case when p_approve then 'approved_at' else 'flagged_at' end, now(),
           'note', coalesce(p_note, '')))
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

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (v_s.work_order_id,
            case when p_approve then 'area_approved' else 'area_flagged' end, 'customer',
            jsonb_build_object('area', p_area, 'note', coalesce(p_note, '')));

  return 'ok:' || case when p_approve then 'approved' else 'flagged' end;
end $$;
grant execute on function public.wo_walkthrough_area(text, text, boolean, text) to anon, authenticated;

-- ---- the master event -------------------------------------------------------
-- Everything downstream happens here, in one transaction.
create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_signoff%rowtype; v_wo public.work_orders%rowtype;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb;
begin
  select * into v_s from public.wo_signoff where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  -- Every area the job actually has must be approved. A deemed sign-off is the
  -- one exception, because there the silence IS the answer.
  if p_kind <> 'deemed' then
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
         signed_kind = p_kind, signed_device = coalesce(p_device, '')
   where work_order_id = v_s.work_order_id;

  -- 1. warranty
  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, p_kind)
  on conflict (work_order_id) do nothing;

  -- 2. the review request, as a task for the follow-up phase to pick up
  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- 3. the completion report — built from the events, not written by anyone
  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', trim(p_name), 'signed_kind', p_kind::text,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = v_s.work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = v_s.work_order_id),
    -- Declined variations are IN the report. That is the point of keeping them.
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = v_s.work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = v_s.work_order_id),
    'areas', v_s.areas
  ) into v_report;

  update public.wo_signoff set report = v_report where work_order_id = v_s.work_order_id;

  -- 4. the invoice stub for the invoicing phase to consume
  insert into public.invoices (estimate_id, status, amount_cents, issued_on)
    values (v_wo.estimate_id, 'draft', 0, v_start);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(), 
            case when p_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', p_kind::text, 'name', trim(p_name),
                               'warranty_starts', v_start, 'deemed', p_kind = 'deemed'));

  perform public.wo_set_stage(v_s.work_order_id, 'closed',
                              case when p_kind = 'deemed' then 'system' else 'customer' end,
                              jsonb_build_object('signed_kind', p_kind::text));

  return 'ok:signed';
end $$;
grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- extension --------------------------------------------------------------
create or replace function public.wo_request_extension(p_token text, p_until date)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_signoff%rowtype;
begin
  select * into v_s from public.wo_signoff where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_s.signed_at is not null then return 'error:already_signed'; end if;

  update public.wo_signoff
     set extension_requested_at = now(), extension_until = p_until
   where work_order_id = v_s.work_order_id;

  insert into public.wo_events (work_order_id, type, actor_kind, meta)
    values (v_s.work_order_id, 'extension_requested', 'customer',
            jsonb_build_object('until', p_until));
  return 'ok:requested';
end $$;
grant execute on function public.wo_request_extension(text, date) to anon, authenticated;

create or replace function public.wo_approve_extension(p_work_order_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_signoff%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;

  if p_approve then
    -- The clock PAUSES: the deadline moves to the end of the day they asked for.
    update public.wo_signoff
       set extension_approved_at = now(), extension_approved_by = auth.uid(),
           deadline_at = (v_s.extension_until + 1)::timestamptz
     where work_order_id = p_work_order_id;
  else
    update public.wo_signoff
       set extension_requested_at = null, extension_until = null
     where work_order_id = p_work_order_id;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'extension_' || case when p_approve then 'approved' else 'declined' end,
            auth.uid(), 'staff', jsonb_build_object('until', v_s.extension_until));
  return 'ok';
end $$;
grant execute on function public.wo_approve_extension(uuid, boolean) to authenticated;

-- ---- the nudge ladder -------------------------------------------------------
-- THE COPY IS THE COMPLIANCE. While deemed execution is off, a nudge is a
-- reminder and says nothing about signing happening by itself or payment
-- falling due. One place to get it right; one place to test it.
create or replace function public.wo_nudge_copy(p_rung integer, p_deemed_enabled boolean)
returns text language sql immutable set search_path = public as $$
  select case
    when p_rung = 0 then
      'Your job is finished and the photos are ready to look through. When you have a moment, please have a look and let us know you are happy.'
    when p_rung = 24 and not p_deemed_enabled then
      'Just a reminder that your completion pack is waiting whenever you have a minute. Any questions, give us a call.'
    when p_rung = 48 and not p_deemed_enabled then
      'We have not heard back on your completion pack yet. We would rather hear from you than assume everything is fine, so please give us a call when you can.'
    when p_rung = 24 then
      'A reminder that your completion pack is waiting. If we do not hear from you it will be treated as signed off on the date shown in your quote terms.'
    when p_rung = 48 then
      'Final reminder on your completion pack. If we do not hear from you it will be treated as signed off on the date shown in your quote terms, and the final invoice will follow.'
    else null
  end;
$$;

create or replace function public.wo_signoff_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row record; v_nudged integer := 0; v_deemed integer := 0;
        v_clock boolean; v_deemed_on boolean; v_hours integer; v_rung integer; v_elapsed numeric;
begin
  if not (public.is_staff() or public.wo_is_system()) then return '{"error":"not_staff"}'::jsonb; end if;

  v_clock     := coalesce(public.wo_loop_setting(array['signoff','clockEnabled']) = 'true'::jsonb, false);
  v_deemed_on := coalesce(public.wo_loop_setting(array['signoff','deemedEnabled']) = 'true'::jsonb, false);
  v_hours     := coalesce((public.wo_loop_setting(array['signoff','residentialHours']))::text::integer, 72);
  if not v_clock then return jsonb_build_object('nudged', 0, 'deemed', 0, 'clock', false); end if;

  for v_row in
    select s.* from public.wo_signoff s
      join public.work_orders w on w.id = s.work_order_id
     where s.signed_at is null
       and s.evidence_pack_sent_at is not null
       and w.stage = 'walkthrough'
       -- An approved extension pauses everything until its new deadline.
       and (s.extension_requested_at is null or s.extension_approved_at is not null)
  loop
    v_elapsed := extract(epoch from (now() - v_row.evidence_pack_sent_at)) / 3600.0;

    -- The highest rung now due. Each fires at most once: a sweep that missed
    -- 24h sends the 24h nudge late rather than sending 0, 24 and 48 together.
    for v_rung in select x from unnest(array[0, 24, 48]) x loop
      if v_elapsed >= v_rung and (v_row.nudges ->> v_rung::text) is null then
        update public.wo_signoff
           set nudges = nudges || jsonb_build_object(v_rung::text, now())
         where work_order_id = v_row.work_order_id;

        insert into public.wo_events (work_order_id, type, actor_kind, meta)
          values (v_row.work_order_id, 'signoff_nudge', 'system',
                  jsonb_build_object('rung', v_rung, 'deemed_enabled', v_deemed_on,
                                     'copy', public.wo_nudge_copy(v_rung, v_deemed_on),
                                     'late', v_elapsed > v_rung + 1));
        v_nudged := v_nudged + 1;
      end if;
    end loop;

    -- (b): OFF until the clause clears legal review. The job simply waits.
    if v_deemed_on and v_row.deadline_at is not null and now() >= v_row.deadline_at then
      perform public.wo_sign(v_row.customer_token, 'Deemed — no response', 'deemed', 'system sweep');
      v_deemed := v_deemed + 1;
    end if;
  end loop;

  return jsonb_build_object('nudged', v_nudged, 'deemed', v_deemed, 'clock', true,
                            'deemed_enabled', v_deemed_on);
end $$;
grant execute on function public.wo_signoff_sweep() to authenticated, service_role;

-- ---- Verification -----------------------------------------------------------
--   select public.wo_deliver_evidence_pack('<wo>');   -> 'ok:<token>', stage = walkthrough
--   select public.wo_sign('<token>', 'Melissa Hartley');
--     -> 'error:areas_outstanding:Front,Left'   until each area is approved
--   select value->'signoff'->>'deemedEnabled' from settings where key='wo_loop'; -> false
--   select public.wo_signoff_sweep();
--     -> {"nudged":1,"deemed":0,...}  and the nudge copy mentions NO deemed signing

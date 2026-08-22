-- =============================================================================
-- WO loop v3 — walkthrough booking + two-mode sign-off (§4b, Tom's 23 Aug ruling)
--
-- What changes and why:
--   · wo_walkthroughs: walkthroughs become BOOKED events on the existing
--     scheduling calendar — pre optional, final required, final defaulting to
--     the last day on site. Visible to contractor, customer and staff.
--   · Sign-off Mode A (DEFAULT): on the contractor's device. A scoped,
--     TIME-BOXED session token serves the customer walkthrough view inside the
--     contractor's visit — never a role bypass: the token is minted by an RPC
--     that checks the caller IS the assigned contractor, expires in 2 hours,
--     and the customer types their own name to sign.
--   · Sign-off Mode B (remote from the customer's own view) becomes FALLBACK
--     ONLY: refused until staff mark the client unavailable or the final
--     walkthrough is marked missed. Deemed stays as ruled (clock+nudges run,
--     execution behind its own switch).
--   · signed_kind gains 'on_device'. The KIND IS NEVER TRUSTED FROM THE CALLER
--     ANY MORE: wo_sign derives it from which token arrived — session token →
--     on_device, customer token → remote, sweep-with-deadline-passed → deemed.
--     A caller claiming 'deemed' before the deadline is refused.
--   · Completion report: DRAFT generated at completion prep (wo_reports row,
--     wo_signoff.report_draft_id), FINAL written at close exactly as today.
--   · signer_name / signed device already exist as signed_name / signed_device;
--     new captured_on says WHOSE device: contractor_device | customer_device.
--
-- ⚑10–12 land as Settings (wo_loop.walkthrough) with defaults from the ruling:
--   signEmailImmediate=true · bookedBy='office' · preRequired=false
-- =============================================================================

-- ---- 0. enum first, never used as a literal in this transaction -------------
alter type public.wo_signoff_kind add value if not exists 'on_device';

-- ---- 1. schema --------------------------------------------------------------

create table if not exists public.wo_walkthroughs (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  kind           text not null check (kind in ('pre', 'final')),
  scheduled_date date not null,
  status         text not null default 'booked'
                   check (status in ('booked', 'done', 'missed', 'cancelled')),
  booked_by      uuid references auth.users (id) on delete set null,
  note           text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists wo_walkthroughs_wo_idx on public.wo_walkthroughs (work_order_id, kind);
create index if not exists wo_walkthroughs_date_idx on public.wo_walkthroughs (scheduled_date);

-- The report drafts. The FINAL stays where it lives today (wo_signoff.report);
-- a draft is its own row so regenerating one never risks the signed record.
create table if not exists public.wo_reports (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  kind          text not null default 'draft' check (kind in ('draft')),
  body          jsonb not null,
  generated_at  timestamptz not null default now()
);
create index if not exists wo_reports_wo_idx on public.wo_reports (work_order_id, generated_at desc);

alter table public.wo_signoff
  add column if not exists report_draft_id  uuid references public.wo_reports (id) on delete set null,
  add column if not exists captured_on      text
    check (captured_on is null or captured_on in ('contractor_device', 'customer_device')),
  add column if not exists client_unavailable_at timestamptz,
  add column if not exists client_unavailable_by uuid references auth.users (id) on delete set null,
  -- Mode A session: minted for one visit, dead two hours later.
  add column if not exists walkthrough_session_token      text unique,
  add column if not exists walkthrough_session_expires_at timestamptz;

-- ---- 2. RLS -----------------------------------------------------------------

alter table public.wo_walkthroughs enable row level security;
alter table public.wo_reports      enable row level security;

drop policy if exists wo_walkthroughs_staff on public.wo_walkthroughs;
create policy wo_walkthroughs_staff on public.wo_walkthroughs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists wo_walkthroughs_contractor on public.wo_walkthroughs;
create policy wo_walkthroughs_contractor on public.wo_walkthroughs
  for select to authenticated using (
    exists (select 1 from public.work_orders w
             where w.id = wo_walkthroughs.work_order_id
               and w.contractor_id is not null
               and w.contractor_id = public.current_contractor_id())
  );

drop policy if exists wo_walkthroughs_customer on public.wo_walkthroughs;
create policy wo_walkthroughs_customer on public.wo_walkthroughs
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = wo_walkthroughs.work_order_id and c.profile_id = auth.uid())
  );

-- Draft reports: staff and the job's own customer. NOT the contractor — the
-- report carries variation prices, which are customer money.
drop policy if exists wo_reports_staff on public.wo_reports;
create policy wo_reports_staff on public.wo_reports
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists wo_reports_customer on public.wo_reports;
create policy wo_reports_customer on public.wo_reports
  for select to authenticated using (
    exists (select 1 from public.work_orders w
              join public.estimates e on e.id = w.estimate_id
              join public.customers c on c.id = e.customer_id
             where w.id = wo_reports.work_order_id and c.profile_id = auth.uid())
  );

grant select on public.wo_walkthroughs, public.wo_reports to authenticated;

-- ---- 3. settings ⚑10–12 (defaults per the 23 Aug ruling) --------------------
update public.settings
   set value = value || jsonb_build_object('walkthrough', jsonb_build_object(
         'signEmailImmediate', true,     -- ⚑10: signed report emailed at once
         'bookedBy', 'office',           -- ⚑11: who books walkthroughs
         'preRequired', false            -- ⚑12: pre-walkthrough optional
       )),
       updated_at = now()
 where key = 'wo_loop'
   and (value -> 'walkthrough') is null; -- never clobber a later ruling

-- ---- 4. booking + status ----------------------------------------------------

create or replace function public.wo_book_walkthrough(
  p_work_order_id uuid, p_kind text, p_date date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_date date; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('pre', 'final') then return 'error:bad_kind'; end if;

  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  -- The final defaults to the LAST DAY ON SITE — the booking's own end date.
  v_date := p_date;
  if v_date is null and p_kind = 'final' then
    select bo.end_date into v_date
      from public.booking_offers bo
     where bo.work_order_id = p_work_order_id and bo.state = 'accepted'
     order by bo.accepted_at desc nulls last limit 1;
  end if;
  if v_date is null then return 'error:no_date'; end if;

  -- One LIVE booking per kind: rebooking cancels the old one rather than
  -- stacking two finals nobody can tell apart.
  update public.wo_walkthroughs set status = 'cancelled'
   where work_order_id = p_work_order_id and kind = p_kind and status = 'booked';

  insert into public.wo_walkthroughs (work_order_id, kind, scheduled_date, booked_by, note)
    values (p_work_order_id, p_kind, v_date, auth.uid(), coalesce(p_note, ''))
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_booked', auth.uid(), 'staff',
            jsonb_build_object('walkthrough_id', v_id, 'kind', p_kind, 'date', v_date));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_book_walkthrough(uuid, text, date, text) to authenticated;

create or replace function public.wo_set_walkthrough_status(p_walkthrough_id uuid, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare v_row public.wo_walkthroughs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_status not in ('done', 'missed', 'cancelled') then return 'error:bad_status'; end if;

  update public.wo_walkthroughs set status = p_status
   where id = p_walkthrough_id and status = 'booked'
   returning * into v_row;
  if not found then return 'error:not_booked'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_row.work_order_id, 'walkthrough_' || p_status, auth.uid(), 'staff',
            jsonb_build_object('walkthrough_id', v_row.id, 'kind', v_row.kind));
  return 'ok:' || p_status;
end $$;
grant execute on function public.wo_set_walkthrough_status(uuid, text) to authenticated;

-- Staff declare the customer unreachable — the ONLY other gate into Mode B.
create or replace function public.wo_mark_client_unavailable(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.wo_signoff
     set client_unavailable_at = now(), client_unavailable_by = auth.uid()
   where work_order_id = p_work_order_id and signed_at is null;
  if not found then return 'error:not_found'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'client_unavailable_marked', auth.uid(), 'staff', '{}'::jsonb);
  return 'ok:marked';
end $$;
grant execute on function public.wo_mark_client_unavailable(uuid) to authenticated;

-- ---- 5. Mode A: the walkthrough session -------------------------------------
-- Scoped and time-boxed, never a role bypass: only the ASSIGNED contractor (or
-- staff standing beside them) can mint it, it lives two hours, and everything
-- it can do — approve areas, take the typed signature — is exactly what the
-- customer's own link can do. It is the customer's view, on site.

create or replace function public.wo_start_walkthrough_mode(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_cid uuid; v_token text;
begin
  select * into v_w from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_w.contractor_id)) then
    return 'error:not_yours';
  end if;
  if v_w.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  -- A live FINAL booking, today or earlier. A walkthrough nobody booked can't
  -- be signed on a doorstep "while we're here" — booking first is the policy.
  if not exists (
    select 1 from public.wo_walkthroughs
     where work_order_id = p_work_order_id and kind = 'final'
       and status = 'booked'
       and scheduled_date <= (now() at time zone 'Australia/Melbourne')::date
  ) then return 'error:no_walkthrough_booked'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '2 hours'
   where work_order_id = p_work_order_id and signed_at is null;
  if not found then return 'error:no_signoff_row'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'walkthrough_mode_started', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('expires_at', now() + interval '2 hours'));
  return 'ok:' || v_token;
end $$;
grant execute on function public.wo_start_walkthrough_mode(uuid) to authenticated;

-- ---- 6. dual-token lookup ---------------------------------------------------
-- One resolver, used by the area RPC and wo_sign, so the two can never accept
-- different tokens. Returns the row plus HOW the caller got in.

create or replace function public.wo_signoff_by_token(p_token text)
returns table (s public.wo_signoff, via text)
language sql stable security definer set search_path = public as $$
  select x, 'customer'::text from public.wo_signoff x where x.customer_token = p_token
  union all
  select x, 'session'::text  from public.wo_signoff x
   where x.walkthrough_session_token = p_token
     and x.walkthrough_session_expires_at > now()
  limit 1;
$$;

-- The ORIGINAL 20261006 body, changed in exactly two ways: the token resolves
-- through wo_signoff_by_token (so Mode A's session token works here too), and
-- `via` is recorded on the area and the event. Everything else — heading_meta,
-- the always-insert on flag, the stage move — is byte-for-byte behaviour.
create or replace function public.wo_walkthrough_area(
  p_token text, p_area text, p_approve boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_sort integer;
begin
  -- One SELECT INTO a plain record, then unpack: Postgres refuses a %rowtype
  -- variable inside a multi-item INTO list (42601).
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'error:already_signed'; end if;
  if coalesce(trim(p_area), '') = '' then return 'error:no_area'; end if;

  update public.wo_signoff
     set areas = areas || jsonb_build_object(p_area, jsonb_build_object(
           case when p_approve then 'approved_at' else 'flagged_at' end, now(),
           'note', coalesce(p_note, ''), 'via', v_via))
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
            jsonb_build_object('area', p_area, 'note', coalesce(p_note, ''), 'via', v_via));

  return 'ok:' || case when p_approve then 'approved' else 'flagged' end;
end $$;
grant execute on function public.wo_walkthrough_area(text, text, boolean, text) to anon, authenticated;

-- The READ side of the customer view, now token-dual too — this is the whole
-- of "serving the customer walkthrough view into the contractor session":
-- the /s page already renders whatever this returns.
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
      or (s.walkthrough_session_token = p_token
          and s.walkthrough_session_expires_at > now())
   limit 1;
$$;
grant execute on function public.wo_walkthrough_by_token(text) to anon, authenticated;

-- Views recorded for BOTH tokens: an on-device walkthrough seen but unsigned
-- is as much a fact as a remote one.
create or replace function public.wo_record_signoff_view(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wo_signoff
     set views = views || jsonb_build_array(jsonb_build_object('at', now(),
           'via', case when customer_token = p_token then 'customer' else 'session' end))
   where (customer_token = p_token
          or (walkthrough_session_token = p_token and walkthrough_session_expires_at > now()))
     and signed_at is null;
end $$;
grant execute on function public.wo_record_signoff_view(text) to anon, authenticated;

-- ---- 7. the report draft ----------------------------------------------------
-- DRAFT at completion prep, FINAL at close. Same jsonb shape as the final so
-- the customer previews exactly what they will sign; regenerating replaces the
-- draft pointer, never a signed record.

create or replace function public.wo_generate_report_draft(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_report jsonb; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_wo.contractor_id)) then
    return 'error:not_yours';
  end if;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'draft', true,
    'generated_at', now(),
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = p_work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = p_work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = p_work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = p_work_order_id)
  ) into v_report;

  insert into public.wo_reports (work_order_id, kind, body)
    values (p_work_order_id, 'draft', v_report) returning id into v_id;

  update public.wo_signoff set report_draft_id = v_id where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor,
                                actor_kind, meta)
    values (p_work_order_id, 'report_drafted', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('report_id', v_id));
  return 'ok:' || v_id;
end $$;
grant execute on function public.wo_generate_report_draft(uuid) to authenticated;

-- ---- 8. wo_sign, two modes --------------------------------------------------
-- BODY BASIS: 20261026 (invoicing) — the customer_id insert and everything
-- downstream are preserved exactly. What changes:
--   · token resolves via wo_signoff_by_token (customer OR session)
--   · signed_kind is DERIVED server-side: session → 'on_device' (+captured_on
--     contractor_device) · customer token → 'remote' (+customer_device), and
--     remote is REFUSED until staff marked the client unavailable or the final
--     walkthrough was missed (Mode B is the fallback, not the default)
--   · 'deemed' honoured only when the deadline has actually passed — the sweep
--     can say it, a browser cannot make it true early.

create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_wo public.work_orders%rowtype;
        v_kind public.wo_signoff_kind; v_captured text;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb;
begin
  -- Record-then-unpack: a %rowtype var cannot sit in a multi-item INTO (42601).
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  -- Which signature this really is. The caller's claim only survives for
  -- 'deemed', and only once the clock has genuinely run out.
  if p_kind = 'deemed' then
    if v_via <> 'customer' then return 'error:deemed_needs_customer_token'; end if;
    if v_s.deadline_at is null or now() < v_s.deadline_at then
      return 'error:deemed_too_early';
    end if;
    v_kind := 'deemed'; v_captured := null;
  elsif v_via = 'session' then
    v_kind := 'on_device'; v_captured := 'contractor_device';
  else
    -- Mode B: remote, from the customer's own link — FALLBACK ONLY.
    if v_s.client_unavailable_at is null and not exists (
      select 1 from public.wo_walkthroughs
       where work_order_id = v_s.work_order_id and kind = 'final' and status = 'missed'
    ) then
      return 'error:walkthrough_first';
    end if;
    v_kind := 'remote'; v_captured := 'customer_device';
  end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  -- Every area the job actually has must be approved. A deemed sign-off is the
  -- one exception, because there the silence IS the answer.
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

  v_start := (now() at time zone 'Australia/Melbourne')::date;   -- ⚑4: sign-off date

  update public.wo_signoff
     set signed_at = now(), signed_name = trim(p_name),
         signed_kind = v_kind, signed_device = coalesce(p_device, ''),
         captured_on = v_captured,
         walkthrough_session_token = null, walkthrough_session_expires_at = null
   where work_order_id = v_s.work_order_id;

  -- The booked walkthrough this signature completes.
  update public.wo_walkthroughs set status = 'done'
   where work_order_id = v_s.work_order_id and kind = 'final' and status = 'booked'
     and v_kind = 'on_device';

  -- 1. warranty
  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, v_kind)
  on conflict (work_order_id) do nothing;

  -- 2. the review request, as a task for the follow-up phase to pick up
  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- 3. the completion report — built from the events, not written by anyone
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

  -- 4. the invoice stub for the invoicing phase to consume (A2: with customer)
  insert into public.invoices (estimate_id, customer_id, status, amount_cents, issued_on)
    values (v_wo.estimate_id,
            (select customer_id from public.estimates where id = v_wo.estimate_id),
            'draft', 0, v_start);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(),
            case when v_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', v_kind::text, 'name', trim(p_name),
                               'captured_on', v_captured,
                               'warranty_starts', v_start, 'deemed', v_kind = 'deemed'));

  perform public.wo_set_stage(v_s.work_order_id, 'closed',
                              case when v_kind = 'deemed' then 'system' else 'customer' end,
                              jsonb_build_object('signed_kind', v_kind::text));

  return 'ok:signed';
end $$;

grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- Verification -----------------------------------------------------------
-- Expect 6 rows, all security_definer = true.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_book_walkthrough', 'wo_set_walkthrough_status',
                     'wo_mark_client_unavailable', 'wo_start_walkthrough_mode',
                     'wo_generate_report_draft', 'wo_signoff_by_token')
 order by p.proname;
-- Expect 'on_device' in the enum.
select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'wo_signoff_kind' order by enumsortorder;
-- Expect the new columns.
select column_name from information_schema.columns
 where table_name = 'wo_signoff'
   and column_name in ('report_draft_id','captured_on','client_unavailable_at',
                       'walkthrough_session_token');
-- The Mode B gate, live: wo_sign with a customer token before any
-- unavailable-mark or missed walkthrough must return 'error:walkthrough_first'.

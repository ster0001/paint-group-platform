-- CRM v2 · Phase 6 — visits, availability, staff Google Calendar
-- (deep dive §4.6; visit-booking brief rulings 1–5, V1–V5 as reconstructed).
--
--   1. `visits` — the table that never existed. Estimator, customer, property,
--      estimate, a start and an end, a kind, a status, an outcome. An
--      EXCLUSION constraint makes a double-booking of one estimator impossible
--      at the database, not the form.
--   2. Its triggers write the CRM events atomically (visit_booked /
--      visit_completed / visit_no_show / visit_cancelled) — which brings the
--      two empty lanes and the `visit_rebook` item to life.
--   3. `staff_availability` — who takes visits, which days, which hours;
--      global numbers ride `settings.visits`.
--   4. `staff_gcal_connections` / `staff_gcal_events` — the staff twin of the
--      contractor calendar tables (service-only, same privacy: an
--      app-created calendar, never the person's own).
--   5. `visit_book` / `visit_set_status` / `visit_move` — the write RPCs the
--      screens and the wizard use; the browser never inserts into visits.
--
-- Idempotent. Read-back at the end.

do $$
begin
  create extension if not exists btree_gist with schema extensions;
exception when others then
  raise notice 'btree_gist not created (%): the overlap constraint needs it', sqlerrm;
end $$;

-- ---- 1 · visits --------------------------------------------------------------
create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) default public.current_tenant(),
  account_id    uuid references public.accounts (id) on delete set null,
  property_id   uuid references public.properties (id) on delete set null,
  estimate_id   uuid references public.estimates (id) on delete set null,
  -- The estimator. Null = booked, nobody assigned yet (the office picks).
  staff_id      uuid references public.profiles (id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  kind          text not null default 'quote'
    constraint visits_kind_check check (kind in ('quote', 'remeasure', 'colour_consult', 'walkthrough')),
  status        text not null default 'booked'
    constraint visits_status_check check (status in ('booked', 'done', 'no_show', 'cancelled', 'rebook')),
  source        text not null default 'staff'
    constraint visits_source_check check (source in ('wizard', 'staff', 'phone', 'assistant')),
  -- What the day needs, frozen at booking so the diary and the calendar read
  -- one row: address, who, phone.
  address       text,
  suburb        text,
  customer_name text,
  customer_phone text,
  note          text,
  outcome_note  text,
  outcome_at    timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  confirmation_sent_at timestamptz,
  reminder_sent_at     timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint visits_span_check check (ends_at > starts_at)
);
comment on table public.visits is
  'Estimator visits (CRM v2 P6). Written only through visit_book / visit_set_status / visit_move. A booked visit of one estimator cannot overlap another (visits_no_double_booking).';

-- Double-booking is impossible by constraint: two BOOKED visits of the same
-- estimator may not overlap in time.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'btree_gist') then
    if not exists (select 1 from pg_constraint where conname = 'visits_no_double_booking') then
      alter table public.visits add constraint visits_no_double_booking
        exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
        where (status = 'booked' and staff_id is not null);
    end if;
  else
    raise notice 'visits_no_double_booking NOT created: btree_gist missing';
  end if;
end $$;

create index if not exists visits_starts_idx on public.visits (tenant_id, starts_at);
create index if not exists visits_staff_idx on public.visits (staff_id, starts_at) where status = 'booked';
create index if not exists visits_account_idx on public.visits (account_id, starts_at desc);
create index if not exists visits_estimate_idx on public.visits (estimate_id) where estimate_id is not null;

drop trigger if exists t_visits_updated on public.visits;
create trigger t_visits_updated before update on public.visits
  for each row execute function public.set_updated_at();

alter table public.visits enable row level security;
drop policy if exists visits_staff_all on public.visits;
create policy visits_staff_all on public.visits
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));
revoke all on public.visits from anon;
-- Reads are the staff policy's; writes go through the RPCs below.
revoke insert, update, delete on public.visits from authenticated;

-- ---- 2 · the CRM events, atomically ----------------------------------------
create or replace function public.visits_crm_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text; v_when text;
begin
  if new.account_id is null then return new; end if;
  select coalesce(name, 'the estimator') into v_who from public.profiles where id = new.staff_id;
  v_when := to_char(new.starts_at at time zone 'Australia/Melbourne', 'Dy DD Mon HH24:MI');

  if tg_op = 'INSERT' and new.status = 'booked' then
    perform public.crm_emit('visit_booked', new.account_id,
      jsonb_build_object('when', v_when, 'who', v_who, 'visitId', new.id, 'kind', new.kind, 'source', new.source),
      case when new.source = 'wizard' then 'customer' else 'staff' end,
      now(), new.estimate_id, null, null, 'visit_booked:' || new.id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'done' then
      perform public.crm_emit('visit_completed', new.account_id,
        jsonb_build_object('outcome', left(coalesce(new.outcome_note, ''), 2000), 'visitId', new.id, 'who', v_who),
        'staff', coalesce(new.outcome_at, now()), new.estimate_id, null, null, 'visit_completed:' || new.id);
    elsif new.status = 'no_show' then
      perform public.crm_emit('visit_no_show', new.account_id,
        jsonb_build_object('when', v_when, 'visitId', new.id, 'note', left(coalesce(new.outcome_note, ''), 2000)),
        'staff', coalesce(new.outcome_at, now()), new.estimate_id, null, null, 'visit_no_show:' || new.id);
    elsif new.status = 'cancelled' then
      perform public.crm_emit('visit_cancelled', new.account_id,
        jsonb_build_object('when', v_when, 'visitId', new.id, 'reason', left(coalesce(new.cancel_reason, ''), 2000)),
        'staff', coalesce(new.cancelled_at, now()), new.estimate_id, null, null, 'visit_cancelled:' || new.id);
    elsif new.status = 'rebook' then
      perform public.crm_emit('visit_cancelled', new.account_id,
        jsonb_build_object('when', v_when, 'visitId', new.id, 'reason', 'rebook', 'rebook', true),
        'staff', now(), new.estimate_id, null, null, 'visit_rebook:' || new.id);
    elsif new.status = 'booked' and old.status in ('rebook', 'cancelled', 'no_show') then
      -- Booked again (a move after a no-show): a fresh booking event.
      perform public.crm_emit('visit_booked', new.account_id,
        jsonb_build_object('when', v_when, 'who', v_who, 'visitId', new.id, 'kind', new.kind, 'source', new.source, 'rebooked', true),
        'staff', now(), new.estimate_id, null, null, 'visit_booked:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'booked' and (new.starts_at <> old.starts_at or new.staff_id is distinct from old.staff_id) then
    -- Moved: the timeline says so, the lane stays "visit booked".
    perform public.crm_emit('visit_booked', new.account_id,
      jsonb_build_object('when', v_when, 'who', v_who, 'visitId', new.id, 'kind', new.kind, 'source', new.source, 'moved', true),
      'staff', now(), new.estimate_id, null, null, 'visit_moved:' || new.id || ':' || to_char(new.starts_at, 'YYYYMMDDHH24MI'));
  end if;
  return new;
end $$;
drop trigger if exists t_visits_crm_events on public.visits;
create trigger t_visits_crm_events after insert or update of status, starts_at, staff_id on public.visits
  for each row execute function public.visits_crm_events();

-- ---- 3 · who takes visits, and when -----------------------------------------
create table if not exists public.staff_availability (
  staff_id      uuid primary key references public.profiles (id) on delete cascade,
  tenant_id     uuid not null references public.tenants (id) default public.current_tenant(),
  takes_visits  boolean not null default false,
  -- 0 = Sunday … 6 = Saturday, the days they do visits.
  days          int[] not null default '{1,2,3,4,5}',
  day_start     time not null default '08:30',
  day_end       time not null default '17:00',
  visit_minutes int not null default 60 constraint staff_availability_minutes check (visit_minutes between 15 and 240),
  zone          text not null default 'melbourne-metro',
  updated_at    timestamptz not null default now()
);
comment on table public.staff_availability is
  'Per-estimator visit availability (P6). The slot list the wizard offers is these hours minus booked visits; the zone is the placeholder single zone until the zone map is ruled (V1).';
drop trigger if exists t_staff_availability_updated on public.staff_availability;
create trigger t_staff_availability_updated before update on public.staff_availability
  for each row execute function public.set_updated_at();
alter table public.staff_availability enable row level security;
drop policy if exists staff_availability_staff_all on public.staff_availability;
create policy staff_availability_staff_all on public.staff_availability
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));
revoke all on public.staff_availability from anon;

insert into public.settings (key, value)
values ('visits', '{"horizonDays": 10, "cutoffHours": 24, "windows": {"am": ["09:00", "12:00"], "pm": ["13:00", "16:00"]}, "reminderHour": 18}'::jsonb)
on conflict (key) do nothing;

-- ---- 4 · staff Google Calendar --------------------------------------------------
create table if not exists public.staff_gcal_connections (
  staff_id      uuid primary key references public.profiles (id) on delete cascade,
  google_email  text,
  refresh_token text not null,
  calendar_id   text,
  sync_error    text,
  push_jobs     boolean not null default false,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.staff_gcal_connections is
  'Google Calendar OAuth connection per staff member (Diary → Connect). Server-only: refresh tokens are read exclusively through the service client. push_jobs = booked jobs go to the same calendar.';
drop trigger if exists t_staff_gcal_connections_updated on public.staff_gcal_connections;
create trigger t_staff_gcal_connections_updated before update on public.staff_gcal_connections
  for each row execute function public.set_updated_at();
alter table public.staff_gcal_connections enable row level security;
revoke all on public.staff_gcal_connections from anon, authenticated;

create table if not exists public.staff_gcal_events (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references public.profiles (id) on delete cascade,
  kind            text not null constraint staff_gcal_events_kind check (kind in ('visit', 'job')),
  ref_id          uuid not null,
  google_event_id text not null,
  calendar_id     text not null,
  content_hash    text not null,
  updated_at      timestamptz not null default now(),
  constraint staff_gcal_events_once unique (staff_id, kind, ref_id)
);
comment on table public.staff_gcal_events is
  'Which visits (and, when push_jobs, booked jobs) exist as events in a staff member''s Google calendar. Content hash lets the reconciler skip unchanged events.';
drop trigger if exists t_staff_gcal_events_updated on public.staff_gcal_events;
create trigger t_staff_gcal_events_updated before update on public.staff_gcal_events
  for each row execute function public.set_updated_at();
alter table public.staff_gcal_events enable row level security;
revoke all on public.staff_gcal_events from anon, authenticated;

-- ---- 5 · the write RPCs ---------------------------------------------------------
create or replace function public.visits_guard()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'visits: staff only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.visits_guard() from public, anon, authenticated;

create or replace function public.visit_book(
  p_starts timestamptz, p_ends timestamptz,
  p_account uuid default null, p_property uuid default null, p_estimate uuid default null, p_staff uuid default null,
  p_kind text default 'quote', p_source text default 'staff', p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_phone text; v_addr text; v_suburb text;
begin
  perform public.visits_guard();
  if p_ends <= p_starts then raise exception 'visits: the visit must end after it starts' using errcode = '22023'; end if;
  if p_account is not null then
    select name, phone into v_name, v_phone from public.accounts where id = p_account;
  end if;
  if p_property is not null then
    select concat_ws(' ', address, suburb, state, postcode), suburb into v_addr, v_suburb from public.properties where id = p_property;
  elsif p_account is not null then
    select concat_ws(' ', address, suburb, state, postcode), suburb into v_addr, v_suburb
      from public.properties where account_id = p_account order by created_at limit 1;
  end if;
  begin
    insert into public.visits (account_id, property_id, estimate_id, staff_id, starts_at, ends_at, kind, source, note,
                               address, suburb, customer_name, customer_phone, created_by)
    values (p_account, p_property, p_estimate, p_staff, p_starts, p_ends, coalesce(p_kind, 'quote'), coalesce(p_source, 'staff'), p_note,
            v_addr, v_suburb, v_name, v_phone, auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'visits: that time is already taken for this estimator' using errcode = 'P0001', hint = 'double_booked';
  end;
  return v_id;
end $$;

create or replace function public.visit_set_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.visits_guard();
  if p_status not in ('booked', 'done', 'no_show', 'cancelled', 'rebook') then
    raise exception 'visits: unknown status %', p_status using errcode = '22023';
  end if;
  update public.visits set
    status = p_status,
    outcome_note = case when p_status in ('done', 'no_show') then coalesce(p_note, outcome_note) else outcome_note end,
    outcome_at = case when p_status in ('done', 'no_show') then now() else outcome_at end,
    cancel_reason = case when p_status = 'cancelled' then coalesce(p_note, cancel_reason) else cancel_reason end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = p_id;
  if not found then raise exception 'visits: no such visit' using errcode = 'P0002'; end if;
end $$;

create or replace function public.visit_move(p_id uuid, p_starts timestamptz, p_ends timestamptz, p_staff uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.visits_guard();
  if p_ends <= p_starts then raise exception 'visits: the visit must end after it starts' using errcode = '22023'; end if;
  begin
    update public.visits set starts_at = p_starts, ends_at = p_ends, staff_id = coalesce(p_staff, staff_id),
      status = 'booked', reminder_sent_at = null
    where id = p_id;
  exception when exclusion_violation then
    raise exception 'visits: that time is already taken for this estimator' using errcode = 'P0001', hint = 'double_booked';
  end;
  if not found then raise exception 'visits: no such visit' using errcode = 'P0002'; end if;
end $$;

grant execute on function public.visit_book(timestamptz, timestamptz, uuid, uuid, uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.visit_set_status(uuid, text, text) to authenticated, service_role;
grant execute on function public.visit_move(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
revoke all on function public.visit_book(timestamptz, timestamptz, uuid, uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.visit_set_status(uuid, text, text) from anon;
revoke all on function public.visit_move(uuid, timestamptz, timestamptz, uuid) from anon;

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('visits', 'staff_availability', 'staff_gcal_connections', 'staff_gcal_events')) = 4 as tables_ok,
  exists (select 1 from pg_constraint where conname = 'visits_no_double_booking') as no_double_booking,
  (select count(*) from pg_proc where proname in ('visit_book', 'visit_set_status', 'visit_move', 'visits_crm_events')) = 4 as functions_ok,
  exists (select 1 from pg_trigger where tgname = 't_visits_crm_events') as trigger_ok,
  exists (select 1 from public.settings where key = 'visits') as settings_seeded,
  (select count(*) from pg_policies where tablename in ('visits', 'staff_availability')) as policies;

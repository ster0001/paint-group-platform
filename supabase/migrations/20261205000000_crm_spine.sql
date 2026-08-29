-- =============================================================================
-- CRM session 2.1 · the event spine
--
-- Two tables and one write path:
--
--   tenants     — the A3 ruling ("later-but-cheap-insurance", Tom 29 Aug 2026,
--                 docs/briefs/crm-decisions.md). One row, Paint Group. Every
--                 table created from here on carries a tenant_id defaulting to
--                 it, and its policies are written tenant-aware. There is no
--                 tenant switching and no second tenant: the column and the
--                 policy shape are the whole of the insurance.
--
--   crm_events  — the ONE event log (brief rev 2 §2). Append-only. Every
--                 timeline, every segment, every campaign trigger and every
--                 attribution report reads this table and no other.
--
--   crm_log_event() — the only write path. Client roles get no INSERT grant.
--
-- ---- Three decisions worth stating -------------------------------------
--
-- 1 · `type` is shape-checked, not whitelisted. A CHECK listing every event
--     type reads well and then costs a migration every time a new one is
--     needed — the estimates.source lesson (20260915 widened that CHECK for
--     two new values). The vocabulary lives in lib/crm/events.ts, where the
--     payload schemas live too, and where a unit test can hold it. The
--     database enforces the SHAPE of a type name, and the write path enforces
--     membership of the catalogue.
--
-- 2 · Append-only means an event is never EDITED. UPDATE is blocked by a
--     trigger, so it fails for the service key and the table owner too, not
--     just for client roles. DELETE is blocked by grant only, deliberately:
--     deleting a customer must be able to take their history with it
--     (accounts cascade), which is the erasure path a privacy request needs.
--
-- 3 · `occurred_at` is separate from `recorded_at` because they differ often:
--     a note typed on Monday about Friday's phone call belongs on Friday in
--     the timeline, and on Monday in any "what did we do today" count.
--
-- Idempotent; read-backs at the end.
-- =============================================================================

-- ---- 1 · tenants -----------------------------------------------------------

create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);
comment on table public.tenants is
  'A3 cheap-insurance tenancy: one row today (Paint Group). No tenant switching UI. New tables carry tenant_id defaulting to current_tenant().';

insert into public.tenants (slug, name)
select 'paint-group', 'Paint Group'
 where not exists (select 1 from public.tenants where slug = 'paint-group');

-- The default for every tenant_id column. STABLE, single-row lookup.
create or replace function public.current_tenant()
returns uuid language sql stable set search_path = public as $$
  select id from public.tenants where slug = 'paint-group'
$$;

alter table public.tenants enable row level security;

drop policy if exists tenants_staff_select on public.tenants;
create policy tenants_staff_select on public.tenants
  for select to authenticated using (public.is_staff());

-- ---- 2 · crm_events --------------------------------------------------------

create table if not exists public.crm_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) default public.current_tenant(),

  -- The account is the spine. An event may precede one (an anonymous wizard
  -- visit attributed later), so it is nullable — but a null account_id keeps
  -- the event out of every timeline until it is claimed.
  account_id    uuid references public.accounts (id)     on delete cascade,
  property_id   uuid references public.properties (id)   on delete set null,
  estimate_id   uuid references public.estimates (id)    on delete set null,
  work_order_id uuid references public.work_orders (id)  on delete set null,
  invoice_id    uuid references public.invoices (id)     on delete set null,

  type          text not null
    constraint crm_events_type_shape check (type ~ '^[a-z][a-z0-9_]{2,48}$'),
  source        text not null default 'system'
    constraint crm_events_source_check check (source in ('system', 'staff', 'customer', 'ai')),
  actor_profile_id uuid references public.profiles (id) on delete set null,

  payload       jsonb not null default '{}'::jsonb,

  occurred_at   timestamptz not null default now(),
  recorded_at   timestamptz not null default now(),

  -- Idempotency. A sweep that runs twice writes one row: the second insert
  -- hits this unique index and the write path returns the first row's id.
  dedupe_key    text
);
comment on table public.crm_events is
  'The one CRM event log (brief rev 2 §2). Append-only: never updated, deleted only by cascade when a customer is erased. Written solely through crm_log_event().';

create unique index if not exists crm_events_dedupe_key
  on public.crm_events (dedupe_key) where dedupe_key is not null;

-- The timeline read: one account, newest first.
create index if not exists crm_events_account_idx
  on public.crm_events (account_id, occurred_at desc) where account_id is not null;

-- The sweep read: "everyone who did X since Y".
create index if not exists crm_events_type_idx
  on public.crm_events (tenant_id, type, occurred_at desc);

-- The job reads.
create index if not exists crm_events_estimate_idx
  on public.crm_events (estimate_id) where estimate_id is not null;

alter table public.crm_events enable row level security;

drop policy if exists crm_events_staff_select on public.crm_events;
create policy crm_events_staff_select on public.crm_events
  for select to authenticated
  using (public.is_staff() and tenant_id = public.current_tenant());

-- No insert/update/delete policy at all: the write path is the function below.

-- ---- 3 · append-only, enforced ---------------------------------------------
-- The grant revocations stop client roles. The trigger stops everything else,
-- including a service-key script and a psql session: an event is a record of
-- something that happened, and it does not change afterwards.

create or replace function public.crm_events_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'crm_events is append-only: % on % is not allowed', tg_op, tg_table_name
    using hint = 'Record a correcting event instead of editing the original.';
end $$;

drop trigger if exists t_crm_events_no_update on public.crm_events;
create trigger t_crm_events_no_update before update on public.crm_events
  for each row execute function public.crm_events_no_update();

revoke insert, update, delete on public.crm_events from authenticated, anon;
revoke all on public.tenants from anon;

-- ---- 4 · the write path ----------------------------------------------------
-- Security definer so the caller needs no table grant. Staff write from the
-- session client (the "Log something" chips); server routes and other RPCs
-- write as the service role. Nothing else may call it.

create or replace function public.crm_log_event(
  p_type          text,
  p_account_id    uuid    default null,
  p_payload       jsonb   default '{}'::jsonb,
  p_source        text    default 'system',
  p_occurred_at   timestamptz default null,
  p_estimate_id   uuid    default null,
  p_work_order_id uuid    default null,
  p_invoice_id    uuid    default null,
  p_property_id   uuid    default null,
  p_dedupe_key    text    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_actor uuid := auth.uid();
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_log_event: not permitted' using errcode = '42501';
  end if;

  -- An idempotent write: the same key twice returns the first row, quietly.
  if p_dedupe_key is not null then
    select id into v_id from public.crm_events where dedupe_key = p_dedupe_key;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.crm_events
    (account_id, property_id, estimate_id, work_order_id, invoice_id,
     type, source, actor_profile_id, payload, occurred_at, dedupe_key)
  values
    (p_account_id, p_property_id, p_estimate_id, p_work_order_id, p_invoice_id,
     p_type, p_source, v_actor, coalesce(p_payload, '{}'::jsonb),
     coalesce(p_occurred_at, now()), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  -- Lost a race on the same dedupe key: return the winner's id.
  if v_id is null and p_dedupe_key is not null then
    select id into v_id from public.crm_events where dedupe_key = p_dedupe_key;
  end if;

  return v_id;
end $$;

revoke all on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As STAFF in the SQL editor:
--
-- 1 · the tenant exists, and the default resolves
--     select slug, name from tenants;                    -> paint-group · Paint Group
--     select public.current_tenant() is not null;        -> true
--
-- 2 · a write goes through the function and lands with both timestamps
--     select public.crm_log_event('note_added', null, '{"body":"probe"}'::jsonb, 'staff');
--     select type, source, occurred_at, recorded_at, tenant_id
--       from crm_events order by recorded_at desc limit 1;
--
-- 3 · it is idempotent
--     select public.crm_log_event('note_added', null, '{}'::jsonb, 'staff', null,
--                                 null, null, null, null, 'probe-key-1');
--     select public.crm_log_event('note_added', null, '{}'::jsonb, 'staff', null,
--                                 null, null, null, null, 'probe-key-1');
--     -> the SAME uuid twice, and:
--     select count(*) from crm_events where dedupe_key = 'probe-key-1';   -> 1
--
-- 4 · it is append-only
--     update crm_events set payload = '{}'::jsonb where dedupe_key = 'probe-key-1';
--     -> ERROR: crm_events is append-only: UPDATE on crm_events is not allowed
--
-- 5 · the back door is shut (as a non-staff authenticated user)
--     insert into crm_events (type) values ('sneaky');   -> permission denied
--
-- 6 · tidy the probes away (they are the only rows a delete is wanted for;
--     the grant revocation means this runs as the table owner in the editor)
--     delete from crm_events where dedupe_key = 'probe-key-1' or payload->>'body' = 'probe';

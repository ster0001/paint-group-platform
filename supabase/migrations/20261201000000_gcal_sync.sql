-- =============================================================================
-- Google Calendar sync for contractors (portal · Calendar)
--
--  1. contractor_gcal_connections — one row per contractor who has pressed
--     "Connect Google Calendar" in the portal. Holds the OAuth refresh token
--     and the id of the dedicated "Paint Group Jobs" calendar the app creates
--     in their Google account (scope calendar.app.created — the app can ONLY
--     touch calendars it created itself, never their personal events).
--  2. contractor_gcal_events — one row per work order that has been pushed to
--     Google, mapping work_order_id → google event id, with a content hash so
--     the reconciler only PATCHes events that actually changed.
--
-- Both tables are SERVER-ONLY: RLS enabled with no policies, and every grant
-- to anon/authenticated revoked. All reads/writes go through the service
-- client in lib/gcal/* — the refresh token must never be selectable from a
-- browser session, and column-privilege carve-outs (the contractors-table
-- pattern) are not worth it here because the portal UI only needs a boolean
-- "connected?" plus the Google email, which the server component reads via
-- the service client anyway.
--
-- Idempotent; read-backs at the end.
-- =============================================================================

-- ---- 1 · connections --------------------------------------------------------

create table if not exists public.contractor_gcal_connections (
  contractor_id  uuid primary key references public.contractors (id) on delete cascade,
  google_email   text,
  refresh_token  text not null,
  calendar_id    text,          -- the "Paint Group Jobs" calendar; null until first sync creates it
  sync_error     text,          -- last sync failure, plain English; null = healthy
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.contractor_gcal_connections is
  'Google Calendar OAuth connection per contractor (portal → Calendar → Connect). Server-only: refresh tokens are read exclusively through the service client.';

drop trigger if exists t_contractor_gcal_connections_updated on public.contractor_gcal_connections;
create trigger t_contractor_gcal_connections_updated
  before update on public.contractor_gcal_connections
  for each row execute function public.set_updated_at();

alter table public.contractor_gcal_connections enable row level security;
-- No policies: nothing but the service role may touch this table.
revoke all on public.contractor_gcal_connections from anon, authenticated;

-- ---- 2 · pushed events ------------------------------------------------------

create table if not exists public.contractor_gcal_events (
  work_order_id    uuid primary key references public.work_orders (id) on delete cascade,
  contractor_id    uuid not null references public.contractors (id) on delete cascade,
  google_event_id  text not null,
  calendar_id      text not null,
  content_hash     text not null,
  updated_at       timestamptz not null default now()
);
comment on table public.contractor_gcal_events is
  'Which work orders exist as events in a contractor''s Google calendar. Content hash lets the reconciler skip unchanged events.';

create index if not exists contractor_gcal_events_contractor_idx
  on public.contractor_gcal_events (contractor_id);

drop trigger if exists t_contractor_gcal_events_updated on public.contractor_gcal_events;
create trigger t_contractor_gcal_events_updated
  before update on public.contractor_gcal_events
  for each row execute function public.set_updated_at();

alter table public.contractor_gcal_events enable row level security;
revoke all on public.contractor_gcal_events from anon, authenticated;

-- ---- read-backs -------------------------------------------------------------
-- Expect: both tables exist, rls enabled = true for both, and the grants
-- query returns ZERO rows for anon/authenticated.

select relname, relrowsecurity as rls_enabled
from pg_class
where relname in ('contractor_gcal_connections', 'contractor_gcal_events');

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_name in ('contractor_gcal_connections', 'contractor_gcal_events')
  and grantee in ('anon', 'authenticated');

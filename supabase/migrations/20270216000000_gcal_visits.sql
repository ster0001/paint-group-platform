-- =============================================================================
-- Google Calendar for visits (visit booking addendum A, S5 — 6 Oct 2026).
--
-- info@paintgroup.com.au is a Google Workspace account (Tom, 6 Oct), so the
-- staff connection now also asks for calendar.events and the booked visit goes
-- into the estimator's MAIN calendar as a one-hour event with the customer as
-- a guest (R21, R32), followed by a separate 30-minute "Travel" block with no
-- guests. Google emails the invitation; a decline cancels the visit (R22);
-- Tom deleting the event cancels it and texts the customer, moving it only
-- raises a card (R27). Changes arrive by push notification AND by a
-- five-minute sweep (4.6).
--
--   staff_gcal_events       — gains kind 'travel', and what the sweep last saw
--                             in Google (start, status) so a move or a delete
--                             is a fact the queue can derive a card from.
--   staff_gcal_connections  — the push channel (id, resource, expiry) and the
--                             last sync, so a dead channel is re-made.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. mapping rows: travel blocks, and what Google last said ----------------
alter table public.staff_gcal_events drop constraint if exists staff_gcal_events_kind;
alter table public.staff_gcal_events add constraint staff_gcal_events_kind check (kind in ('visit', 'job', 'travel'));
alter table public.staff_gcal_events add column if not exists google_start timestamptz;
alter table public.staff_gcal_events add column if not exists google_status text;
alter table public.staff_gcal_events add column if not exists moved_seen_at timestamptz;
alter table public.staff_gcal_events add column if not exists moved_acknowledged_at timestamptz;
alter table public.staff_gcal_events add column if not exists last_checked_at timestamptz;
comment on column public.staff_gcal_events.google_start is 'The start Google last reported for our event. Differs from visits.starts_at when Tom moved it in Google (R27: the platform does not follow; a card asks staff to confirm).';

-- ---- 2. the push channel on the estimator's primary calendar --------------------
alter table public.staff_gcal_connections add column if not exists watch_channel_id text;
alter table public.staff_gcal_connections add column if not exists watch_resource_id text;
alter table public.staff_gcal_connections add column if not exists watch_expires_at timestamptz;
alter table public.staff_gcal_connections add column if not exists last_notified_at timestamptz;
alter table public.staff_gcal_connections add column if not exists last_synced_at timestamptz;
create index if not exists staff_gcal_connections_channel_idx on public.staff_gcal_connections (watch_channel_id);

-- ---- 3. a cancelled visit remembers why, so the queue can say "the customer declined" ---
-- (visits.cancel_reason already exists; this is the vocabulary the sweep writes.)
comment on column public.visits.cancel_reason is 'Why the visit was cancelled. The Google sweep writes declined_invitation (the guest declined) or deleted_in_google (the estimator deleted the event).';

-- ---- 4. read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff_gcal_events'
     and column_name in ('google_start', 'google_status', 'moved_seen_at', 'moved_acknowledged_at', 'last_checked_at')) as event_columns,
  5 as _expect_event_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff_gcal_connections'
     and column_name in ('watch_channel_id', 'watch_resource_id', 'watch_expires_at', 'last_notified_at', 'last_synced_at')) as connection_columns,
  5 as _expect_connection_columns,
  (select pg_get_constraintdef(oid) like '%travel%' from pg_constraint where conname = 'staff_gcal_events_kind') as travel_allowed,
  true as _expect_travel_allowed,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('staff_gcal_connections', 'staff_gcal_events')) as user_grants,
  0 as _expect_user_grants;

insert into public._prod_migrations(name) values ('20270216000000_gcal_visits.sql') on conflict (name) do nothing;

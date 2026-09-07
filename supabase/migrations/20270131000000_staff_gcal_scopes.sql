-- 8 Sep 2026 (Tom: "the calendar says the info@paintgroup.com.au calendar is
-- free when it's not") — staff Google connections now remember the scopes
-- Google granted. Connections made from today ask for calendar.readonly as
-- well, so the Diary and the day plan can READ the person's own Google
-- appointments (and the wizard stops offering those times). A connection
-- made before today has scopes null → the Diary card says "Reconnect".
-- Contractor connections are untouched: the app still never reads a
-- painter's own calendar.

alter table public.staff_gcal_connections add column if not exists scopes text;
comment on column public.staff_gcal_connections.scopes is
  'Space-separated OAuth scopes Google granted at connect time. Null = connected before 8 Sep 2026 (write-only to the app-created calendar); reconnect to read.';

-- ---- read-back ---------------------------------------------------------------
select
  exists (select 1 from information_schema.columns where table_name = 'staff_gcal_connections' and column_name = 'scopes') as scopes_column_ok,
  (select count(*) from public.staff_gcal_connections) as staff_connections,
  (select count(*) from public.staff_gcal_connections where scopes like '%calendar.readonly%') as can_read_already;

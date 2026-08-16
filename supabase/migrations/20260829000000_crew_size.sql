-- =============================================================================
-- Crew size — how many painters a contractor can put on the tools
--
-- A contractor is often a small firm, not one person. Knowing the crew size is
-- what makes overlapping jobs readable: three jobs at once is fine for a crew
-- of four and a problem for a sole trader.
--
-- Nothing here PREVENTS overlapping bookings — a contractor is free to accept
-- several jobs starting the same day, and always was. This just gives the
-- office the number to judge it by.
-- =============================================================================

alter table public.contractors
  add column if not exists crew_size integer not null default 1;

alter table public.contractors
  drop constraint if exists contractors_crew_size_sane;
alter table public.contractors
  add constraint contractors_crew_size_sane check (crew_size between 1 and 99);

-- IMPORTANT: migration 20260824010000 replaced the table-wide UPDATE grant with
-- an explicit column allow-list. A column added afterwards is NOT writable until
-- it is granted, so a new field silently fails to save without this line.
grant update (crew_size) on public.contractors to authenticated;

comment on column public.contractors.crew_size is
  'Painters this contractor can field at once. Display/capacity only — never a hard limit on bookings.';

-- ---- Verification -----------------------------------------------------------
-- As a contractor:  update contractors set crew_size = 3 where profile_id = auth.uid();
--   -> allowed. Setting crew_size = 0 or 100 must fail the check constraint.
-- Confirm the grant took:
--   select column_name from information_schema.column_privileges
--    where table_name='contractors' and grantee='authenticated'
--      and privilege_type='UPDATE' and column_name='crew_size';

-- =============================================================================
-- The gate (visit booking addendum A, S6 — 7 Oct 2026).
--
-- R5: the last wizard question before the price range asks for full name,
-- email and mobile. R6: a Settings switch (Booking rules → gate order) tests
-- the other order, range first, changed by hand. R7: in "range first", any
-- option on the range screen asks for the details before going further.
--
-- Each wizard session records WHICH version it saw (frozen at its first save,
-- so flipping the switch mid-session changes nothing for it) and where it got
-- to, so the two can be compared on the dashboard's "Where estimates go":
--
--   gate_version      details_first | range_first
--   gate_shown_at     the gate screen was reached (details first), or the
--                     details were asked for on the range screen (range first)
--   gate_completed_at name + email + mobile given
--   range_shown_at    the guide price was shown
--   range_option      what they did next: tighten | speak | visit | message
--
-- `wizard_sessions` IS `wizard_drafts` (20270107). Nothing new is stored
-- anywhere else; the dashboard derives the report from these columns.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wizard_drafts add column if not exists gate_version text
  constraint wizard_drafts_gate_version_check check (gate_version is null or gate_version in ('details_first', 'range_first'));
alter table public.wizard_drafts add column if not exists gate_shown_at timestamptz;
alter table public.wizard_drafts add column if not exists gate_completed_at timestamptz;
alter table public.wizard_drafts add column if not exists range_shown_at timestamptz;
alter table public.wizard_drafts add column if not exists range_option text
  constraint wizard_drafts_range_option_check check (range_option is null or range_option in ('tighten', 'speak', 'visit', 'message'));
alter table public.wizard_drafts add column if not exists range_option_at timestamptz;
create index if not exists wizard_drafts_gate_idx on public.wizard_drafts (started_at, gate_version) where gate_version is not null;

comment on column public.wizard_drafts.gate_version is 'Which gate order this session saw (R6), frozen at its first save. Null = a session from before S6.';

-- ---- read-back: compare to _expect_ before calling this live ----------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wizard_drafts'
     and column_name in ('gate_version', 'gate_shown_at', 'gate_completed_at', 'range_shown_at', 'range_option', 'range_option_at')) as gate_columns,
  6 as _expect_gate_columns,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'wizard_drafts_gate_idx') as gate_index,
  1 as _expect_gate_index;

insert into public._prod_migrations(name) values ('20270217000000_wizard_gate.sql') on conflict (name) do nothing;

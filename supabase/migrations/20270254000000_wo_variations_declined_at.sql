-- =============================================================================
-- The painter's Decline and the office's Reject both fail (found 12 Oct 2026,
-- e2e red on main with unchanged code).
--
-- wo_contractor_decline_variation (20270220, 7 Oct) and
-- wo_office_reject_variation (20270240, 8 Oct) both run
--     update public.wo_variations set status = 'declined', declined_at = now(), …
-- but wo_variations never had a declined_at column — the one in 20260815 is on
-- ESTIMATES. Postgres rejects the whole statement (42703), so on production:
--   * a painter tapping Decline → Send to the office got "Couldn't send that
--     just now — check your signal", and the change stayed at customer_approved,
--     holding the job's stage gate ("variations still waiting on a decision");
--   * the office's Reject on PC Command got "Couldn't reject that just now"
--     (reportError → Sentry, where "pc.rejectVariation").
-- Nothing was written by either, so there is nothing to repair — only the
-- column to add. Both function bodies are right once it exists; the moment the
-- row went to 'declined' is exactly what the column is for.
--
-- Converges on a re-run: add column if not exists.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wo_variations
  add column if not exists declined_at timestamptz;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wo_variations'
     and column_name = 'declined_at') as declined_at_column, 1 as _expect_declined_at_column,
  (select prosrc like '%declined_at = now()%' from pg_proc where proname = 'wo_contractor_decline_variation') as decline_writes_it, true as _expect_decline_writes_it,
  (select prosrc like '%declined_at = now()%' from pg_proc where proname = 'wo_office_reject_variation') as reject_writes_it, true as _expect_reject_writes_it;

insert into public._prod_migrations(name) values ('20270254000000_wo_variations_declined_at.sql') on conflict (name) do nothing;

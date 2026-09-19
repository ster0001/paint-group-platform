-- =============================================================================
-- Home dashboard v2 · session 1 · metrics_daily — the nightly rollup
--
-- Period metrics are pure functions over rows, run live for the range on the
-- page. The 12-month charts (target pace, spend vs sales) would otherwise
-- re-read a year of rows on every load, so a nightly cron computes every
-- period metric for the day just ended (Melbourne) and keeps one row per
-- (day, metric). The value is the SAME function's answer — the rollup is a
-- cache of the metric, never a second definition (one-source rule). A day is
-- recomputed when the cron runs again (upsert), so a late-arriving fact
-- (a backdated acceptance) corrects itself the next night.
--
-- Read by owner/admin only (⚑2 — some metrics carry margin); written by the
-- cron through the service role.
-- =============================================================================

create table if not exists public.metrics_daily (
  day          date not null,
  metric_key   text not null constraint metrics_daily_key_shape check (metric_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  value        numeric not null,
  rows         integer not null default 0 constraint metrics_daily_rows_nonneg check (rows >= 0),
  unit         text not null constraint metrics_daily_unit_check check (unit in ('count', 'cents', 'pct', 'days', 'hours')),
  computed_at  timestamptz not null default now(),
  primary key (day, metric_key)
);
create index if not exists metrics_daily_metric_day_idx on public.metrics_daily (metric_key, day desc);
comment on table public.metrics_daily is
  'Nightly cache of every period metric for one Melbourne day, written by /api/cron/metrics-daily from the same functions the page runs live. Never a second definition.';

alter table public.metrics_daily enable row level security;
drop policy if exists metrics_daily_money_roles on public.metrics_daily;
create policy metrics_daily_money_roles on public.metrics_daily
  for select to authenticated using (public.dashboard_sees_money());
-- No insert/update policy for authenticated: only the service role (the cron) writes.

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'metrics_daily') as table_expect_1,
  (select count(*) from pg_policies where tablename = 'metrics_daily')                                            as policies_expect_1,
  (select relrowsecurity from pg_class where relname = 'metrics_daily')                                            as rls_on_expect_true,
  (select count(*) from public.metrics_daily)                                                                      as rows_so_far;

insert into public._prod_migrations(name) values ('20270180000000_dashboard_metrics_daily.sql') on conflict (name) do nothing;

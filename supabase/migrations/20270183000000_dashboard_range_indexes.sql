-- Home dashboard v2 · session 6 — the range reads the dashboard makes every
-- load, each on a column that had no index: wizard sessions by when they
-- started (the funnel, 1.1 s on the test project), CRM events by when they
-- happened (Activity), payments by the day they landed (Received, Revenue
-- received), estimates by acceptance (Sales $, Contracts signed) and work
-- orders by when they entered their stage (signed-off jobs for the P&L and
-- the PC materials card). Converges on a re-run.
set lock_timeout = '15s';

create index if not exists wizard_drafts_started_idx      on public.wizard_drafts (started_at desc);
create index if not exists crm_events_occurred_idx        on public.crm_events (occurred_at desc);
create index if not exists payments_paid_on_idx           on public.payments (paid_on) where status = 'succeeded';
create index if not exists estimates_accepted_at_idx      on public.estimates (accepted_at desc) where accepted_at is not null;
create index if not exists work_orders_stage_entered_idx  on public.work_orders (stage, stage_entered_at desc);

-- Read back: five rows, all present.
select indexname, tablename from pg_indexes
 where schemaname = 'public'
   and indexname in ('wizard_drafts_started_idx','crm_events_occurred_idx','payments_paid_on_idx','estimates_accepted_at_idx','work_orders_stage_entered_idx')
 order by indexname;
select (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('wizard_drafts_started_idx','crm_events_occurred_idx','payments_paid_on_idx','estimates_accepted_at_idx','work_orders_stage_entered_idx')) as indexes_expect_5;

insert into public._prod_migrations(name) values ('20270183000000_dashboard_range_indexes.sql') on conflict (name) do nothing;

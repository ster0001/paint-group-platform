-- =============================================================================
-- Every foreign key has an index — the eleven that did not (20 Sep 2026)
--
-- CLAUDE.md: "Every FK and every token/status column used in a WHERE has an
-- index, created in the same migration." An audit of pg_constraint against
-- pg_index on the test project found eleven FK columns with none. Found the
-- hard way: tearing down the volume dataset (scripts/portal/seed-volume.mjs
-- --teardown) hit the statement timeout, because deleting a work order makes
-- Postgres run `update crm_events set work_order_id = null where
-- work_order_id = $1` — a sequential scan of 169k events, once per work
-- order, 20k times. The same scans run on production on every delete of a
-- work order, property or estimate, and on every `on delete set null`.
--
-- SCOPE: the eleven FKs on the tables a work order / estimate / property
-- delete cascades through. The same audit over the whole public schema lists
-- ~130 unindexed FK columns, most of them `created_by` / `approved_by` audit
-- pointers at profiles and `tenant_id` columns that are never deleted from;
-- indexing all of those is a separate decision for Tom (cost: ~130 indexes
-- on write-heavy tables), recorded in docs/reference/ as a follow-up.
-- Plain b-tree indexes, `if not exists` so the file converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

create index if not exists crm_events_work_order_idx        on public.crm_events (work_order_id);
create index if not exists crm_events_property_idx          on public.crm_events (property_id);
create index if not exists crm_events_actor_profile_idx     on public.crm_events (actor_profile_id);
create index if not exists warranties_estimate_idx          on public.warranties (estimate_id);
create index if not exists invoices_job_idx                 on public.invoices (job_id);
create index if not exists wo_surfaces_removed_by_var_idx   on public.wo_surfaces (removed_by_variation);
create index if not exists wo_signoff_client_unavail_by_idx on public.wo_signoff (client_unavailable_by);
create index if not exists wo_signoff_ext_approved_by_idx   on public.wo_signoff (extension_approved_by);
create index if not exists wo_signoff_report_draft_idx      on public.wo_signoff (report_draft_id);
create index if not exists estimates_presentation_idx       on public.estimates (presentation_id);
create index if not exists estimates_rate_card_idx          on public.estimates (rate_card_id);

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
     'crm_events_work_order_idx','crm_events_property_idx','crm_events_actor_profile_idx','warranties_estimate_idx',
     'invoices_job_idx','wo_surfaces_removed_by_var_idx','wo_signoff_client_unavail_by_idx','wo_signoff_ext_approved_by_idx',
     'wo_signoff_report_draft_idx','estimates_presentation_idx','estimates_rate_card_idx')) as indexes_expect_11;

insert into public._prod_migrations(name) values ('20270182000000_fk_indexes_missing.sql') on conflict (name) do nothing;

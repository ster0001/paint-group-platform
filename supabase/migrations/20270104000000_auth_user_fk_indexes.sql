-- @no-transaction
-- =====================================================================
-- CI · e2e cleanup timing out (5 Sep 2026). Deleting ONE auth user on the
-- test project took 13.5 s, measured over the C1 connection string:
--
--   delete from auth.users where id = $1;   -- 13,554 ms, one row
--
-- Every column that references auth.users(id) is checked on that delete,
-- and the big ones have no index on the referencing column, so each user
-- delete is a sequential scan of the whole table:
--
--   wo_photos.taken_by                 500,000 rows   on delete set null
--   wo_events.actor                    100,000 rows   on delete set null
--   estimates.site_check_cleared_by     60,950 rows   no action
--   invoices.created_by                 40,000 rows   on delete set null
--   payments.recorded_by                 6,666 rows   on delete set null
--   wizard_leads.user_id                   713 rows   no action
--
-- e2e/trade-org-rls.spec.ts deletes four test users in its afterAll hook,
-- e2e/account-rls.spec.ts two: 4 × 13.5 s on a quiet database, more when a
-- second CI run shares it, and the hook's 60 s budget is gone. The failed
-- hook then leaves the users behind (109 orphaned pg.e2e.* logins found).
-- Production has the same shape; deleting a staff or customer login there
-- (a real thing — offboarding, a customer's deletion request) pays the
-- same scans as the tables grow.
--
-- Partial indexes (WHERE ... IS NOT NULL): the FK check only ever looks up
-- a non-null value, and most of these columns are null, so the indexes
-- stay small. CONCURRENTLY so nothing locks on a live database; that is
-- why this file carries `-- @no-transaction` (see 20261202 for the rule:
-- run each statement on its own, never inside begin/commit; the C1 runner
-- does that itself). `if not exists` makes every statement safe to re-run.
-- =====================================================================

create index concurrently if not exists wo_photos_taken_by_idx
  on public.wo_photos (taken_by) where taken_by is not null;

create index concurrently if not exists wo_events_actor_idx
  on public.wo_events (actor) where actor is not null;

create index concurrently if not exists estimates_site_check_cleared_by_idx
  on public.estimates (site_check_cleared_by) where site_check_cleared_by is not null;

create index concurrently if not exists invoices_created_by_idx
  on public.invoices (created_by) where created_by is not null;

create index concurrently if not exists payments_recorded_by_idx
  on public.payments (recorded_by) where recorded_by is not null;

create index concurrently if not exists wizard_leads_user_id_idx
  on public.wizard_leads (user_id) where user_id is not null;

-- Readback (paste the result in chat): expect 6 rows, is_valid = true on
-- every one. A failed CONCURRENTLY build leaves an INVALID index behind
-- that silently does nothing — drop it and run that statement again.
select i.relname as index_name, idx.indisvalid as is_valid, pg_size_pretty(pg_relation_size(i.oid)) as size
  from pg_index idx join pg_class i on i.oid = idx.indexrelid
 where i.relname in ('wo_photos_taken_by_idx','wo_events_actor_idx','estimates_site_check_cleared_by_idx',
                     'invoices_created_by_idx','payments_recorded_by_idx','wizard_leads_user_id_idx')
 order by 1;

-- =============================================================================
-- Exterior typicals: take the write privileges off anon (Exterior wizard v2,
-- S6 follow-up, 20 Oct 2026).
--
-- 20270278 created exterior_typicals and granted select to anon and
-- authenticated; its read-back expected anon to have NO insert privilege,
-- and it had one anyway: the project default privileges still grant table
-- writes to anon, and nothing took them away. Row-level security blocked
-- every anonymous write regardless (proved on the test project: an anon
-- insert fails with 42501, an anon update touches no row), so nothing was
-- exposed -- but the privilege picture should say what the policies do.
-- Converges on a re-run. Run on BOTH projects.
-- =============================================================================
set lock_timeout = '15s';

revoke insert, update, delete, truncate, references, trigger on public.exterior_typicals from anon;

-- ---- read-back: compare to the _expect_ columns before calling this live ----
select
  has_table_privilege('anon', 'public.exterior_typicals', 'select') as anon_reads, true as _expect_anon_reads,
  has_table_privilege('anon', 'public.exterior_typicals', 'insert') as anon_inserts, false as _expect_anon_inserts,
  has_table_privilege('anon', 'public.exterior_typicals', 'update') as anon_updates, false as _expect_anon_updates,
  has_table_privilege('authenticated', 'public.exterior_typicals', 'insert') as authenticated_inserts, true as _expect_authenticated_inserts,
  (select count(*) from public.exterior_typicals where version = 1) as rows_v1, 9 as _expect_rows_v1;

insert into public._prod_migrations(name) values ('20270280000000_exterior_typicals_revoke_anon_writes.sql') on conflict (name) do nothing;

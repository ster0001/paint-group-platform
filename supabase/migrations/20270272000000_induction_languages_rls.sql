-- 20270272 · induction_languages: painters and staff read it, a customer does not
--
-- Step 6 of the induction brief proves customer-role RLS denial for every table the
-- build added. induction_languages (20270267) was readable by any signed-in user,
-- including a customer, because the picker read it directly. The join page and the
-- picker read through induction_languages_offered() (definer, anon-callable) anyway,
-- so the table policy can be the same as every other induction table: staff, a
-- contractor, a worker login. Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

drop policy if exists induction_languages_read on public.induction_languages;
create policy induction_languages_read on public.induction_languages
  for select to authenticated using (public.is_staff() or public.current_contractor_id() is not null or public.is_worker());

-- ---- read-back ------------------------------------------------------------------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'induction_languages') as policies, 1 as _expect_policies,
  (select position('is_staff' in qual) > 0 from pg_policies where schemaname = 'public' and tablename = 'induction_languages' and policyname = 'induction_languages_read') as gated, true as _expect_gated,
  has_function_privilege('anon', 'public.induction_languages_offered()', 'execute') as offered_by_anon, true as _expect_offered_by_anon;

insert into public._prod_migrations(name) values ('20270272000000_induction_languages_rls.sql') on conflict (name) do nothing;

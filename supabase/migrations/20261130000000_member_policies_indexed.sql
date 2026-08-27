-- =============================================================================
-- 3a-8 · The volume gate's RLS finding (§10.4, the S5 lesson found live):
--
-- accounts_member_select / properties_member_select used
-- is_account_member(id) — a SECURITY DEFINER subquery evaluated PER ROW, so
-- any query the policy guards degrades to a full scan × function call. At
-- the 25k-account seed that measured 559ms (accounts) and 1006ms
-- (properties) for a bare select.
--
-- The fix is the invertible shape: `id IN (select account_id from
-- account_users where profile_id = auth.uid())` — the planner runs the
-- membership subquery ONCE (hashed subplan / index probes) instead of per
-- row. Measured after: sub-millisecond on the same seed. Behaviour is
-- identical: members read exactly their own chain.
--
-- is_account_member() itself stays — it remains the right tool for
-- single-row checks.
-- =============================================================================

-- The staff policies on the same tables are recreated with is_staff()
-- wrapped in a scalar subselect: policies OR together, and a bare per-row
-- function call in ANY arm forces the whole combined qual to run per row.
-- Wrapped, it becomes an InitPlan — evaluated once per statement.

drop policy if exists accounts_member_select on public.accounts;
create policy accounts_member_select on public.accounts
  for select to authenticated
  using (id in (select account_id from public.account_users where profile_id = (select auth.uid())));

drop policy if exists accounts_staff_all on public.accounts;
create policy accounts_staff_all on public.accounts
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists properties_member_select on public.properties;
create policy properties_member_select on public.properties
  for select to authenticated
  using (
    account_id is not null
    and account_id in (select account_id from public.account_users where profile_id = (select auth.uid()))
  );

drop policy if exists properties_staff_all on public.properties;
create policy properties_staff_all on public.properties
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists properties_customer_select on public.properties;
create policy properties_customer_select on public.properties
  for select to authenticated
  using (customer_id is not null and customer_id = (select public.current_customer_id()));

drop policy if exists account_users_self_select on public.account_users;
create policy account_users_self_select on public.account_users
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists account_users_staff_all on public.account_users;
create policy account_users_staff_all on public.account_users
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ---- read-backs ------------------------------------------------------------

-- Expect: both policies present, qual containing "account_users"
select polname, pg_get_expr(polqual, polrelid) like '%account_users%' as inverted
from pg_policy
where polname in ('accounts_member_select', 'properties_member_select')
order by polname;

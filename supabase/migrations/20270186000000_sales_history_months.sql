-- 20270186 · Recorded sales months (Tom, 20 Sep 2026).
--
-- "The previous sales data is incorrect — update the last 12 months to
-- Aug 26 to match PaintScout. All future sales data to be based off
-- accurate signed jobs." The months before the platform took over were
-- sold in PaintScout; the Airtable history the platform imported does not
-- agree with PaintScout's Total Sold by month (dates and statuses drifted).
-- PaintScout is the book of record for those months, so the owner types
-- each month's figure ONCE here and the dashboard reads it in place of the
-- imported estimates for that month — Sales $, the target card, contracts
-- signed and the spend-vs-sales trend. A month with no row is the
-- platform's own accepted estimates, which is every month from the cutover
-- on. Nothing is deleted: the imported estimates keep their history.
set lock_timeout = '15s';

create table if not exists public.sales_history_months (
  month        date primary key constraint sales_history_month_is_first check (month = date_trunc('month', month)::date),
  sales_cents  bigint not null constraint sales_history_sales_nonneg check (sales_cents >= 0),
  -- The number of jobs signed that month, when the source says; null = not recorded (the tile says so).
  accepted     integer constraint sales_history_accepted_nonneg check (accepted is null or accepted >= 0),
  source       text not null default 'paintscout' constraint sales_history_source_shape check (source ~ '^[a-z][a-z0-9_]{1,30}$'),
  note         text not null default '',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.sales_history_months enable row level security;
-- Every staff login reads them (a sales login's Sales $ tile must agree with the owner's); only money roles write.
drop policy if exists sales_history_months_staff_read on public.sales_history_months;
create policy sales_history_months_staff_read on public.sales_history_months
  for select to authenticated using (public.is_staff());
drop policy if exists sales_history_months_money_write on public.sales_history_months;
create policy sales_history_months_money_write on public.sales_history_months
  for all to authenticated using (public.dashboard_sees_money()) with check (public.dashboard_sees_money());
drop trigger if exists t_sales_history_months_touch on public.sales_history_months;
create trigger t_sales_history_months_touch before update on public.sales_history_months
  for each row execute function public.touch_updated_at();

-- Read back: the table, its RLS, both policies, the trigger.
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'sales_history_months') as table_present, 1 as _expect_table,
  (select relrowsecurity from pg_class where oid = 'public.sales_history_months'::regclass) as rls_on, true as _expect_rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_history_months') as policies, 2 as _expect_policies,
  (select count(*) from pg_trigger where tgname = 't_sales_history_months_touch') as trigger_present, 1 as _expect_trigger;

insert into public._prod_migrations(name) values ('20270186000000_sales_history_months.sql') on conflict (name) do nothing;

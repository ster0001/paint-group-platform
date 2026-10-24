-- =============================================================================
-- Paint Home — Session 3: the brand on every lead (docs/briefs/paint-home.md section 5)
--   One tag, set when the wizard session starts, that says which door a customer came
--   through: paintgroup (the default, never written by the pages) or painthome.
--   1. wizard_drafts.brand (the session IS the lead; written by the draft route)
--   2. estimates.brand (written by the submit route from the session)
--   3. work_orders.brand and invoices.brand, CARRIED by trigger from the estimate on
--      insert — no screen writes them. Indexed where a filter will read them (Session 5).
-- Converging: add column if not exists, or replace, drop trigger if exists. Read-back at
-- the end; compare to _expect_.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wizard_drafts add column if not exists brand text not null default 'paintgroup'
  constraint wizard_drafts_brand_check check (brand in ('paintgroup', 'painthome'));
alter table public.estimates add column if not exists brand text not null default 'paintgroup'
  constraint estimates_brand_check check (brand in ('paintgroup', 'painthome'));
alter table public.work_orders add column if not exists brand text not null default 'paintgroup'
  constraint work_orders_brand_check check (brand in ('paintgroup', 'painthome'));
alter table public.invoices add column if not exists brand text not null default 'paintgroup'
  constraint invoices_brand_check check (brand in ('paintgroup', 'painthome'));

create index if not exists wizard_drafts_brand_idx on public.wizard_drafts (brand) where brand <> 'paintgroup';
create index if not exists estimates_brand_idx on public.estimates (brand) where brand <> 'paintgroup';
create index if not exists work_orders_brand_idx on public.work_orders (brand) where brand <> 'paintgroup';
create index if not exists invoices_brand_idx on public.invoices (brand) where brand <> 'paintgroup';

comment on column public.estimates.brand is 'Paint Home brief section 5: which shopfront the lead came through. Set by the wizard submit route from the session; carried to the work order and the invoice by trigger.';

-- ---- carry: estimate -> work order, estimate -> invoice (on insert) -------------------
create or replace function public.brand_carry_from_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estimate_id is not null then
    select e.brand into new.brand from public.estimates e where e.id = new.estimate_id;
    if new.brand is null then new.brand := 'paintgroup'; end if;
  end if;
  return new;
end;
$$;
-- A trigger function: no grant (CLAUDE.md), it runs as the owner.

drop trigger if exists t_work_orders_brand on public.work_orders;
create trigger t_work_orders_brand before insert on public.work_orders
  for each row execute function public.brand_carry_from_estimate();

drop trigger if exists t_invoices_brand on public.invoices;
create trigger t_invoices_brand before insert on public.invoices
  for each row execute function public.brand_carry_from_estimate();

-- Existing rows: every work order and invoice follows its estimate (all paintgroup today; converges).
update public.work_orders w set brand = e.brand from public.estimates e where e.id = w.estimate_id and w.brand <> e.brand;
update public.invoices i set brand = e.brand from public.estimates e where e.id = i.estimate_id and i.brand <> e.brand;

-- ---- read-back: compare to the _expect_ values ---------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'brand' and table_name in ('wizard_drafts', 'estimates', 'work_orders', 'invoices')) as brand_columns, 4 as _expect_brand_columns,
  (select count(*) from pg_trigger where tgname in ('t_work_orders_brand', 't_invoices_brand')) as carry_triggers, 2 as _expect_carry_triggers,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'brand_carry_from_estimate') as carry_fn, 1 as _expect_carry_fn,
  (select count(*) from public.estimates where brand = 'painthome') as painthome_estimates_now;

insert into public._prod_migrations(name) values ('20270300000000_paint_home_brand.sql') on conflict (name) do nothing;

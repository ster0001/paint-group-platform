-- =============================================================================
-- 20270316 . Paint Home wording for the automations (A-B, 17 Nov 2026)
-- =============================================================================
-- Ruling A-B (Tom, 11 Nov 2026): per-brand wording is one table. The Paint
-- Group wording stays where it is (the messaging settings row, edited at
-- Settings > Automations); a row here is the Paint Home wording for ONE
-- template field. No row = the Paint Group wording, whose brand placeholder
-- already names the right brand. Read by the sweeps that know the brand
-- (lib/messaging/brandWording.ts), written by staff from the same screen.
--
-- 1 . automation_brand_wording (brand, field) -> body. RLS on; staff read
--     and write; nobody else. The field is a template field name (shape
--     checked), the body any text up to 4000 characters.
-- =============================================================================

set lock_timeout = '15s';

create table if not exists public.automation_brand_wording (
  brand       text not null check (brand in ('painthome')),
  field       text not null check (field ~ '^[a-zA-Z][a-zA-Z0-9]{1,79}$'),
  body        text not null check (length(body) between 1 and 4000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (brand, field)
);

alter table public.automation_brand_wording enable row level security;
drop policy if exists automation_brand_wording_staff on public.automation_brand_wording;
create policy automation_brand_wording_staff on public.automation_brand_wording
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on table public.automation_brand_wording from anon;
grant select, insert, update, delete on table public.automation_brand_wording to authenticated;
grant select on table public.automation_brand_wording to service_role;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'automation_brand_wording') as wording_table, 1 as _expect_wording_table,
  (select relrowsecurity from pg_class where oid = 'public.automation_brand_wording'::regclass) as wording_rls, true as _expect_wording_rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'automation_brand_wording') as wording_policies, 1 as _expect_wording_policies,
  (select has_table_privilege('anon', 'public.automation_brand_wording', 'select')) as wording_anon_read, false as _expect_wording_anon_read,
  (select has_table_privilege('authenticated', 'public.automation_brand_wording', 'insert')) as wording_auth_write, true as _expect_wording_auth_write;

insert into public._prod_migrations(name) values ('20270316000000_automation_brand_wording.sql') on conflict (name) do nothing;

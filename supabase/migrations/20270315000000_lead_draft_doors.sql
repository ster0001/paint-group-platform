-- =============================================================================
-- 20270315 · The lead page door (automations L5-L7, Tom 17 Nov 2026)
-- =============================================================================
-- Ruling (Tom, 17 Nov): the links in L5, L6 and L7 land on the lead page
-- (/e/[token]). Its Carry on and Book a visit buttons open the quote stage or
-- the visit page. A browser that is not the one the draft was built in gets a
-- six-digit code texted to the mobile on file, and the right code opens THAT
-- draft for this browser. Nothing that signs anyone in travels in a link.
--
-- Today a draft opens for two people only (lib/supabase/guards.ts
-- customerOwnsDraft): the anonymous session that built it, or a portal login
-- on its account. A phone code proves the mobile, not the email, so it must
-- never sign anyone into the account: it opens one draft, nothing more.
--
-- 1 . estimate_draft_doors: one row per (estimate, login) the code opened.
--     RLS on with no policies: only the service role reads or writes it (the
--     door route grants, the guard reads). A door works while the estimate is
--     an unsent draft; the guard checks that, not this table.
-- =============================================================================

set lock_timeout = '15s';

create table if not exists public.estimate_draft_doors (
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  via         text not null default 'lead_code' check (via in ('lead_code')),
  granted_at  timestamptz not null default now(),
  primary key (estimate_id, user_id)
);
create index if not exists estimate_draft_doors_user_idx on public.estimate_draft_doors (user_id);

alter table public.estimate_draft_doors enable row level security;
revoke all on table public.estimate_draft_doors from anon, authenticated;
grant select, insert on table public.estimate_draft_doors to service_role;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'estimate_draft_doors') as doors_table, 1 as _expect_doors_table,
  (select relrowsecurity from pg_class where oid = 'public.estimate_draft_doors'::regclass) as doors_rls, true as _expect_doors_rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'estimate_draft_doors') as doors_policies, 0 as _expect_doors_policies,
  (select has_table_privilege('authenticated', 'public.estimate_draft_doors', 'select')) as doors_auth_read, false as _expect_doors_auth_read,
  (select has_table_privilege('anon', 'public.estimate_draft_doors', 'insert')) as doors_anon_write, false as _expect_doors_anon_write,
  (select count(*) from pg_indexes where indexname = 'estimate_draft_doors_user_idx') as doors_user_index, 1 as _expect_doors_user_index;

insert into public._prod_migrations(name) values ('20270315000000_lead_draft_doors.sql') on conflict (name) do nothing;

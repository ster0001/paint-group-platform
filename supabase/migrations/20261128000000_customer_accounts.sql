-- ============================================================================
-- 3a-1 · The customer identity layer: accounts → properties → (estimates, invoices)
--
-- Resolves the linking half of docs/briefs/customer-identity-link.md:
-- every customer — residential or trade — is an ACCOUNT; accounts own
-- PROPERTIES; estimates and invoices link into the chain. Residential vs
-- trade is a column + feature gates, never schema (experience map §3).
--
-- Deliberate decisions (documented in docs/briefs/customer-identity-link.md
-- resolution note):
--   · The legacy `customers` table (3 rows, join-to-profile only) is NOT
--     built on and NOT dropped here. `properties.customer_id` becomes
--     optional; the account chain is the identity layer from now on.
--   · account_users rows are created ONLY through verified auth (the 3a-2
--     magic-link flow). An unverified email typed into the wizard must never
--     grant read access to an existing account's data — so the wizard links
--     the ESTIMATE to the account, never the anonymous user.
--   · No customer-select policy on estimates or invoices: builder_state
--     carries margin data, so customers keep reading rendered, view-scoped
--     payloads server-side (the standing role-view rule). Members read only
--     accounts, their own membership rows, and properties.
--   · invoices.account_id NOT NULL is deferred until the backfill is
--     verified (audit ruling), same as customer_id.
--
-- Idempotent; read-backs at the end. Tom pastes this in the SQL editor
-- between gate runs.
-- ============================================================================

-- ---- 1 · accounts ----------------------------------------------------------

create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  account_type text not null default 'residential'
    constraint accounts_type_check check (account_type in ('residential', 'trade')),
  -- The account seed is the email captured at first estimate save. Stored
  -- normalised (lower/trim) by the app; the unique index below is on
  -- lower(email) as belt and braces.
  email        text not null
    constraint accounts_email_sane check (position('@' in email) > 1),
  name         text,   -- person or organisation ("Harcourts Northcote")
  phone        text,
  -- Per-account gate overrides (e.g. lifted wizard limits granted by the
  -- office). Defaults live in Settings; this holds only exceptions.
  flags        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.accounts is
  'One per customer (residential or trade). Owns properties; estimates/invoices link in. Seeded from the email captured at first estimate save.';

create unique index if not exists accounts_email_key on public.accounts (lower(email));
create index if not exists accounts_type_idx on public.accounts (account_type);

drop trigger if exists t_accounts_updated on public.accounts;
create trigger t_accounts_updated before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

-- ---- 2 · account_users (join now, single-user UI in v1 — ⚑6) ---------------

create table if not exists public.account_users (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'owner'
    constraint account_users_role_check check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  constraint account_users_unique unique (account_id, profile_id)
);
comment on table public.account_users is
  'Verified logins on an account. Rows are created only by server code after email verification (magic link) — never from an unverified wizard email.';

create index if not exists account_users_profile_idx on public.account_users (profile_id);

alter table public.account_users enable row level security;

-- ---- 3 · membership helper -------------------------------------------------
-- SECURITY DEFINER so a policy can ask the question without the caller
-- needing read access to account_users (the WO-loop RLS-subquery lesson).

create or replace function public.is_account_member(p_account uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_users
     where account_id = p_account and profile_id = auth.uid()
  )
$$;

-- ---- 4 · policies ----------------------------------------------------------

drop policy if exists accounts_staff_all on public.accounts;
create policy accounts_staff_all on public.accounts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists accounts_member_select on public.accounts;
create policy accounts_member_select on public.accounts
  for select to authenticated using (public.is_account_member(id));

drop policy if exists account_users_staff_all on public.account_users;
create policy account_users_staff_all on public.account_users
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists account_users_self_select on public.account_users;
create policy account_users_self_select on public.account_users
  for select to authenticated using (profile_id = auth.uid());

-- ---- 5 · properties join the account chain ---------------------------------
-- The table has existed since the initial schema with zero live rows and a
-- NOT NULL customer_id. The account becomes the owner; customer_id becomes
-- a legacy-optional column.

alter table public.properties
  add column if not exists account_id   uuid references public.accounts (id) on delete restrict,
  add column if not exists suburb       text,
  add column if not exists state        text,
  add column if not exists postcode     text,
  -- Dedupe key: lowercased street+suburb+postcode with punctuation stripped,
  -- computed by lib/accounts/identity.ts (one rule, unit-tested).
  add column if not exists address_norm text,
  add column if not exists updated_at   timestamptz not null default now();

alter table public.properties alter column customer_id drop not null;

create index if not exists properties_account_idx on public.properties (account_id);
create unique index if not exists properties_account_address_key
  on public.properties (account_id, address_norm)
  where account_id is not null and address_norm is not null;

drop trigger if exists t_properties_updated on public.properties;
create trigger t_properties_updated before update on public.properties
  for each row execute function public.set_updated_at();

drop policy if exists properties_member_select on public.properties;
create policy properties_member_select on public.properties
  for select to authenticated
  using (account_id is not null and public.is_account_member(account_id));

-- ---- 6 · estimates and invoices carry the account --------------------------
-- RESTRICT per the audit ruling: a linked estimate/invoice must never
-- silently lose its customer because an account row was deleted.

alter table public.estimates
  add column if not exists account_id uuid references public.accounts (id) on delete restrict;

create index if not exists estimates_account_idx  on public.estimates (account_id);
create index if not exists estimates_property_idx on public.estimates (property_id);

-- The estimates-column-grant pattern (20260903 revoked blanket UPDATE):
-- any later column needs its own grant before session-client staff code can
-- write it. RLS still restricts writers to staff.
grant update (account_id, property_id) on public.estimates to authenticated;

alter table public.invoices
  add column if not exists account_id uuid references public.accounts (id) on delete restrict;

create index if not exists invoices_account_idx on public.invoices (account_id);

-- ---- 7 · structural inheritance: every invoice inherits its estimate's ----
-- account. A trigger rather than edits to four RPC bodies (accept_estimate,
-- wo_sign, wo_close_without_walkthrough, request_payment/create_final): a
-- future insert site cannot forget it — the S2 lesson, applied structurally.

create or replace function public.invoice_inherit_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.account_id is null and new.estimate_id is not null then
    select e.account_id into new.account_id
      from public.estimates e where e.id = new.estimate_id;
  end if;
  return new;
end $$;

drop trigger if exists t_invoices_inherit_account on public.invoices;
create trigger t_invoices_inherit_account before insert on public.invoices
  for each row execute function public.invoice_inherit_account();

-- ---- read-backs ------------------------------------------------------------
-- A migration "running" is not the same as its statements applying. Read
-- these back; if any differs from the expectation, STOP and report.

-- Expect: 2 rows, both rowsecurity = true
select relname, relrowsecurity from pg_class
 where relname in ('accounts', 'account_users')
   and relnamespace = 'public'::regnamespace
 order by relname;

-- Expect: 5 policies — accounts_member_select, accounts_staff_all,
--         account_users_self_select, account_users_staff_all,
--         properties_member_select
select polname from pg_policy
 where polrelid in ('public.accounts'::regclass, 'public.account_users'::regclass)
    or (polrelid = 'public.properties'::regclass and polname = 'properties_member_select')
 order by polname;

-- Expect: both functions, prosecdef = true
select p.proname, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_account_member', 'invoice_inherit_account')
 order by p.proname;

-- Expect: account_id on estimates, invoices, properties (3 rows)
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and column_name = 'account_id'
   and table_name in ('estimates', 'invoices', 'properties')
 order by table_name;

-- Expect: properties.customer_id is_nullable = YES
select is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'properties'
   and column_name = 'customer_id';

-- Expect: t_invoices_inherit_account present
select tgname from pg_trigger
 where tgrelid = 'public.invoices'::regclass and tgname = 't_invoices_inherit_account';

-- Expect: all three FKs named *_account_id_fkey with confdeltype 'r' (RESTRICT)
select conrelid::regclass as on_table, confdeltype from pg_constraint
 where confrelid = 'public.accounts'::regclass and contype = 'f'
   and conrelid in ('public.estimates'::regclass, 'public.invoices'::regclass, 'public.properties'::regclass)
 order by conrelid::regclass::text;

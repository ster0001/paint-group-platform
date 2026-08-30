-- =============================================================================
-- Trade portal v2 · Session 1a — the organisation layer (brief §4.2)
--
-- Builds on 3a-1's identity chain (20261128_customer_accounts): accounts →
-- properties → estimates/invoices. Nothing here changes residential behaviour.
--
-- Shape decisions (recorded here so the migration is the document):
--   · account_users.role stays TEXT + widened CHECK, not a new enum: existing
--     rows are 'owner'/'member' (lib/portal/auth.ts writes them) and the trade
--     roles join the same column. 'owner'/'member' keep full member rights
--     (residential semantics); 'admin'/'approver'/'viewer'/'finance' are the
--     trade feature-gating roles from the brief. org_kind IS a proper enum —
--     it's a closed set that drives labels/defaults only, never permissions.
--   · property_scope uuid[] NULL means "all properties" (the common case);
--     an array narrows it. Policies below use the invertible two-arm shape
--     (3a-8 law: no per-row function calls; membership subqueries run once).
--   · property_references and external_approvals carry a denormalised
--     account_id filled by BEFORE INSERT triggers (the 3a-1 invoice-
--     inheritance pattern) so their policies never traverse an RLS'd table
--     (the policy-subquery-is-itself-subject-to-RLS trap, CLAUDE.md).
--   · Members get SELECT only on these tables. All writes go through staff
--     policies or zod'd server actions/RPCs (sessions 5–6) — same standing
--     rule as estimates/invoices (no member write, view-scoped payloads).
--   · properties_member_select is TIGHTENED to respect property_scope: a
--     viewer scoped to [A] can no longer read property B (Session 1 RLS
--     acceptance). Residential members (scope NULL) are unaffected.
-- =============================================================================

-- ---- accounts.org_kind ------------------------------------------------------

do $$ begin
  create type public.org_kind as enum
    ('real_estate', 'facilities', 'insurance', 'builder', 'body_corporate', 'other');
exception when duplicate_object then null; end $$;

alter table public.accounts
  add column if not exists org_kind public.org_kind;

comment on column public.accounts.org_kind is
  'Trade orgs only. Drives reference labels + defaults, never permissions (brief §4.2).';

-- ---- account_users: trade roles, scope, approval limit ----------------------

alter table public.account_users
  drop constraint if exists account_users_role_check;
alter table public.account_users
  add constraint account_users_role_check
  check (role in ('owner', 'member', 'admin', 'approver', 'viewer', 'finance'));

alter table public.account_users
  add column if not exists property_scope uuid[],
  add column if not exists approval_limit_cents bigint
    constraint account_users_approval_limit_check check (approval_limit_cents >= 0);

comment on column public.account_users.property_scope is
  'NULL = all properties of the account. Array narrows read scope; enforced in RLS below.';
comment on column public.account_users.approval_limit_cents is
  'NULL = no limit. Enforcement vs advisory is ⚑2 — a Settings value, read in session 5.';

-- ---- properties: member reads now respect property_scope --------------------

drop policy if exists properties_member_select on public.properties;
create policy properties_member_select on public.properties
  for select to authenticated
  using (
    account_id is not null
    and (
      account_id in (select au.account_id from public.account_users au
                     where au.profile_id = (select auth.uid())
                       and au.property_scope is null)
      or id in (select unnest(au.property_scope) from public.account_users au
                where au.profile_id = (select auth.uid())
                  and au.property_scope is not null)
    )
  );

-- ---- property_references ----------------------------------------------------
-- "Owner / Your ref / PO / Site code / Claim no. / Assessor" — label set
-- defaults per org_kind (app-side), editable. Prints on every document.

create table if not exists public.property_references (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  account_id  uuid not null references public.accounts (id) on delete restrict,
  label       text not null check (btrim(label) <> ''),
  value       text not null default '',
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint property_references_unique unique (property_id, label)
);
create index if not exists property_references_property_idx
  on public.property_references (property_id, sort);
create index if not exists property_references_account_idx
  on public.property_references (account_id);

-- ---- external_approvals -----------------------------------------------------
-- The "send to owner / assessor to approve" flow (brief §5.5). Token link,
-- no login; decision writes back here + an event. account_id/property_id are
-- denormalised from the estimate by trigger so member policies stay flat.

create table if not exists public.external_approvals (
  id                uuid primary key default gen_random_uuid(),
  estimate_id       uuid not null references public.estimates (id) on delete restrict,
  account_id        uuid not null references public.accounts (id) on delete restrict,
  property_id       uuid references public.properties (id) on delete restrict,
  sent_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  approver_name     text not null check (btrim(approver_name) <> ''),
  approver_email    text not null default '',
  approver_phone    text not null default '',
  token             text not null unique check (char_length(token) >= 24),
  sent_at           timestamptz not null default now(),
  viewed_at         timestamptz,
  decided_at        timestamptz,
  decision          text check (decision in ('approved', 'declined')),
  signer_name       text,
  expires_on        date,
  created_at        timestamptz not null default now()
);
create index if not exists external_approvals_estimate_idx
  on public.external_approvals (estimate_id);
create index if not exists external_approvals_account_idx
  on public.external_approvals (account_id);
create index if not exists external_approvals_property_idx
  on public.external_approvals (property_id);

-- ---- notification_prefs -----------------------------------------------------
-- Per account_user: digest time (NULL = off; ⚑11 default is an app Setting),
-- approvals channel, and where invoices route.

create table if not exists public.notification_prefs (
  id                uuid primary key default gen_random_uuid(),
  account_user_id   uuid not null unique references public.account_users (id) on delete cascade,
  digest_time       time,
  approvals_channel text not null default 'email'
    check (approvals_channel in ('email', 'sms', 'both')),
  invoices_email    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---- account_id inheritance triggers ---------------------------------------

create or replace function public.ref_inherit_account()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_account uuid;
begin
  select account_id into v_account from public.properties where id = new.property_id;
  if v_account is null then
    raise exception 'property % has no account — cannot attach reference', new.property_id;
  end if;
  if new.account_id is not null and new.account_id <> v_account then
    raise exception 'account/property mismatch on property_references';
  end if;
  new.account_id := v_account;
  return new;
end $$;

drop trigger if exists property_references_inherit_account on public.property_references;
create trigger property_references_inherit_account
  before insert on public.property_references
  for each row execute function public.ref_inherit_account();

create or replace function public.approval_inherit_scope()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_account uuid; v_property uuid;
begin
  select account_id, property_id into v_account, v_property
    from public.estimates where id = new.estimate_id;
  if v_account is null then
    raise exception 'estimate % is not account-linked — cannot send external approval', new.estimate_id;
  end if;
  if new.account_id is not null and new.account_id <> v_account then
    raise exception 'account/estimate mismatch on external_approvals';
  end if;
  new.account_id := v_account;
  new.property_id := coalesce(new.property_id, v_property);
  return new;
end $$;

drop trigger if exists external_approvals_inherit_scope on public.external_approvals;
create trigger external_approvals_inherit_scope
  before insert on public.external_approvals
  for each row execute function public.approval_inherit_scope();

-- ---- RLS --------------------------------------------------------------------

alter table public.property_references enable row level security;
alter table public.external_approvals enable row level security;
alter table public.notification_prefs enable row level security;

-- property_references: staff all; ALL member roles (finance included — it
-- reads references for statements) within property scope.
drop policy if exists property_references_staff_all on public.property_references;
create policy property_references_staff_all on public.property_references
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists property_references_member_select on public.property_references;
create policy property_references_member_select on public.property_references
  for select to authenticated
  using (
    account_id in (select au.account_id from public.account_users au
                   where au.profile_id = (select auth.uid())
                     and au.property_scope is null)
    or property_id in (select unnest(au.property_scope) from public.account_users au
                       where au.profile_id = (select auth.uid())
                         and au.property_scope is not null)
  );

-- external_approvals: staff all; member SELECT for non-finance roles in scope
-- (finance never reads job/approval detail — brief §4.2). The token route
-- reads via the service client, like /e and /i.
drop policy if exists external_approvals_staff_all on public.external_approvals;
create policy external_approvals_staff_all on public.external_approvals
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists external_approvals_member_select on public.external_approvals;
create policy external_approvals_member_select on public.external_approvals
  for select to authenticated
  using (
    account_id in (select au.account_id from public.account_users au
                   where au.profile_id = (select auth.uid())
                     and au.role <> 'finance' and au.property_scope is null)
    or property_id in (select unnest(au.property_scope) from public.account_users au
                       where au.profile_id = (select auth.uid())
                         and au.role <> 'finance' and au.property_scope is not null)
  );

-- notification_prefs: staff all; each user reads/updates their OWN row.
-- Admins manage teammates through the session-6 server action (service client
-- after a role check), not through RLS.
drop policy if exists notification_prefs_staff_all on public.notification_prefs;
create policy notification_prefs_staff_all on public.notification_prefs
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists notification_prefs_self_select on public.notification_prefs;
create policy notification_prefs_self_select on public.notification_prefs
  for select to authenticated
  using (account_user_id in (select id from public.account_users
                             where profile_id = (select auth.uid())));

drop policy if exists notification_prefs_self_update on public.notification_prefs;
create policy notification_prefs_self_update on public.notification_prefs
  for update to authenticated
  using (account_user_id in (select id from public.account_users
                             where profile_id = (select auth.uid())))
  with check (account_user_id in (select id from public.account_users
                                  where profile_id = (select auth.uid())));

-- ---- read-backs (CLAUDE.md law: list what this migration just made) --------

-- Expect: org_kind enum with 6 values
select string_agg(enumlabel, ',' order by enumsortorder) as org_kinds
from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'org_kind';

-- Expect: 3 new columns present
select column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'accounts' and column_name = 'org_kind')
    or (table_name = 'account_users' and column_name in ('property_scope', 'approval_limit_cents')))
order by column_name;

-- Expect: 8 policies across the three new tables + tightened properties select
select schemaname, tablename, policyname from pg_policies
where tablename in ('property_references', 'external_approvals', 'notification_prefs')
   or (tablename = 'properties' and policyname = 'properties_member_select')
order by tablename, policyname;

-- Expect: both inheritance triggers present
select tgname from pg_trigger
where tgname in ('property_references_inherit_account', 'external_approvals_inherit_scope');

-- Expect: rls enabled = true on all three
select relname, relrowsecurity from pg_class
where relname in ('property_references', 'external_approvals', 'notification_prefs');

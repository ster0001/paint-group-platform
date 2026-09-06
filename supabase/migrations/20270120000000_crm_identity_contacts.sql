-- =============================================================================
-- CRM v2 · P1a — identity by email OR phone, contacts under accounts, merge
--
-- docs/briefs/crm-v2-deep-dive.md §3 F1 and §4.1, decision 8.2 (Tom, 7 Sep
-- 2026: "happy to proceed with all of your recommendations").
--
-- Before this file an account WAS an email address: `accounts.email` NOT NULL
-- and the only identity key, so a phone enquiry with no email could not become
-- a customer, and there was one phone per account with no normalised form to
-- match an SMS reply against. After it:
--
--   · `accounts.email` is optional. The reachability rule is the constraint:
--     an account has an email OR a normalised phone, never neither.
--   · `accounts.phone_e164` is maintained by trigger from `phone` through ONE
--     SQL normaliser (`phone_e164_au`) that the inbound SMS webhook can share,
--     so matching a reply is an index lookup, not a 10,000-row scan.
--   · `account_contacts` holds every person on an account (the owner, the
--     partner, the agent, the site contact). The account's own name/email/
--     phone stay the primary contact and are mirrored into the table by
--     trigger, so "everyone on this account" is one query and the campaign
--     address is still the account's.
--   · `crm_find_account(email, phone)` is the one identity lookup: account
--     email → contact email → account phone → contact phone.
--   · `crm_merge_accounts(keep, drop)` re-points every foreign key to the
--     kept account, fills its blanks from the dropped one, logs an
--     `account_merged` event and deletes the duplicate. The append-only
--     guard on crm_events is relaxed ONLY for that re-pointing, ONLY inside
--     this function, via a transaction-local setting.
--   · `crm_duplicate_candidates()` lists likely duplicates by phone, email
--     and address for the office to merge.
--   · `accounts.owner_id` (decision 8.5) — the responsible staff member.
--
-- A3 tenancy: account_contacts carries tenant_id. RLS staff-only; the
-- service role bypasses RLS as everywhere else.
--
-- Idempotent. Read-back at the end.
-- =============================================================================

-- ---- 1 · the phone normaliser ----------------------------------------------
-- Australian numbers to E.164. Accepts the shapes real data has: 04xx xxx xxx,
-- +61 4xx, 61 4xx, a dropped leading zero (a live account held "422453136"),
-- landlines 0[2378]. Anything else already in +E.164 passes through; anything
-- unrecognisable is NULL, never a guess.
create or replace function public.phone_e164_au(p text)
returns text language sql immutable strict as $$
  with d as (select regexp_replace(p, '[^0-9+]', '', 'g') as s)
  select case
    when s ~ '^\+61[2-9][0-9]{8}$'    then s
    when s ~ '^61[2-9][0-9]{8}$'      then '+' || s
    when s ~ '^0[2-9][0-9]{8}$'       then '+61' || substr(s, 2)
    when s ~ '^[2-9][0-9]{8}$'        then '+61' || s
    when s ~ '^\+[1-9][0-9]{7,14}$'   then s
    else null end
  from d $$;

-- ---- 2 · accounts: email optional, phone_e164 maintained, owner -------------
alter table public.accounts alter column email drop not null;
alter table public.accounts drop constraint if exists accounts_email_sane;
alter table public.accounts add constraint accounts_email_sane
  check (email is null or position('@' in email) > 1);

alter table public.accounts add column if not exists phone_e164 text;
alter table public.accounts add column if not exists owner_id uuid references public.profiles (id) on delete set null;
comment on column public.accounts.phone_e164 is
  'Maintained by trigger from phone via phone_e164_au(). The matching key for inbound SMS and the duplicate finder. Never written by the app.';
comment on column public.accounts.owner_id is
  'The staff member responsible (CRM v2 decision 8.5). Set to whoever created the record; changeable; filterable. Everyone still sees everyone.';

create or replace function public.accounts_identity_sync()
returns trigger language plpgsql as $$
begin
  if new.email is not null then
    new.email := nullif(lower(trim(new.email)), '');
  end if;
  new.phone := nullif(trim(coalesce(new.phone, '')), '');
  new.phone_e164 := public.phone_e164_au(new.phone);
  return new;
end $$;

drop trigger if exists t_accounts_identity_sync on public.accounts;
create trigger t_accounts_identity_sync
  before insert or update of email, phone on public.accounts
  for each row execute function public.accounts_identity_sync();

update public.accounts set phone_e164 = public.phone_e164_au(phone)
 where phone is not null and phone_e164 is distinct from public.phone_e164_au(phone);

create index if not exists accounts_phone_e164_idx on public.accounts (phone_e164) where phone_e164 is not null;
create index if not exists accounts_owner_idx on public.accounts (owner_id) where owner_id is not null;

-- Reachability: an account is an email or a phone, never neither. Existing
-- rows all carry an email, so this validates immediately.
alter table public.accounts drop constraint if exists accounts_reachable;
alter table public.accounts add constraint accounts_reachable
  check (email is not null or phone_e164 is not null);

-- ---- 3 · account_contacts ---------------------------------------------------
create table if not exists public.account_contacts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) default public.current_tenant(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  name              text,
  role              text not null default 'other'
    constraint account_contacts_role_check
    check (role in ('primary', 'partner', 'tenant', 'agent', 'site', 'accounts', 'other')),
  email             text
    constraint account_contacts_email_sane check (email is null or position('@' in email) > 1),
  phone             text,
  phone_e164        text,
  preferred_channel text
    constraint account_contacts_channel_check
    check (preferred_channel is null or preferred_channel in ('email', 'sms', 'phone')),
  is_primary        boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint account_contacts_someone check (name is not null or email is not null or phone is not null)
);
comment on table public.account_contacts is
  'Every person on an account. The primary row mirrors accounts.name/email/phone by trigger (the account stays the canonical address); the rest are the partner, the agent, the site contact. Matched by lower(email) and phone_e164.';

create unique index if not exists account_contacts_primary_key on public.account_contacts (account_id) where is_primary;
create index if not exists account_contacts_account_idx on public.account_contacts (account_id);
create index if not exists account_contacts_email_idx on public.account_contacts (lower(email)) where email is not null;
create index if not exists account_contacts_phone_idx on public.account_contacts (phone_e164) where phone_e164 is not null;

create or replace function public.account_contacts_identity_sync()
returns trigger language plpgsql as $$
begin
  if new.email is not null then new.email := nullif(lower(trim(new.email)), ''); end if;
  new.phone := nullif(trim(coalesce(new.phone, '')), '');
  new.phone_e164 := public.phone_e164_au(new.phone);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists t_account_contacts_identity_sync on public.account_contacts;
create trigger t_account_contacts_identity_sync
  before insert or update on public.account_contacts
  for each row execute function public.account_contacts_identity_sync();

-- The account's own details ARE the primary contact. One-way mirror
-- (account → contact) so there is no loop and one place to edit the primary.
create or replace function public.accounts_mirror_primary_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_contacts (account_id, name, role, email, phone, is_primary)
  values (new.id, new.name, 'primary', new.email, new.phone, true)
  on conflict (account_id) where is_primary do update
    set name = excluded.name, email = excluded.email, phone = excluded.phone;
  return new;
end $$;

drop trigger if exists t_accounts_mirror_primary on public.accounts;
create trigger t_accounts_mirror_primary
  after insert or update of name, email, phone on public.accounts
  for each row execute function public.accounts_mirror_primary_contact();

-- Backfill: one primary contact per existing account.
insert into public.account_contacts (account_id, name, role, email, phone, is_primary)
select a.id, a.name, 'primary', a.email, a.phone, true
  from public.accounts a
 where not exists (select 1 from public.account_contacts c where c.account_id = a.id and c.is_primary);

alter table public.account_contacts enable row level security;

drop policy if exists account_contacts_staff on public.account_contacts;
create policy account_contacts_staff on public.account_contacts
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = public.current_tenant())
  with check ((select public.is_staff()) and tenant_id = public.current_tenant());

-- ---- 4 · the one identity lookup -------------------------------------------
create or replace function public.crm_find_account(p_email text default null, p_phone text default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
        v_phone text := public.phone_e164_au(p_phone);
        v_id uuid;
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_find_account: not permitted' using errcode = '42501';
  end if;
  if v_email is null and v_phone is null then return null; end if;
  select id into v_id from (
    select a.id, 1 as rank from public.accounts a where v_email is not null and lower(a.email) = v_email
    union all
    select c.account_id, 2 from public.account_contacts c where v_email is not null and lower(c.email) = v_email
    union all
    select a.id, 3 from public.accounts a where v_phone is not null and a.phone_e164 = v_phone
    union all
    select c.account_id, 4 from public.account_contacts c where v_phone is not null and c.phone_e164 = v_phone
  ) x order by rank limit 1;
  return v_id;
end $$;
revoke all on function public.crm_find_account(text, text) from public, anon;
grant execute on function public.crm_find_account(text, text) to authenticated;

-- ---- 5 · merge --------------------------------------------------------------
-- The append-only guard stays; it makes ONE exception, for the re-pointing a
-- merge does, and only while this transaction says so.
create or replace function public.crm_events_no_update()
returns trigger language plpgsql as $$
begin
  if current_setting('crm.merge', true) = 'on'
     and new.account_id is distinct from old.account_id
     and new.type = old.type and new.payload = old.payload and new.occurred_at = old.occurred_at then
    return new;
  end if;
  raise exception 'crm_events is append-only: % on % is not allowed', tg_op, tg_table_name
    using hint = 'Record a correcting event instead of editing the original.';
end $$;

create or replace function public.crm_merge_accounts(p_keep uuid, p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_keep public.accounts%rowtype; v_drop public.accounts%rowtype;
        r record; v_n bigint; v_moved jsonb := '{}'::jsonb;
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_merge_accounts: not permitted' using errcode = '42501';
  end if;
  if p_keep = p_drop then raise exception 'crm_merge_accounts: keep and drop are the same account'; end if;
  select * into v_keep from public.accounts where id = p_keep for update;
  if not found then raise exception 'crm_merge_accounts: keep account not found'; end if;
  select * into v_drop from public.accounts where id = p_drop for update;
  if not found then raise exception 'crm_merge_accounts: drop account not found'; end if;

  perform set_config('crm.merge', 'on', true);

  -- Properties: the same address on both sides collapses onto the kept one.
  update public.estimates e set property_id = k.id
    from public.properties d join public.properties k
      on k.account_id = p_keep and k.address_norm = d.address_norm
   where d.account_id = p_drop and e.property_id = d.id;
  update public.crm_events ev set property_id = k.id
    from public.properties d join public.properties k
      on k.account_id = p_keep and k.address_norm = d.address_norm
   where d.account_id = p_drop and ev.property_id = d.id;
  delete from public.properties d using public.properties k
   where d.account_id = p_drop and k.account_id = p_keep and k.address_norm = d.address_norm;

  -- Rows that would collide on a unique key: the kept account's row wins.
  delete from public.account_users u where u.account_id = p_drop
     and exists (select 1 from public.account_users k where k.account_id = p_keep and k.profile_id = u.profile_id);
  delete from public.campaign_enrolments d where d.account_id = p_drop
     and exists (select 1 from public.campaign_enrolments k where k.account_id = p_keep and k.campaign_id = d.campaign_id);
  update public.account_contacts set is_primary = false, role = case when role = 'primary' then 'other' else role end
   where account_id = p_drop and is_primary;
  -- The dropped account's cached card (20270122, when it exists) is not moved:
  -- the kept account has its own, and it is recomputed after the merge.
  if to_regclass('public.crm_account_facts') is not null then
    execute 'delete from public.crm_account_facts where account_id = $1' using p_drop;
  end if;

  -- Everything else that points at the dropped account moves, generically,
  -- so a table added later is carried without anyone remembering this file.
  for r in
    select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
       and ccu.table_name = 'accounts' and ccu.column_name = 'id'
       and tc.table_name <> 'crm_account_facts'
  loop
    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using p_keep, p_drop;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object(r.table_name, v_n); end if;
  end loop;

  -- The kept record fills its blanks from the dropped one; nothing on the
  -- kept side is overwritten.
  update public.accounts k
     set name = coalesce(k.name, v_drop.name),
         email = coalesce(k.email, v_drop.email),
         phone = coalesce(k.phone, v_drop.phone),
         temperature = coalesce(k.temperature, v_drop.temperature),
         temperature_set_at = coalesce(k.temperature_set_at, v_drop.temperature_set_at),
         snoozed_until = coalesce(k.snoozed_until, v_drop.snoozed_until),
         followup_due_at = coalesce(k.followup_due_at, v_drop.followup_due_at),
         followup_note = coalesce(k.followup_note, v_drop.followup_note),
         owner_id = coalesce(k.owner_id, v_drop.owner_id),
         marketing_unsubscribed_at = coalesce(k.marketing_unsubscribed_at, v_drop.marketing_unsubscribed_at),
         marketing_undeliverable_at = coalesce(k.marketing_undeliverable_at, v_drop.marketing_undeliverable_at)
   where k.id = p_keep;

  -- The dropped account's email becomes reachable on the kept one through its
  -- (moved) primary contact when the kept account already had a different one.
  insert into public.crm_events (account_id, type, source, actor_profile_id, payload)
  values (p_keep, 'account_merged', 'staff', auth.uid(),
          jsonb_build_object('droppedAccountId', p_drop, 'droppedEmail', v_drop.email,
                             'droppedName', v_drop.name, 'droppedPhone', v_drop.phone, 'moved', v_moved));

  delete from public.accounts where id = p_drop;
  perform set_config('crm.merge', 'off', true);
  return jsonb_build_object('ok', true, 'kept', p_keep, 'dropped', p_drop, 'moved', v_moved);
end $$;
revoke all on function public.crm_merge_accounts(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_accounts(uuid, uuid) to authenticated;

-- ---- 6 · duplicate finder ---------------------------------------------------
-- `p_account` narrows to pairs involving one account (the record page's
-- "possible duplicate" banner); without it, the office's whole list.
drop function if exists public.crm_duplicate_candidates(integer);
create or replace function public.crm_duplicate_candidates(p_limit integer default 200, p_account uuid default null)
returns table (account_a uuid, account_b uuid, reason text, key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_duplicate_candidates: not permitted' using errcode = '42501';
  end if;
  return query
  with ident as (
    select id as account_id, phone_e164 as k, 'phone' as kind from public.accounts where phone_e164 is not null
    union
    select account_id, phone_e164, 'phone' from public.account_contacts where phone_e164 is not null
    union
    select id, lower(email), 'email' from public.accounts where email is not null
    union
    select account_id, lower(email), 'email' from public.account_contacts where email is not null
    union
    select account_id, address_norm, 'address' from public.properties where account_id is not null and address_norm is not null
  )
  select least(x.account_id, y.account_id), greatest(x.account_id, y.account_id), x.kind, x.k
    from ident x join ident y on x.k = y.k and x.kind = y.kind and x.account_id < y.account_id
   where p_account is null or x.account_id = p_account or y.account_id = p_account
   group by 1, 2, 3, 4
   order by 3, 4
   limit p_limit;
end $$;
revoke all on function public.crm_duplicate_candidates(integer, uuid) from public, anon;
grant execute on function public.crm_duplicate_candidates(integer, uuid) to authenticated;

-- ---- Read-back --------------------------------------------------------------
do $$
declare v_null_email_ok boolean; v_contacts bigint; v_accounts bigint; v_e164 bigint;
begin
  select is_nullable = 'YES' into v_null_email_ok from information_schema.columns
   where table_schema = 'public' and table_name = 'accounts' and column_name = 'email';
  select count(*) into v_accounts from public.accounts;
  select count(*) into v_contacts from public.account_contacts where is_primary;
  select count(*) into v_e164 from public.accounts where phone is not null and phone_e164 is null;
  if not v_null_email_ok then raise exception 'accounts.email is still NOT NULL'; end if;
  if v_contacts <> v_accounts then raise exception 'primary contacts % <> accounts %', v_contacts, v_accounts; end if;
  raise notice 'crm identity: % accounts, % primary contacts, % phones that could not be normalised', v_accounts, v_contacts, v_e164;
end $$;

select
  (select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'email') as email_optional,
  (select count(*) from public.accounts) as accounts,
  (select count(*) from public.account_contacts where is_primary) as primary_contacts,
  (select count(*) from public.accounts where phone_e164 is not null) as phones_normalised,
  (select public.phone_e164_au('0412 345 678')) = '+61412345678' as normaliser_ok,
  (select count(*) from pg_proc where proname in ('crm_find_account', 'crm_merge_accounts', 'crm_duplicate_candidates')) = 3 as functions_ok,
  (select count(*) from pg_policies where tablename = 'account_contacts') as contact_policies;

-- =============================================================================
-- Contacts ← CRM accounts (Tom, 4 Oct 2026: "add all contacts from our CRM
-- system into our contacts list")
--
-- Two address books had grown side by side: `contacts` (the estimate builder's
-- Contact card and the Contacts page, staff-typed) and the CRM's `accounts`
-- (every customer the wizard, the office quick-add, the Airtable import or a
-- staff estimate save ever produced). A customer in the CRM was invisible to
-- the Contact card unless somebody re-typed them.
--
-- After this file:
--   · `contacts.account_id` says which CRM account a contact IS (one contact
--     per account; SET NULL on merge/delete so an office-typed contact is
--     never lost when a duplicate account is dropped).
--   · `contacts_sync_from_account(account)` is the ONE rule that turns an
--     account into a Contacts row: it finds the contact by account, then by
--     email, then by mobile; fills only the blanks of one it finds (never
--     overwrites what the office typed); inserts one otherwise, with the
--     account's latest property as the address.
--   · An AFTER trigger on `accounts` runs that rule on every insert and on
--     every change of name/email/phone, so the list stays complete from now
--     on — the wizard, quick add and the builder's account link all land in
--     Contacts without a second code path.
--   · The backfill below runs the same rule once over every existing account.
--
-- The function is SECURITY DEFINER (contacts RLS is staff-only; the wizard
-- inserts accounts as the service role, the office as staff) and is granted
-- to nobody — it is reached only through the trigger and this file.
-- Idempotent; read-back at the end.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1 · the link column + lookup indexes -----------------------------------
alter table public.contacts
  add column if not exists account_id uuid references public.accounts (id) on delete set null;
comment on column public.contacts.account_id is
  'The CRM account this contact is. Set by contacts_sync_from_account (trigger on accounts). One contact per account.';

create unique index if not exists contacts_account_key on public.contacts (account_id) where account_id is not null;
create index if not exists contacts_email_lower_idx on public.contacts (lower(email)) where email is not null;
create index if not exists contacts_phone_e164_idx on public.contacts (public.phone_e164_au(phone)) where phone is not null;

-- ---- 2 · the one rule --------------------------------------------------------
create or replace function public.contacts_sync_from_account(p_account public.accounts)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email   text := nullif(lower(trim(coalesce(p_account.email, ''))), '');
  v_phone   text := nullif(trim(coalesce(p_account.phone, '')), '');
  v_e164    text := coalesce(p_account.phone_e164, public.phone_e164_au(p_account.phone));
  v_name    text := nullif(regexp_replace(trim(coalesce(p_account.name, '')), '\s+', ' ', 'g'), '');
  v_first   text;
  v_last    text;
  v_company text;
  v_prop    public.properties%rowtype;
  v_id      uuid;
begin
  if v_email is null and v_e164 is null then return null; end if;

  -- A trade account's name is the business; a residential one is a person.
  if p_account.account_type = 'trade' then
    v_company := v_name;
    v_first := v_name;
  elsif v_name is not null then
    v_first := split_part(v_name, ' ', 1);
    v_last := nullif(trim(substr(v_name, length(v_first) + 1)), '');
  end if;

  -- The account's most recent property is the address the office expects to see.
  select * into v_prop from public.properties
   where account_id = p_account.id order by created_at desc limit 1;

  select id into v_id from public.contacts where account_id = p_account.id;
  if v_id is null and v_email is not null then
    select id into v_id from public.contacts
     where lower(email) = v_email and account_id is null order by created_at asc limit 1;
  end if;
  if v_id is null and v_e164 is not null then
    select id into v_id from public.contacts
     where phone is not null and public.phone_e164_au(phone) = v_e164 and account_id is null
     order by created_at asc limit 1;
  end if;

  if v_id is not null then
    -- Fill the blanks only; what the office typed stands.
    update public.contacts set
      account_id = coalesce(account_id, p_account.id),
      first_name = case when (first_name is null or first_name in ('', 'Unnamed')) and v_first is not null then v_first else first_name end,
      last_name  = coalesce(nullif(last_name, ''), v_last),
      company    = coalesce(nullif(company, ''), v_company),
      email      = coalesce(nullif(email, ''), v_email),
      phone      = coalesce(nullif(phone, ''), v_phone),
      address    = coalesce(nullif(address, ''), v_prop.address),
      city       = coalesce(nullif(city, ''), v_prop.suburb),
      state      = coalesce(nullif(state, ''), v_prop.state),
      postal     = coalesce(nullif(postal, ''), v_prop.postcode)
    where id = v_id;
    return v_id;
  end if;

  insert into public.contacts (first_name, last_name, company, email, phone, address, city, state, postal, account_id)
  values (coalesce(v_first, 'Unnamed'), v_last, v_company, v_email, v_phone,
          v_prop.address, v_prop.suburb, v_prop.state, v_prop.postcode, p_account.id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.contacts_sync_from_account(public.accounts) from public, anon, authenticated;

-- ---- 3 · the trigger ---------------------------------------------------------
create or replace function public.accounts_sync_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.contacts_sync_from_account(new);
  return new;
end $$;
revoke all on function public.accounts_sync_contact() from public, anon, authenticated;

drop trigger if exists t_accounts_sync_contact on public.accounts;
create trigger t_accounts_sync_contact
  after insert or update of name, email, phone on public.accounts
  for each row execute function public.accounts_sync_contact();

-- ---- 4 · backfill: every account that has no contact yet --------------------
select count(public.contacts_sync_from_account(a)) as backfilled
  from public.accounts a
 where not exists (select 1 from public.contacts c where c.account_id = a.id);

-- ---- 5 · read-back: compare to _expect_ before calling this live ------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'contacts' and column_name = 'account_id') as account_col, 1 as _expect_account_col,
  (select count(*) from pg_trigger where tgname = 't_accounts_sync_contact' and not tgisinternal) as trigger_on, 1 as _expect_trigger_on,
  (select count(*) from public.accounts a
     where not exists (select 1 from public.contacts c where c.account_id = a.id)) as accounts_without_contact, 0 as _expect_accounts_without_contact,
  (select count(*) from information_schema.routine_privileges
     where specific_schema = 'public' and grantee in ('authenticated', 'anon', 'PUBLIC')
       and routine_name in ('contacts_sync_from_account', 'accounts_sync_contact')) as fn_grants, 0 as _expect_fn_grants,
  (select relrowsecurity from pg_class where relname = 'contacts') as rls_on, true as _expect_rls_on;

insert into public._prod_migrations(name) values ('20270210000000_contacts_from_crm_accounts.sql') on conflict (name) do nothing;

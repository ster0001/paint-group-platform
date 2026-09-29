-- =============================================================================
-- Contacts: a landline and a second person (Tom, 29 Sep 2026: "add landline
-- phone option in contacts page; add secondary contact which includes name,
-- email and phone and allows to send to multiple contacts").
--
-- Four nullable columns on the staff address book. The estimate carries the
-- same fields inside builder_state.contact (the Contact shape in
-- app/quote/company.ts) — this is the saved-contact side of that shape.
-- `contacts` already has RLS (staff only, 20260814010000); columns inherit it.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

alter table public.contacts
  add column if not exists landline        text,
  add column if not exists secondary_name  text,
  add column if not exists secondary_email text,
  add column if not exists secondary_phone text;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts'
      and column_name in ('landline', 'secondary_name', 'secondary_email', 'secondary_phone')) as cols, 4 as _expect_cols,
  (select relrowsecurity from pg_class where relname = 'contacts') as rls_on, true as _expect_rls_on;

insert into public._prod_migrations(name) values ('20270205000000_contacts_landline_secondary.sql') on conflict (name) do nothing;

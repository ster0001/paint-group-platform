-- Tom's 1 Sep batch #2: contractors get a MOBILE on file.
--
-- Three new notifications need it (job offers, released variations, QA
-- fails) and there was no contractor phone anywhere — profiles.contact was
-- never used, contractors has no phone column. Same shape as the weekend
-- flags (20261221): a plain column, self-served in portal Profile or typed
-- by staff, opened by an explicit column grant (the 20260824010000
-- allow-list rule: a column added later is NOT writable until granted).

alter table public.contractors
  add column if not exists phone text;

grant update (phone) on public.contractors to authenticated;

comment on column public.contractors.phone is
  'The painter''s mobile for job notifications (offers, variations, QA) — self-served in portal Profile. Normalised to +61 at send time, never stored normalised.';

-- ---- readback -------------------------------------------------------------
-- Expect: col_present = 1, col_granted = 1.
select
  count(*) filter (where column_name = 'phone') as col_present,
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'contractors'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name = 'phone') as col_granted
  from information_schema.columns
 where table_schema = 'public' and table_name = 'contractors';

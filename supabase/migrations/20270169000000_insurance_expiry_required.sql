-- =============================================================================
-- Insurance certificates carry their expiry (Tom, 18 Sep 2026): "don't let
-- contractors save their account without attaching an expiry date of their
-- insurances." Found alongside: the portal uploaded the moment a file was
-- picked, so a date typed AFTER choosing the file never reached the row and
-- the certificate showed as NO EXPIRY.
--
-- The database is the last line of defence: a public liability or WorkCover
-- row with no expiry is refused, on insert and on update. Other kinds
-- (licence, other, white card, working at heights) keep an optional date —
-- some of those genuinely have none. Existing null rows are left as they are;
-- the portal now lets the painter set the date on them in place.
-- =============================================================================

create or replace function public.contractor_doc_expiry_sane()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind in ('insurance', 'workcover') and new.expires_on is null then
    raise exception 'an insurance certificate needs its expiry date';
  end if;
  if new.expires_on is not null then
    if new.expires_on > current_date + interval '10 years' then
      raise exception 'expiry date is too far in the future';
    end if;
    if new.expires_on < current_date - interval '20 years' then
      raise exception 'expiry date is implausibly old';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists contractor_doc_expiry_sane_t on public.contractor_documents;
create trigger contractor_doc_expiry_sane_t
  before insert or update of expires_on, kind on public.contractor_documents
  for each row execute function public.contractor_doc_expiry_sane();

-- Read-back: the guard is in the live body, and how many insurance rows
-- already sit with no expiry (for the office to chase — not changed here).
select
  (select p.prosrc like '%needs its expiry date%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'contractor_doc_expiry_sane') as guard_ok,
  (select count(*) from public.contractor_documents where kind in ('insurance', 'workcover') and expires_on is null) as insurance_rows_without_expiry;

insert into public._prod_migrations(name) values ('20270169000000_insurance_expiry_required.sql') on conflict (name) do nothing;

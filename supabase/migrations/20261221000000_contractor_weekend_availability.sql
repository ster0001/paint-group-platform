-- Tom's 1 Sep batch: weekend availability on the contractor.
--
-- Two plain booleans (the requires_qa / gst_registered house style): can this
-- contractor work Saturdays / Sundays? Ticked by the contractor themselves in
-- portal Profile, or by the office on the Contractors page. Default FALSE —
-- weekends are opt-in, existing contractors read as weekdays-only until they
-- (or the office) say otherwise.
--
-- No RPC needed: the contractor updates their OWN row (contractors_self_update
-- RLS), staff update any row (contractors_staff_all), and the column grant
-- below opens exactly these two columns to both. Remember 20260824010000:
-- the table-wide UPDATE grant was replaced by a column allow-list, so a column
-- added later is NOT writable until granted — omit the grant and the save
-- fails with a bare permission error.

alter table public.contractors
  add column if not exists works_saturday boolean not null default false,
  add column if not exists works_sunday   boolean not null default false;

grant update (works_saturday, works_sunday) on public.contractors to authenticated;

comment on column public.contractors.works_saturday is
  'Available to work Saturdays — self-served in the portal profile or set by staff. Scheduling shows weekend clashes as warnings, never hard blocks.';
comment on column public.contractors.works_sunday is
  'Available to work Sundays — see works_saturday.';

-- ---- readback -------------------------------------------------------------
-- Expect: both columns present with default false, and both in the
-- authenticated role's UPDATE column grant.
select
  count(*) filter (where column_name in ('works_saturday', 'works_sunday')) as cols_present,
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'contractors'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name in ('works_saturday', 'works_sunday')) as cols_granted
  from information_schema.columns
 where table_schema = 'public' and table_name = 'contractors';

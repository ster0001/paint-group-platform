-- WorkCover certificates on the contractor's Insurance & licences (Tom, 17 Sep 2026)
--
-- "Ask for WorkCover certificates as well as the public liability policy.
--  The gate passes on public liability alone, but WorkCover is required if
--  they have any other workers working with them."
--
-- One new document kind. The offerable rule (contractor_recompute_offerable,
-- 20260831) is deliberately UNCHANGED: it still keys on a verified, unexpired
-- 'insurance' (public liability) row and nothing else. WorkCover is asked for,
-- listed, checked and warned about — the portal says it is required when the
-- crew size is above one — but it never blocks an offer.
--
-- ADD VALUE is safe inside the editor's transaction because nothing in this
-- file uses the new value.
alter type public.contractor_doc_kind add value if not exists 'workcover';

comment on type public.contractor_doc_kind is
  'insurance = public liability (the only kind the offerable gate reads); workcover = WorkCover certificate, required in the portal''s words when crew_size > 1 but never a gate; licence; other.';

-- Read-back: the enum now carries the value.
select
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
           where t.typname = 'contractor_doc_kind' and e.enumlabel = 'workcover') as workcover_ok,
  (select prosrc like '%d.kind = ''insurance''%' from pg_proc where proname = 'contractor_recompute_offerable') as gate_still_insurance_only;

insert into public._prod_migrations(name) values ('20270160000000_contractor_doc_kind_workcover.sql') on conflict (name) do nothing;

-- =============================================================================
-- Paste ONE: the enum label for a job closed without a walkthrough (Tom, 23
-- Aug). `alter type … add value` cannot be used in the same transaction that
-- adds it, so it travels alone; 20261110 uses it.
-- =============================================================================
alter type public.wo_signoff_kind add value if not exists 'no_walkthrough';

select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'wo_signoff_kind' order by enumsortorder;

-- Same trap, third column: 20260903 granted estimates UPDATE column-by-column
-- as of its run date, so requires_site_check (added by 20260910) has no grant
-- and the wizard's staff-path safety-flag write is silently refused (found by
-- the wizard audit; 20260914 fixed the identical failure for storey_heights).
--
-- RULE for future migrations: every `alter table estimates add column` needs
-- its own `grant update (col)` alongside it.

grant update (requires_site_check) on public.estimates to authenticated;

-- ---- Verification ------------------------------------------------------------
-- Run an internal wizard submit for an exterior/both job, then:
--   select requires_site_check from estimates order by created_at desc limit 1;
-- Expect true.

-- =============================================================================
-- WO loop — the loop's tables need an explicit SELECT grant
--
-- Found by building the console and looking at it: with a zero_tick_flag row
-- sitting in wo_events and is_staff() returning true, a staff session read back
-- ZERO rows. The RLS policy was never the problem — a policy only filters rows
-- the role is already allowed to select, and the table-level grant was missing.
-- The console therefore rendered "nothing needs you" over a database that had
-- something to say, which is the worst way for this to fail: silently, and
-- reassuringly.
--
-- Relying on the project's default privileges was the mistake. Every table this
-- module added now states its read access outright. RLS still decides WHICH
-- rows each role sees; this only says the role may look at the table at all.
--
-- Writes stay revoked: every write in this module goes through an RPC.
-- =============================================================================

grant select on public.wo_events            to authenticated;
grant select on public.wo_stage_transitions to authenticated;
grant select on public.wo_checklist_items   to authenticated;
grant select on public.wo_surfaces          to authenticated;
grant select on public.wo_photos            to authenticated;
grant select on public.wo_variations        to authenticated;
grant select on public.wo_updates           to authenticated;
grant select on public.wo_qa_checks         to authenticated;
grant select on public.wo_signoff           to authenticated;
grant select on public.warranties           to authenticated;

-- Belt and braces: the same revokes as before, restated so this file can be run
-- on its own and still leave the module write-locked.
do $$
declare t text;
begin
  foreach t in array array['wo_events','wo_stage_transitions','wo_checklist_items','wo_surfaces',
                           'wo_photos','wo_variations','wo_updates','wo_qa_checks','wo_signoff','warranties']
  loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---- Verification -----------------------------------------------------------
-- As staff, with at least one event row present:
--   select count(*) from wo_events;          -> non-zero (it was 0 before this)
-- As a contractor, on a job that is not theirs:
--   select count(*) from wo_surfaces where work_order_id = '<other job>';  -> 0
--   insert into wo_events (...) values (...);   -> permission denied

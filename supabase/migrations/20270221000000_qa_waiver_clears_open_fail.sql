-- =============================================================================
-- "Quality check not required" means nothing is open (Tom, 7 Oct 2026).
--
-- 25 Bunney Road Exterior (WO-WNWJXGTV) sat at 05 Quality check from 17 Sep:
-- its one check was logged FAIL before re-checks existed (20270196, 24 Sep),
-- so no re-check row was ever made, and wo_qa_open_count has counted that
-- fail as "open" ever since. The office pressed "Quality check not required"
-- on 6 Oct (qa_waived = true) — but the waiver only deletes UNLOGGED checks,
-- so the logged fail still held the gate and the route answered ok:0.
--
--   wo_qa_open_count   20270196 body + one clause: a job the office has
--                      waived has NOTHING open. A logged fail stays on the
--                      record (it is history), it just no longer holds the job.
--
-- With this live, every job already parked that way routes the next time
-- anyone opens it or the evening sweep runs (wo_qa_route_passed). Clearing
-- the waiver puts the fail back in force. Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_qa_open_count(p_work_order_id uuid)
returns integer language sql stable set search_path = public as $$
  select case
           when exists (select 1 from public.work_orders w where w.id = p_work_order_id and coalesce(w.qa_waived, false)) then 0
           else (
             select count(*)::integer
               from public.wo_qa_checks c
              where c.work_order_id = p_work_order_id
                and (c.result is null
                     or (c.result = 'fail'
                         and not exists (select 1 from public.wo_qa_checks r where r.retry_of = c.id))))
         end;
$$;
grant execute on function public.wo_qa_open_count(uuid) to authenticated, service_role;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------------
select
  (select prosrc like '%qa_waived%' from pg_proc where proname = 'wo_qa_open_count') as waiver_clears_open, true as _expect_waiver_clears_open,
  (select has_function_privilege('service_role', 'public.wo_qa_open_count(uuid)', 'execute')) as system_granted, true as _expect_system_granted,
  (select count(*) from public.work_orders w where w.stage = 'qa' and coalesce(w.qa_waived, false)) as waived_jobs_parked_at_qa_now;

insert into public._prod_migrations(name) values ('20270221000000_qa_waiver_clears_open_fail.sql') on conflict (name) do nothing;

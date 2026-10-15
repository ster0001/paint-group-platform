-- =============================================================================
-- A cost rate set later posts the days already waiting (Tom, 15 Oct 2026,
-- 12 First Avenue).
--
-- Why: every standard day logs itself (20270219) but a day no cost rate covers
-- stays submitted, and nothing came back for it when the rate was set. Adi
-- Rapoport had no rate; 17 auto days on 3 jobs sat at submitted with no labour
-- line, and each job read short. From here, set_employee_cost_rate ends by
-- running timesheet_auto_approve over every submitted day of that painter on
-- or after the effective date, so the rate landing is what posts the days.
-- The screens now also show every booked day at hours times rate ahead of the
-- day (lib/invoicing/bookedLabour.ts); this makes the recorded rows catch up.
--
-- Converges on a re-run: or-replace, and the backfill approves only what is
-- still submitted (a day already approved answers ok and posts nothing).
-- No DO block, no quotes in comments (lib/sql/migrationPaste.test.ts).
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.set_employee_cost_rate(p_contractor_id uuid, p_cents_per_hour integer, p_effective_from date default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_type text; v_from date; v_posted integer := 0; t record;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_cents_per_hour is null or p_cents_per_hour <= 0 or p_cents_per_hour >= 100000 then return 'error:bad_rate'; end if;
  select employment_type into v_type from public.contractors where id = p_contractor_id;
  if v_type is null then return 'error:not_found'; end if;
  if v_type <> 'employee' then return 'error:not_an_employee'; end if;
  v_from := coalesce(p_effective_from, (now() at time zone 'Australia/Melbourne')::date);
  insert into public.employee_cost_rates (contractor_id, cents_per_hour, effective_from, created_by)
  values (p_contractor_id, p_cents_per_hour, v_from, auth.uid())
  on conflict (contractor_id, effective_from) do update
    set cents_per_hour = excluded.cents_per_hour, created_by = excluded.created_by, created_at = now();
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (p_contractor_id, 'cost_rate_set', jsonb_build_object('effective_from', v_from), auth.uid());
  -- The days that waited for this rate post now, oldest first.
  for t in
    select id from public.timesheet_entries
     where contractor_id = p_contractor_id and status = 'submitted' and work_date >= v_from
     order by work_date
  loop
    if public.timesheet_auto_approve(t.id) like 'ok:%' then v_posted := v_posted + 1; end if;
  end loop;
  return 'ok:' || v_from::text || ':posted:' || v_posted;
end $$;
grant execute on function public.set_employee_cost_rate(uuid, integer, date) to authenticated;

-- Backfill: any day still waiting whose rate has since arrived. A day with no
-- rate stays submitted, as before, and is counted below.
drop table if exists _rate_backfill;
create temp table _rate_backfill (entry_id uuid, result text);
insert into _rate_backfill
select t.id, public.timesheet_auto_approve(t.id)
  from public.timesheet_entries t where t.status = 'submitted' order by t.work_date;

-- Read-back: compare each value to its _expect_ twin before calling this live.
select
  (select position('timesheet_auto_approve' in pg_get_functiondef('public.set_employee_cost_rate(uuid, integer, date)'::regprocedure)) > 0) as rate_posts_waiting_days, true as _expect_rate_posts_waiting_days,
  (select has_function_privilege('authenticated', 'public.set_employee_cost_rate(uuid, integer, date)', 'execute')) as rate_granted, true as _expect_rate_granted,
  (select has_function_privilege('authenticated', 'public.timesheet_auto_approve(uuid)', 'execute')) as auto_approve_not_granted, false as _expect_auto_approve_not_granted,
  (select count(*) from _rate_backfill where result like 'ok:%') as waiting_days_posted_now,
  (select count(*) from _rate_backfill where result = 'error:no_rate') as waiting_days_still_no_rate;

drop table if exists _rate_backfill;

insert into public._prod_migrations(name) values ('20270274000000_cost_rate_approves_waiting_days.sql') on conflict (name) do nothing;

-- =============================================================================
-- 20270228 · The painter status evaluator's tables and its one writer (brief:
-- standards / status / call backs, Step 5; §4, §5, R1–R6, R13–R15, ⚑9, ⚑25)
--
-- The evaluator is TypeScript (lib/painterStatus/evaluate.ts, pure, pinned by
-- the twenty-four golden tests). It reads facts and produces a result per
-- closed job and a colour per painter. This file holds what it writes to and
-- the ONE function allowed to write there: painter_status_write. Nothing else
-- may insert or update painter_job_results, painter_status or raise a
-- painter_bonuses row — not a route, not an action, not the service client
-- directly. The function diffs against what is there and leaves an event for
-- every change (job_result_set, status_changed, bonus_review_raised), so a
-- painter's status is rebuildable from contractor_events alone.
--
-- Also: wo_qa_checks.trigger (why a check exists) and the quality-check cadence
-- by status (§4.5): New → the first jobs as before, Green → none automatic,
-- Yellow → one job in three, Orange and Red → every job; the PC's Spot check.
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. tables ----------------------------------------------------------------
create table if not exists public.painter_job_results (
  id               uuid primary key default gen_random_uuid(),
  painter_id       uuid not null references public.contractors (id) on delete cascade,
  work_order_id    uuid not null references public.work_orders (id) on delete cascade,
  result           text not null check (result in ('pending', 'clean', 'not_clean')),
  reasons          jsonb not null default '[]',
  hours            numeric not null default 0,
  counts_for_bonus boolean not null default false,
  signed_on        date not null,
  -- The job's share of the measures, as banded (and as the result event carries them).
  checks_done      integer not null default 0,
  checks_passed    integer not null default 0,
  moments_scored   integer not null default 0,
  moments_answered integer not null default 0,
  callbacks_scored integer not null default 0,
  credits_applied  integer not null default 0,
  finalised_at     timestamptz,
  computed_at      timestamptz not null default now(),
  unique (work_order_id)
);
create index if not exists painter_job_results_painter_idx on public.painter_job_results (painter_id, signed_on desc);

create table if not exists public.painter_status (
  painter_id    uuid primary key references public.contractors (id) on delete cascade,
  colour        text not null check (colour in ('new', 'green', 'yellow', 'orange', 'red')),
  streak        integer not null default 0,
  best_streak   integer not null default 0,
  measures      jsonb not null default '{}',
  bonus_counter integer not null default 0,
  line          text not null default '',
  computed_at   timestamptz not null default now()
);

create table if not exists public.painter_bonuses (
  id                 uuid primary key default gen_random_uuid(),
  painter_id         uuid not null references public.contractors (id) on delete cascade,
  -- The job whose clean result made the fourth: one review per (painter, trigger).
  trigger_wo_id      uuid not null references public.work_orders (id) on delete cascade,
  qualifying_wo_ids  jsonb not null default '[]',
  triggered_at       timestamptz not null default now(),
  suggested_cents    integer not null default 50000 check (suggested_cents >= 0),
  amount_cents       integer check (amount_cents >= 0),
  status             text not null default 'due' check (status in ('due', 'with_owner', 'approved', 'declined', 'paid')),
  handed_over_at     timestamptz,
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  payment_ref        text not null default '',
  note               text not null default '',
  -- ⚑24-style: a qualifying job changed after the review was raised — flagged, never withdrawn.
  qualifying_changed_at timestamptz,
  unique (painter_id, trigger_wo_id)
);

-- ---- 2. RLS: staff read; a painter reads their OWN results and status; bonuses staff only ---
alter table public.painter_job_results enable row level security;
alter table public.painter_status enable row level security;
alter table public.painter_bonuses enable row level security;
drop policy if exists painter_job_results_staff on public.painter_job_results;
create policy painter_job_results_staff on public.painter_job_results for select to authenticated using (public.is_staff());
drop policy if exists painter_job_results_own on public.painter_job_results;
create policy painter_job_results_own on public.painter_job_results for select to authenticated using (painter_id = public.current_contractor_id());
drop policy if exists painter_status_staff on public.painter_status;
create policy painter_status_staff on public.painter_status for select to authenticated using (public.is_staff());
drop policy if exists painter_status_own on public.painter_status;
create policy painter_status_own on public.painter_status for select to authenticated using (painter_id = public.current_contractor_id());
-- Bonus amounts: owner and PC roles only (⚑13); a painter never reads this table (R14, §6 rule 3).
drop policy if exists painter_bonuses_staff on public.painter_bonuses;
create policy painter_bonuses_staff on public.painter_bonuses for select to authenticated
  using (public.is_staff() and public.has_dashboard_role('owner', 'admin', 'pc'));
revoke all on public.painter_job_results, public.painter_status, public.painter_bonuses from anon;
revoke insert, update, delete on public.painter_job_results, public.painter_status, public.painter_bonuses from authenticated;
grant select on public.painter_job_results, public.painter_status, public.painter_bonuses to authenticated;

-- ---- 3. the numbers (§2–§4) -------------------------------------------------------
insert into public.settings (key, value) values ('painter_status_rules', jsonb_build_object(
  'launchDate', '2026-10-08',   -- ⚑25
  'windowDays', 7,              -- C6 / R6
  'greenRun', 4,                -- R3
  'newJobs', 4,                 -- R5
  'lookback', 10,               -- R4
  'minSample', 5,               -- ⚑24
  'bonusEvery', 4,              -- R15
  'smallJobHours', 16,          -- R15 (also settings.small_job_hours for the tape check)
  'bonusDefaultCents', 50000,   -- R14
  'statusVisibleToPainters', true  -- ⚑21
)) on conflict (key) do nothing;

-- ---- 4. the one writer --------------------------------------------------------------
-- p_results: [{work_order_id, result, reasons, hours, counts_for_bonus, signed_on,
--              checks_done, checks_passed, moments_scored, moments_answered, callbacks_scored, credits_applied}]
-- p_status:  {colour, streak, best_streak, measures, bonus_counter, line}
-- p_bonus_reviews: [{trigger_wo_id, qualifying_wo_ids}]
-- Staff or the service role (the sweep). Idempotent: an unchanged row writes no event.
create or replace function public.painter_status_write(
  p_painter_id uuid, p_results jsonb, p_status jsonb, p_bonus_reviews jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_old record; v_wo uuid; v_result text; v_changed integer := 0; v_removed integer := 0;
  v_prev text; v_colour text; v_bonus integer := 0; v_review jsonb; v_trigger uuid; v_default integer;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then return 'error:not_staff'; end if;
  if not exists (select 1 from public.contractors where id = p_painter_id) then return 'error:not_found'; end if;
  v_default := coalesce((select (value->>'bonusDefaultCents')::integer from public.settings where key = 'painter_status_rules'), 50000);

  -- Results: upsert each; event when new or changed; drop rows for jobs no longer scored.
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_wo := (r->>'work_order_id')::uuid; v_result := r->>'result';
    select * into v_old from public.painter_job_results where work_order_id = v_wo;
    if not found or v_old.painter_id <> p_painter_id or v_old.result <> v_result
       or v_old.checks_done <> (r->>'checks_done')::integer or v_old.checks_passed <> (r->>'checks_passed')::integer
       or v_old.moments_scored <> (r->>'moments_scored')::integer or v_old.moments_answered <> (r->>'moments_answered')::integer
       or v_old.callbacks_scored <> (r->>'callbacks_scored')::integer or v_old.credits_applied <> (r->>'credits_applied')::integer
       or v_old.counts_for_bonus <> (r->>'counts_for_bonus')::boolean or v_old.signed_on <> (r->>'signed_on')::date then
      insert into public.painter_job_results
        (painter_id, work_order_id, result, reasons, hours, counts_for_bonus, signed_on, checks_done, checks_passed,
         moments_scored, moments_answered, callbacks_scored, credits_applied, finalised_at, computed_at)
      values
        (p_painter_id, v_wo, v_result, coalesce(r->'reasons', '[]'::jsonb), coalesce((r->>'hours')::numeric, 0),
         coalesce((r->>'counts_for_bonus')::boolean, false), (r->>'signed_on')::date,
         (r->>'checks_done')::integer, (r->>'checks_passed')::integer, (r->>'moments_scored')::integer,
         (r->>'moments_answered')::integer, (r->>'callbacks_scored')::integer, (r->>'credits_applied')::integer,
         case when v_result = 'pending' then null else now() end, now())
      on conflict (work_order_id) do update
        set painter_id = excluded.painter_id, result = excluded.result, reasons = excluded.reasons, hours = excluded.hours,
            counts_for_bonus = excluded.counts_for_bonus, signed_on = excluded.signed_on,
            checks_done = excluded.checks_done, checks_passed = excluded.checks_passed, moments_scored = excluded.moments_scored,
            moments_answered = excluded.moments_answered, callbacks_scored = excluded.callbacks_scored, credits_applied = excluded.credits_applied,
            finalised_at = case when excluded.result = 'pending' then null else coalesce(public.painter_job_results.finalised_at, now()) end,
            computed_at = now();
      insert into public.contractor_events (contractor_id, type, detail, actor)
      values (p_painter_id, 'job_result_set', r || jsonb_build_object('previous', case when found then v_old.result else null end), auth.uid());
      v_changed := v_changed + 1;
      -- A qualifying job of a raised review changed: flag the review, never withdraw it (§4.3).
      if found and v_old.result <> v_result then
        update public.painter_bonuses set qualifying_changed_at = now()
         where painter_id = p_painter_id and status in ('due', 'with_owner') and qualifying_wo_ids ? v_wo::text and qualifying_changed_at is null;
      end if;
    end if;
  end loop;
  delete from public.painter_job_results
   where painter_id = p_painter_id
     and work_order_id not in (select (x->>'work_order_id')::uuid from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x);
  get diagnostics v_removed = row_count;

  -- Status: upsert; event when the colour changes (the record the trend reads).
  v_colour := p_status->>'colour';
  select colour into v_prev from public.painter_status where painter_id = p_painter_id;
  insert into public.painter_status (painter_id, colour, streak, best_streak, measures, bonus_counter, line, computed_at)
  values (p_painter_id, v_colour, coalesce((p_status->>'streak')::integer, 0), coalesce((p_status->>'best_streak')::integer, 0),
          coalesce(p_status->'measures', '{}'::jsonb), coalesce((p_status->>'bonus_counter')::integer, 0), coalesce(p_status->>'line', ''), now())
  on conflict (painter_id) do update
    set colour = excluded.colour, streak = excluded.streak, best_streak = excluded.best_streak, measures = excluded.measures,
        bonus_counter = excluded.bonus_counter, line = excluded.line, computed_at = now();
  if v_prev is distinct from v_colour then
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_painter_id, 'status_changed', jsonb_build_object('from', v_prev, 'to', v_colour), auth.uid());
  end if;

  -- Bonus reviews: raise each once (unique per painter + trigger job).
  for v_review in select * from jsonb_array_elements(coalesce(p_bonus_reviews, '[]'::jsonb)) loop
    v_trigger := (v_review->>'trigger_wo_id')::uuid;
    insert into public.painter_bonuses (painter_id, trigger_wo_id, qualifying_wo_ids, suggested_cents)
    values (p_painter_id, v_trigger, coalesce(v_review->'qualifying_wo_ids', '[]'::jsonb),
            coalesce((select amount_cents from public.painter_bonuses where painter_id = p_painter_id and status in ('approved', 'paid') order by decided_at desc limit 1), v_default))
    on conflict (painter_id, trigger_wo_id) do nothing;
    if found then
      v_bonus := v_bonus + 1;
      insert into public.contractor_events (contractor_id, type, detail, actor)
      values (p_painter_id, 'bonus_review_raised', jsonb_build_object('trigger_wo_id', v_trigger, 'qualifying_wo_ids', v_review->'qualifying_wo_ids'), auth.uid());
    end if;
  end loop;

  return 'ok:' || v_changed || ':' || v_removed || ':' || coalesce(v_prev, '-') || '>' || v_colour || ':' || v_bonus;
end $$;
revoke all on function public.painter_status_write(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.painter_status_write(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- ---- 5. quality checks by status (§4.5) and the Spot check (R13) ----------------------
alter table public.wo_qa_checks add column if not exists trigger text
  check (trigger in ('new_painter', 'yellow_cadence', 'orange_every', 'required', 'spot', 'recheck', 'mid'));

-- New → the first jobs (existing setting); Green → none automatic; Yellow → one job in
-- three; Orange / Red → every job. The office's per-job flag and the legacy qa_mode
-- 'every_job' still force a check; 'none' and the waiver still stop one.
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_mode text; v_colour text; v_trigger text; v_closed integer;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;
  if coalesce(v_wo.qa_waived, false) then return 'ok:0'; end if;

  select coalesce(qa_mode, 'first_jobs') into v_mode from public.contractors where id = v_wo.contractor_id;
  if v_mode = 'none' and not coalesce(v_wo.qa_required, false) then return 'ok:0'; end if;

  select colour into v_colour from public.painter_status where painter_id = v_wo.contractor_id;
  v_colour := coalesce(v_colour, 'new');

  if coalesce(v_wo.qa_required, false) then v_trigger := 'required';
  elsif v_mode = 'every_job' then v_trigger := 'required';
  elsif v_colour in ('orange', 'red') then v_trigger := 'orange_every';
  elsif v_colour = 'yellow' then
    -- One job in three: the painter's closed jobs so far, counted from the launch.
    select count(*) into v_closed from public.work_orders
     where contractor_id = v_wo.contractor_id and stage = 'closed';
    if v_closed % 3 = 0 then v_trigger := 'yellow_cadence'; else return 'ok:0'; end if;
  elsif v_colour = 'new' and public.wo_contractor_is_new(v_wo.contractor_id) then v_trigger := 'new_painter';
  else
    return 'ok:0';   -- Green (R13: spot checks only), or New past its first jobs
  end if;

  for v_kind in
    select jsonb_array_elements_text(public.wo_loop_setting(array['qaCadence','checks']))
  loop
    if not exists (select 1 from public.wo_qa_checks where work_order_id = p_work_order_id and kind = v_kind) then
      insert into public.wo_qa_checks (work_order_id, kind, scheduled_for, trigger)
        values (p_work_order_id, v_kind, case when v_kind = 'day_one' then v_wo.start_date else null end, v_trigger);
      v_made := v_made + 1;
    end if;
  end loop;
  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_schedule_qa(uuid) to authenticated, service_role;

-- A spot check (R13): the PC's button on any job, any painter. Same function as
-- the mid-job check, with the kind and the trigger that say why.
create or replace function public.wo_add_qa_check(p_work_order_id uuid, p_date date default null, p_kind text default 'mid')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('mid', 'spot') then return 'error:bad_kind'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage in ('closed') then return 'error:closed'; end if;

  update public.work_orders set qa_waived = false where id = p_work_order_id and qa_waived;

  insert into public.wo_qa_checks (work_order_id, kind, scheduled_for, trigger)
    values (p_work_order_id, p_kind, p_date, p_kind) returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'qa_check_added', auth.uid(), 'staff',
            jsonb_build_object('check_id', v_id, 'kind', p_kind, 'date', p_date));
  return 'ok:' || v_id;
end $$;
drop function if exists public.wo_add_qa_check(uuid, date);
revoke all on function public.wo_add_qa_check(uuid, date, text) from public, anon;
grant execute on function public.wo_add_qa_check(uuid, date, text) to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('painter_job_results', 'painter_status', 'painter_bonuses')) as tables, 3 as _expect_tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('painter_job_results', 'painter_status', 'painter_bonuses')) as policies, 5 as _expect_policies,
  has_table_privilege('authenticated', 'public.painter_status', 'insert') as auth_can_insert, false as _expect_no_insert,
  has_function_privilege('authenticated', 'public.painter_status_write(uuid, jsonb, jsonb, jsonb)', 'execute') as writer_grant, true as _expect_writer,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wo_qa_checks' and column_name = 'trigger') as trigger_col, 1 as _expect_trigger_col,
  (select position('painter_status' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wo_schedule_qa') as cadence_by_status, true as _expect_cadence,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'wo_add_qa_check') as add_check_fns, 1 as _expect_one_add_check,
  (select value->>'launchDate' from public.settings where key = 'painter_status_rules') as launch_date, '2026-10-08' as _expect_launch;

insert into public._prod_migrations(name) values ('20270228000000_painter_status.sql') on conflict (name) do nothing;

-- 20270264 · Worker logins — Step 3a of the induction brief
-- (docs/briefs/claude-code-brief-induction-demo-property.md §6, ⚑13–⚑15, §8 Step 3a;
-- ruling 3 of 14 Oct 2026: a membership table, profiles.role stays contractor).
--
-- Every painter on a Paint Group job does the induction, so every worker gets
-- a login. A worker login is SMALL: the jobs their contractor shares with them,
-- the scope and the standards, photos and surface ticks under their own name.
-- Never money, offers, invoices, variations, messages or the status light.
--
-- How the wall holds: current_contractor_id() is NOT taught about workers.
-- Every money read in this database is gated on it (work_orders, offers,
-- contractor invoices, variations, wo_events, the status tables, call backs,
-- the message threads), and a worker has no contractors row, so all of those
-- stay closed. Workers get their own helpers — current_worker_id(),
-- wo_worker_on_job() — which are OR-ed into exactly the gates a shared job
-- needs: the private visibility view (surfaces, photos, checklists, updates,
-- QA checks, sign-off reads), the storage policy, and the tick / photo RPCs.
--
--   · contractor_users: the membership (owner | worker), with the induction
--     stamp Step 5 will fill. wo_worker_shares: which jobs a worker sees.
--   · worker_me(), worker_jobs(): the money-free reads (jsonb_strip_money).
--   · worker_register / worker_remove / worker_share: the contractor manages
--     their crew; staff may act for any contractor. Removal revokes at once:
--     every read and write checks removed_at.
--   · settings.worker_rules.inductionGate (⚑15): OFF until Step 5 exists.
--   · wo_reminder_moment_answer counts a worker tick or photo (ticks count for
--     the contractor job).
--   · A share on a demo job carries is_demo like every other child row.
-- Converges on a re-run.

set lock_timeout = '15s';

-- ---- 1. tables -----------------------------------------------------------------------------
create table if not exists public.contractor_users (
  id             uuid primary key default gen_random_uuid(),
  contractor_id  uuid not null references public.contractors (id) on delete cascade,
  profile_id     uuid not null unique references public.profiles (id) on delete cascade,
  role           text not null default 'worker' check (role in ('owner', 'worker')),
  name           text not null default '',
  mobile         text not null default '',
  invited_at     timestamptz not null default now(),
  last_link_sent_at timestamptz,
  inducted_at    timestamptz,                  -- Step 5 writes it; the share gate reads it
  removed_at     timestamptz,
  removed_by     uuid references auth.users (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists contractor_users_contractor_idx on public.contractor_users (contractor_id) where removed_at is null;

create table if not exists public.wo_worker_shares (
  id                 uuid primary key default gen_random_uuid(),
  work_order_id      uuid not null references public.work_orders (id) on delete cascade,
  contractor_user_id uuid not null references public.contractor_users (id) on delete cascade,
  shared_at          timestamptz not null default now(),
  shared_by          uuid references auth.users (id) on delete set null,
  unshared_at        timestamptz,
  is_demo            boolean not null default false,
  unique (work_order_id, contractor_user_id)
);
create index if not exists wo_worker_shares_worker_idx on public.wo_worker_shares (contractor_user_id) where unshared_at is null;
drop trigger if exists t_demo_flag on public.wo_worker_shares;
create trigger t_demo_flag before insert on public.wo_worker_shares for each row execute function public.demo_flag_copy('work_order_id');

insert into public.settings (key, value) values ('worker_rules', jsonb_build_object(
  'inductionGate', false            -- ⚑15: a worker must finish the worker induction before a share; Step 5 switches it on
)) on conflict (key) do nothing;

-- ---- 2. helpers ------------------------------------------------------------------------------
create or replace function public.current_worker_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.contractor_users
   where profile_id = auth.uid() and role = 'worker' and removed_at is null
$$;

create or replace function public.is_worker() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_worker_id() is not null
$$;

-- Is the signed-in worker on this job: an active share, under a contractor they still belong to.
create or replace function public.wo_worker_on_job(p_work_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wo_worker_shares s
      join public.contractor_users cu on cu.id = s.contractor_user_id
     where s.work_order_id = p_work_order_id
       and s.unshared_at is null
       and cu.profile_id = auth.uid() and cu.role = 'worker' and cu.removed_at is null
  )
$$;
revoke all on function public.current_worker_id() from public, anon;
revoke all on function public.is_worker() from public, anon;
revoke all on function public.wo_worker_on_job(uuid) from public, anon;
grant execute on function public.current_worker_id() to authenticated;
grant execute on function public.is_worker() to authenticated;
grant execute on function public.wo_worker_on_job(uuid) to authenticated;

-- ---- 3. RLS ----------------------------------------------------------------------------------
alter table public.contractor_users enable row level security;
alter table public.wo_worker_shares enable row level security;

drop policy if exists contractor_users_staff on public.contractor_users;
create policy contractor_users_staff on public.contractor_users
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists contractor_users_owner_read on public.contractor_users;
create policy contractor_users_owner_read on public.contractor_users
  for select to authenticated using (contractor_id = (select public.current_contractor_id()));
drop policy if exists contractor_users_self_read on public.contractor_users;
create policy contractor_users_self_read on public.contractor_users
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists wo_worker_shares_staff on public.wo_worker_shares;
create policy wo_worker_shares_staff on public.wo_worker_shares
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists wo_worker_shares_owner_read on public.wo_worker_shares;
create policy wo_worker_shares_owner_read on public.wo_worker_shares
  for select to authenticated using (
    exists (select 1 from public.work_orders w where w.id = work_order_id and w.contractor_id = (select public.current_contractor_id()))
  );
drop policy if exists wo_worker_shares_worker_read on public.wo_worker_shares;
create policy wo_worker_shares_worker_read on public.wo_worker_shares
  for select to authenticated using (
    unshared_at is null and contractor_user_id = (select public.current_worker_id())
  );
revoke insert, update, delete on public.contractor_users from authenticated, anon;
revoke insert, update, delete on public.wo_worker_shares from authenticated, anon;

-- ---- 4. the visibility view: a shared job is visible to the worker ---------------------------
-- 20270154 body (moved to private in 20270201) plus the worker arm. The
-- `_read` policies on wo_surfaces, wo_photos, wo_checklist_items, wo_updates,
-- wo_qa_checks and wo_signoff hold this view by oid, so they follow it.
create or replace view private.wo_visible_jobs with (security_invoker = false) as
  select w.id from public.work_orders w
   where (select public.is_staff())
      or (w.contractor_id is not null and w.contractor_id = (select public.current_contractor_id()))
      or w.id in (select a.work_order_id from public.wo_assignments a
                   where a.contractor_id = (select public.current_contractor_id()) and a.status <> 'released')
      or w.estimate_id in (select e.id from public.estimates e join public.customers cu on cu.id = e.customer_id
                            where cu.profile_id = (select auth.uid()))
      or w.id in (select s.work_order_id from public.wo_worker_shares s
                    join public.contractor_users cu on cu.id = s.contractor_user_id
                   where s.unshared_at is null and cu.role = 'worker' and cu.removed_at is null
                     and cu.profile_id = (select auth.uid()));
grant select on private.wo_visible_jobs to authenticated, anon, service_role;

-- Two of the view-backed reads carry money (a variation price, a pay-change
-- event). 20270153 shut them for employees; a worker is shut out the same way.
drop policy if exists wo_variations_read on public.wo_variations;
create policy wo_variations_read on public.wo_variations
  for select to authenticated
  using (work_order_id in (select id from private.wo_visible_jobs) and not public.is_employee() and not public.is_worker());
drop policy if exists wo_events_read on public.wo_events;
create policy wo_events_read on public.wo_events
  for select to authenticated
  using (work_order_id in (select id from private.wo_visible_jobs) and not public.is_employee() and not public.is_worker());

-- ---- 5. the storage policy: a worker uploads to and reads a shared job ----------------------
create or replace function public.wo_photo_access(p_wo_id text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    v_id := p_wo_id::uuid;
  exception when invalid_text_representation then
    return false;                     -- a path that is not ours authorises nothing
  end;

  if public.is_staff() then return true; end if;

  return exists (
    select 1 from public.work_orders w
     where w.id = v_id
       and (
         public.wo_painter_on_job(w.id, public.current_contractor_id())
         or public.wo_worker_on_job(w.id)
         or exists (select 1 from public.estimates e
                      join public.customers c on c.id = e.customer_id
                     where e.id = w.estimate_id and c.profile_id = auth.uid())
       )
  );
end $$;

-- ---- 6. the two writes a worker may make: tick a surface, record a photo --------------------
-- 20270207 body + the worker arm. actor = auth.uid() is the worker (under their own name).
create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_gated boolean; v_all_done boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  elsif public.wo_worker_on_job(v_wo.id) then
    v_kind := 'worker';                 -- 20270264: a worker on a shared job
  else
    v_cid := public.current_contractor_id();
    -- The lead OR anyone assigned to the job (employed crew, 20270159).
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  -- A row the office marked photos not required never asks for one (20270198).
  v_gated := not coalesce(v_s.photos_optional, false);

  -- Step 1 (Tom, 30 Sep): the job before photos, once, unlock every row.
  if v_gated and p_to <> 'todo' and not public.wo_has_job_photo(v_s.work_order_id, 'before') then
    return 'error:before_photo_required:job';
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  -- Dashboard 0c: the tick that finishes the JOB is a fact worth one row.
  -- Written once — a later un-tick and re-tick does not move it.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id
         and not coalesce(removed_from_scope, false) and state <> 'done'
    ) into v_all_done;
    if v_all_done and not exists (
      select 1 from public.wo_events
       where work_order_id = v_s.work_order_id and type = 'all_surfaces_done'
    ) then
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_s.work_order_id, 'all_surfaces_done', auth.uid(), v_kind,
                jsonb_build_object('last_surface_id', p_surface_id));
    end if;
  end if;

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

create or replace function public.wo_record_photo(p_work_order_id uuid, p_kind public.wo_photo_kind, p_storage_path text, p_surface_id uuid default null, p_area text default '', p_caption text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_cid uuid; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if coalesce(trim(p_storage_path), '') = '' then return 'error:no_path'; end if;

  if public.is_staff() then
    v_kind := 'staff';
  elsif public.wo_worker_on_job(v_wo.id) then
    v_kind := 'worker';                 -- 20270264: a worker on a shared job
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  insert into public.wo_photos (work_order_id, surface_id, area, kind, storage_path, caption, taken_by)
    values (p_work_order_id, p_surface_id, coalesce(p_area, ''), p_kind, p_storage_path,
            coalesce(p_caption, ''), auth.uid())
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'photo', auth.uid(), v_kind,
            jsonb_build_object('photo_id', v_id, 'kind', p_kind::text,
                               'area', coalesce(p_area, ''), 'surface_id', p_surface_id));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_record_photo(uuid, public.wo_photo_kind, text, uuid, text, text) to authenticated;

-- A worker tick or photo answers the reminder moment (the tick counts for the contractor job).
create or replace function public.wo_reminder_moment_answer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_day date; v_id uuid;
begin
  if new.type not in ('surface_tick', 'photo', 'all_surfaces_done') then return new; end if;
  if new.actor_kind not in ('contractor', 'worker', 'system') then return new; end if;
  v_day := (new.created_at at time zone 'Australia/Melbourne')::date;
  select id into v_id from public.wo_reminder_moments
   where work_order_id = new.work_order_id and day = v_day and answered_at is null and skipped_reason is null
   order by due_at limit 1;
  if v_id is null then return new; end if;
  update public.wo_reminder_moments set answered_at = new.created_at, answered_event = new.id where id = v_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (new.work_order_id, 'reminder_moment_answered', new.actor, 'system',
          jsonb_build_object('moment_id', v_id, 'day', v_day, 'by_event', new.id, 'by_type', new.type));
  return new;
end $$;

-- ---- 7. the money-free reads ----------------------------------------------------------------
-- The worker own row, for the portal session.
create or replace function public.worker_me()
returns table (id uuid, contractor_id uuid, name text, mobile text, inducted_at timestamptz, contractor_name text)
language sql stable security definer set search_path = public as $$
  select cu.id, cu.contractor_id, cu.name, cu.mobile, cu.inducted_at,
         coalesce(nullif(trim(c.company_name), ''), nullif(trim(p.name), ''), 'your contractor')
    from public.contractor_users cu
    join public.contractors c on c.id = cu.contractor_id
    left join public.profiles p on p.id = c.profile_id
   where cu.profile_id = auth.uid() and cu.role = 'worker' and cu.removed_at is null
   limit 1
$$;
revoke all on function public.worker_me() from public, anon;
grant execute on function public.worker_me() to authenticated;

-- The jobs shared with the worker: no money column anywhere in the row, the
-- document stripped by jsonb_strip_money (the employee_jobs rule, 20270157).
create or replace function public.worker_jobs(p_work_order_id uuid default null)
returns table (
  work_order_id uuid, wo_ref text, stage text, status text, issued_at timestamptz, viewed_at timestamptz,
  job_start date, job_end date, shared_at timestamptz, is_demo boolean,
  walkthrough_required boolean, colours jsonb, doc jsonb, contractor_name text
)
language sql stable security definer set search_path = public as $$
  select w.id, w.wo_ref, w.stage::text, w.status::text, w.issued_at, w.viewed_at,
         w.start_date, w.end_date, s.shared_at, w.is_demo,
         coalesce(w.walkthrough_required, true), coalesce(w.colours, '{}'::jsonb),
         public.jsonb_strip_money(w.wo_snapshot),
         coalesce(nullif(trim(c.company_name), ''), nullif(trim(p.name), ''), 'your contractor')
    from public.wo_worker_shares s
    join public.contractor_users cu on cu.id = s.contractor_user_id
    join public.work_orders w on w.id = s.work_order_id
    join public.contractors c on c.id = cu.contractor_id
    left join public.profiles p on p.id = c.profile_id
   where cu.profile_id = auth.uid() and cu.role = 'worker' and cu.removed_at is null
     and s.unshared_at is null
     and w.issued_at is not null
     and (p_work_order_id is null or w.id = p_work_order_id)
   order by w.start_date nulls last, s.shared_at desc
$$;
revoke all on function public.worker_jobs(uuid) from public, anon;
grant execute on function public.worker_jobs(uuid) to authenticated;

-- ---- 8. the contractor manages their crew ------------------------------------------------------
-- The auth user is created by the server (scripts cannot be SQL); this links
-- it under the contractor. Staff may name the contractor; a contractor is
-- always themselves.
create or replace function public.worker_register(p_profile_id uuid, p_name text, p_mobile text, p_contractor_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_id uuid;
begin
  v_cid := case when public.is_staff() then coalesce(p_contractor_id, public.current_contractor_id()) else public.current_contractor_id() end;
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if (select employment_type from public.contractors where id = v_cid) = 'employee' then return 'error:employee'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then return 'error:no_profile'; end if;
  if exists (select 1 from public.contractors where profile_id = p_profile_id) then return 'error:is_a_contractor'; end if;
  insert into public.contractor_users (contractor_id, profile_id, role, name, mobile, created_by)
    values (v_cid, p_profile_id, 'worker', left(trim(p_name), 120), left(trim(coalesce(p_mobile, '')), 40), auth.uid())
    on conflict (profile_id) do update
      set contractor_id = excluded.contractor_id, name = excluded.name, mobile = excluded.mobile,
          removed_at = null, removed_by = null, invited_at = now()
    returning id into v_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'worker_added', jsonb_build_object('contractor_user_id', v_id, 'name', left(trim(p_name), 120)), auth.uid());
  return 'ok:' || v_id;
end $$;
revoke all on function public.worker_register(uuid, text, text, uuid) from public, anon;
grant execute on function public.worker_register(uuid, text, text, uuid) to authenticated;

-- Removing a worker revokes access at once: every worker read and write checks removed_at.
create or replace function public.worker_remove(p_contractor_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_cu public.contractor_users%rowtype;
begin
  select * into v_cu from public.contractor_users where id = p_contractor_user_id for update;
  if not found then return 'error:not_found'; end if;
  if not (public.is_staff() or v_cu.contractor_id = public.current_contractor_id()) then return 'error:not_yours'; end if;
  if v_cu.removed_at is not null then return 'ok:already'; end if;
  update public.contractor_users set removed_at = now(), removed_by = auth.uid() where id = p_contractor_user_id;
  update public.wo_worker_shares set unshared_at = now() where contractor_user_id = p_contractor_user_id and unshared_at is null;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cu.contractor_id, 'worker_removed', jsonb_build_object('contractor_user_id', v_cu.id, 'name', v_cu.name), auth.uid());
  return 'ok:removed';
end $$;
revoke all on function public.worker_remove(uuid) from public, anon;
grant execute on function public.worker_remove(uuid) to authenticated;

-- Share or unshare one job with one worker. The job must be the contractor own
-- (or staff), the worker must be theirs and not removed; ⚑15 when switched on.
create or replace function public.worker_share(p_work_order_id uuid, p_contractor_user_id uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cu public.contractor_users%rowtype; v_gate boolean;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  select * into v_cu from public.contractor_users where id = p_contractor_user_id;
  if not found or v_cu.removed_at is not null or v_cu.role <> 'worker' then return 'error:no_worker'; end if;
  if not (public.is_staff() or (v_wo.contractor_id is not null and v_wo.contractor_id = public.current_contractor_id())) then return 'error:not_yours'; end if;
  if v_cu.contractor_id <> v_wo.contractor_id then return 'error:not_your_worker'; end if;
  if p_on then
    v_gate := coalesce((select (value->>'inductionGate')::boolean from public.settings where key = 'worker_rules'), false);
    if v_gate and v_cu.inducted_at is null and not v_wo.is_demo then return 'error:not_inducted'; end if;
    insert into public.wo_worker_shares (work_order_id, contractor_user_id, shared_by)
      values (p_work_order_id, p_contractor_user_id, auth.uid())
      on conflict (work_order_id, contractor_user_id) do update set unshared_at = null, shared_at = now(), shared_by = excluded.shared_by;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'worker_shared', auth.uid(), case when public.is_staff() then 'staff' else 'contractor' end,
              jsonb_build_object('contractor_user_id', v_cu.id, 'name', v_cu.name));
    return 'ok:shared';
  else
    update public.wo_worker_shares set unshared_at = now()
     where work_order_id = p_work_order_id and contractor_user_id = p_contractor_user_id and unshared_at is null;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (p_work_order_id, 'worker_unshared', auth.uid(), case when public.is_staff() then 'staff' else 'contractor' end,
              jsonb_build_object('contractor_user_id', v_cu.id, 'name', v_cu.name));
    return 'ok:unshared';
  end if;
end $$;
revoke all on function public.worker_share(uuid, uuid, boolean) from public, anon;
grant execute on function public.worker_share(uuid, uuid, boolean) to authenticated;

-- ---- 9. read-back: compare every column to its _expect_ before calling this live -----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('contractor_users', 'wo_worker_shares')) as tables_made, 2 as _expect_tables_made,
  (select count(*) from pg_class where relname in ('contractor_users', 'wo_worker_shares') and relrowsecurity) as rls_on, 2 as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('contractor_users', 'wo_worker_shares')) as policies, 6 as _expect_policies,
  (select count(*) from pg_policies where schemaname = 'public' and policyname in ('wo_variations_read', 'wo_events_read') and qual like '%is_worker%') as money_reads_shut_to_workers, 2 as _expect_money_reads_shut_to_workers,
  (select count(*) from pg_proc where proname in ('current_worker_id', 'is_worker', 'wo_worker_on_job', 'worker_me', 'worker_jobs', 'worker_register', 'worker_remove', 'worker_share')) as functions, 8 as _expect_functions,
  (select pg_get_viewdef('private.wo_visible_jobs'::regclass) like '%wo_worker_shares%') as view_has_worker_arm, true as _expect_view_has_worker_arm,
  (select prosrc like '%wo_worker_on_job%' from pg_proc where proname = 'wo_photo_access') as storage_has_worker_arm, true as _expect_storage_has_worker_arm,
  (select prosrc like '%v_kind := ''worker''%' from pg_proc where proname = 'wo_tick_surface') as tick_has_worker_arm, true as _expect_tick_has_worker_arm,
  (select prosrc like '%v_kind := ''worker''%' from pg_proc where proname = 'wo_record_photo') as photo_has_worker_arm, true as _expect_photo_has_worker_arm,
  (select prosrc like '%''worker''%' from pg_proc where proname = 'wo_reminder_moment_answer') as answer_counts_worker, true as _expect_answer_counts_worker,
  (select count(*) from pg_trigger where tgname = 't_demo_flag' and tgrelid = 'public.wo_worker_shares'::regclass) as share_demo_trigger, 1 as _expect_share_demo_trigger,
  has_table_privilege('authenticated', 'public.contractor_users', 'insert') as auth_can_insert_workers, false as _expect_auth_can_insert_workers,
  has_function_privilege('authenticated', 'public.worker_share(uuid, uuid, boolean)', 'execute') as auth_can_share, true as _expect_auth_can_share,
  has_function_privilege('anon', 'public.worker_jobs(uuid)', 'execute') as anon_can_list, false as _expect_anon_can_list,
  (select (value->>'inductionGate')::boolean from public.settings where key = 'worker_rules') as induction_gate, false as _expect_induction_gate;

insert into public._prod_migrations(name) values ('20270264000000_worker_logins.sql') on conflict (name) do nothing;

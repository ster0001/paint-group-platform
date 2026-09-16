-- =============================================================================
-- Employed painters — Session 2: assignments, Accept, lead painter, unavailability
-- (docs/briefs/claude-code-brief-employed-painters.md §3.2;
--  docs/briefs/employed-painters-session-0.md §3 — ⚑E ⚑G ⚑H defaults)
--
-- An EMPLOYEE's job is assigned, not offered. It lands in their calendar the
-- moment the office drops it there; they tap Accept once to say they have
-- seen it, and nothing waits on that tap. Several employees can be on one
-- job, each with their own dates, and exactly one of them is the LEAD — the
-- painter the customer hears about.
--
-- Why a new table and not booking_offers: `booking_offers_one_live` (one live
-- offer per job) is the direct negation of "several painters per job", the
-- offer carries payment_cents (money an employee must never be one policy
-- away from), and its state machine means something else. Why `wo_*` and not
-- `job_assignments`: that name is taken by dead v1 scaffolding on `jobs`
-- (20260813:311), and the loop's tables are all `wo_*`.
--
-- The lead painter IS `work_orders.contractor_id`. That one decision keeps
-- every existing "who's painting" read (portal, confirmation email,
-- walkthrough invite, board pins) correct without touching it, and the money
-- policies from 20270153 still exclude the lead because they test
-- is_employee(), not the column. The other painters on the job reach it
-- through wo_visible_jobs, widened below.
--
-- Contractors: nothing here touches booking_offers, respond_to_offer or the
-- stage trigger. A contractor drop still creates a booking request.
-- =============================================================================

-- ---- 1. Status enum + table -------------------------------------------------
do $$ begin
  create type public.wo_assignment_status as enum ('assigned', 'accepted', 'released');
exception when duplicate_object then null; end $$;

create table if not exists public.wo_assignments (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  contractor_id  uuid not null references public.contractors (id) on delete cascade,
  start_date     date not null,
  end_date       date not null,
  is_lead        boolean not null default false,
  status         public.wo_assignment_status not null default 'assigned',
  assigned_by    uuid references auth.users (id) on delete set null,
  assigned_at    timestamptz not null default now(),
  /** The painter's one-tap Accept. Cleared when their dates change. */
  accepted_at    timestamptz,
  released_at    timestamptz,
  released_reason text not null default '',
  /** Set when the office scheduled over a conflict on purpose. */
  override_reason text not null default '',
  created_at     timestamptz not null default now(),
  constraint wo_assignments_range check (end_date >= start_date),
  constraint wo_assignments_accepted_shape check (
    (status = 'accepted') = (accepted_at is not null) or status = 'released'
  ),
  constraint wo_assignments_released_shape check ((status = 'released') = (released_at is not null))
);

-- Exactly one lead per job among the painters still on it.
create unique index if not exists wo_assignments_one_lead
  on public.wo_assignments (work_order_id) where is_lead and status <> 'released';
-- A painter is on a job once.
create unique index if not exists wo_assignments_one_per_painter
  on public.wo_assignments (work_order_id, contractor_id) where status <> 'released';
create index if not exists wo_assignments_wo_idx on public.wo_assignments (work_order_id);
create index if not exists wo_assignments_painter_dates_idx
  on public.wo_assignments (contractor_id, start_date, end_date) where status <> 'released';

alter table public.wo_assignments enable row level security;

drop policy if exists wo_assignments_staff on public.wo_assignments;
create policy wo_assignments_staff on public.wo_assignments
  for select to authenticated using ((select public.is_staff()));

-- A painter reads their own rows — and the other painters on the SAME job,
-- so "1 of 3" and the lead marker can render on their calendar. No money on
-- this table, so the sibling rows are safe to show. Through the SECURITY
-- DEFINER list (widened in §3 below), never a subquery on this table: a
-- policy that selects from its own table recurses.
drop policy if exists wo_assignments_painter on public.wo_assignments;
create policy wo_assignments_painter on public.wo_assignments
  for select to authenticated
  using (wo_assignments.work_order_id in (select public.wo_my_job_ids_as_contractor()));

-- Every write goes through the RPCs below.
revoke insert, update, delete on public.wo_assignments from authenticated, anon;
grant select on public.wo_assignments to authenticated;

-- ---- 2. Unavailability gains kinds and an approval (⚑H: extend, don't fork) --
do $$ begin
  create type public.unavailability_kind as enum ('other', 'leave', 'rdo', 'sick');
exception when duplicate_object then null; end $$;

alter table public.contractor_unavailability
  add column if not exists kind         public.unavailability_kind not null default 'other',
  add column if not exists requested_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_by  uuid references auth.users (id) on delete set null,
  add column if not exists approved_at  timestamptz;

comment on column public.contractor_unavailability.kind is
  'other = a blocked-out day (contractors, and staff blocks). leave / rdo need PC approval (approved_at); sick is self-marked and counts at once. Session 7 builds the request + approve flow; Session 2 only refuses to schedule over them.';

-- ---- 3. The membership list knows about assignments -------------------------
-- wo_visible_jobs is the owner-rights view every loop table's read policy
-- keys on (20261213). A painter on a job by assignment sees its surfaces,
-- photos, checklists and updates exactly as the contractor_id painter does.
create or replace view public.wo_visible_jobs
with (security_invoker = false) as
  select w.id from public.work_orders w
   where (select public.is_staff())
      or (w.contractor_id is not null
          and w.contractor_id = (select public.current_contractor_id()))
      or w.id in (select a.work_order_id from public.wo_assignments a
                   where a.contractor_id = (select public.current_contractor_id())
                     and a.status <> 'released')
      or w.estimate_id in (select e.id from public.estimates e
                             join public.customers cu on cu.id = e.customer_id
                            where cu.profile_id = (select auth.uid()));

grant select on public.wo_visible_jobs to authenticated;
revoke all on public.wo_visible_jobs from anon;

create or replace function public.wo_my_job_ids_as_contractor()
returns setof uuid language sql stable security definer set search_path = public as $$
  select w.id from public.work_orders w
   where w.contractor_id is not null
     and w.contractor_id = public.current_contractor_id()
  union
  select a.work_order_id from public.wo_assignments a
   where a.contractor_id = public.current_contractor_id()
     and a.status <> 'released'
$$;

-- ---- 4. One read surface for "who is on this job" ---------------------------
-- Contractor bookings ∪ employee assignments. The calendar and the customer's
-- painter name read THIS, never two tables — and nothing is mirrored.
create or replace function public.wo_painters(p_work_order_id uuid)
returns table (
  contractor_id uuid, is_lead boolean, start_date date, end_date date,
  source text, assignment_id uuid, accepted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select a.contractor_id, a.is_lead, a.start_date, a.end_date,
         'assignment'::text, a.id, a.accepted_at
    from public.wo_assignments a
   where a.work_order_id = p_work_order_id and a.status <> 'released'
  union all
  select o.contractor_id, true, coalesce(o.proposed_start_date, o.start_date), o.end_date,
         'booking'::text, null::uuid, o.responded_at
    from public.booking_offers o
   where o.work_order_id = p_work_order_id and o.state = 'accepted'
     and not exists (select 1 from public.wo_assignments a
                      where a.work_order_id = p_work_order_id and a.status <> 'released')
$$;
grant execute on function public.wo_painters(uuid) to authenticated;

-- ---- 5. Conflict check (shared by assign + reassign) ------------------------
-- Names what it hit, so the office reads "overlaps WO-1234" not "conflict".
-- Leave / RDO count only once approved; sick and plain blocks count at once.
create or replace function public.wo_assignment_conflict(
  p_contractor_id uuid, p_start date, p_end date, p_ignore_assignment uuid default null
) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'conflict:overlap:' || w.wo_ref
       from public.wo_assignments a join public.work_orders w on w.id = a.work_order_id
      where a.contractor_id = p_contractor_id and a.status <> 'released'
        and a.id is distinct from p_ignore_assignment
        and a.start_date <= p_end and a.end_date >= p_start
      order by a.start_date limit 1),
    (select 'conflict:unavailable:' || u.kind::text || ':' || u.start_date::text
       from public.contractor_unavailability u
      where u.contractor_id = p_contractor_id
        and u.start_date <= p_end and u.end_date >= p_start
        and (u.kind in ('other', 'sick') or u.approved_at is not null)
      order by u.start_date limit 1)
  )
$$;

-- ---- 6. assign_job ----------------------------------------------------------
-- p_painters: [{ "contractor_id": uuid, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }, …]
-- The FIRST assignment on a job moves it out of stage 1 exactly as a
-- contractor's acceptance does — same wo_set_stage, actor staff, and the
-- event's meta carries acceptance_mode = 'assigned' (brief §3.4: a label,
-- never a new enum value). Later calls add painters to a job already
-- underway and leave the stage alone.
create or replace function public.assign_job(
  p_work_order_id uuid,
  p_painters jsonb,
  p_lead_contractor_id uuid,
  p_override_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_p jsonb;
  v_cid uuid; v_start date; v_end date;
  v_type text; v_active boolean;
  v_conflict text;
  v_existing integer;
  v_first boolean;
  v_lead_seen boolean := false;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_stage text;
  v_span_start date; v_span_end date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_painters is null or jsonb_typeof(p_painters) <> 'array' or jsonb_array_length(p_painters) = 0 then
    return 'error:no_painters';
  end if;

  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;

  -- Ruling 9: no mixed crews. A job with a live or accepted contractor offer
  -- is a contractor job.
  if exists (select 1 from public.booking_offers
              where work_order_id = p_work_order_id and state in ('offered', 'proposed', 'accepted')) then
    return 'conflict:contractor_job';
  end if;

  select count(*) into v_existing from public.wo_assignments
   where work_order_id = p_work_order_id and status <> 'released';
  v_first := v_existing = 0;

  -- Validate every painter before writing any row.
  for v_p in select * from jsonb_array_elements(p_painters) loop
    v_cid := (v_p->>'contractor_id')::uuid;
    v_start := (v_p->>'start_date')::date;
    v_end := coalesce((v_p->>'end_date')::date, v_start);
    if v_cid is null or v_start is null then return 'error:bad_painter'; end if;
    if v_end < v_start then return 'error:bad_dates'; end if;

    select employment_type, active into v_type, v_active from public.contractors where id = v_cid;
    if v_type is null then return 'error:contractor_not_found'; end if;
    if not v_active then return 'error:contractor_suspended'; end if;
    if v_type <> 'employee' then return 'error:not_employee'; end if;

    if exists (select 1 from public.wo_assignments
                where work_order_id = p_work_order_id and contractor_id = v_cid and status <> 'released') then
      return 'conflict:already_assigned';
    end if;

    v_conflict := public.wo_assignment_conflict(v_cid, v_start, v_end, null);
    if v_conflict is not null and coalesce(p_override_reason, '') = '' then
      return v_conflict;
    end if;
    if v_cid = p_lead_contractor_id then v_lead_seen := true; end if;
  end loop;

  -- The lead must be one of the painters being added, or already on the job.
  if not v_lead_seen and not exists (
    select 1 from public.wo_assignments
     where work_order_id = p_work_order_id and contractor_id = p_lead_contractor_id and status <> 'released'
  ) then
    return 'error:lead_not_on_job';
  end if;

  -- One lead. If the office names a new lead while adding painters, the old
  -- lead steps down in the same transaction.
  update public.wo_assignments set is_lead = false
   where work_order_id = p_work_order_id and status <> 'released' and is_lead
     and contractor_id <> p_lead_contractor_id;

  for v_p in select * from jsonb_array_elements(p_painters) loop
    v_cid := (v_p->>'contractor_id')::uuid;
    v_start := (v_p->>'start_date')::date;
    v_end := coalesce((v_p->>'end_date')::date, v_start);
    v_conflict := public.wo_assignment_conflict(v_cid, v_start, v_end, null);
    insert into public.wo_assignments (
      work_order_id, contractor_id, start_date, end_date, is_lead, assigned_by, override_reason
    ) values (
      p_work_order_id, v_cid, v_start, v_end, v_cid = p_lead_contractor_id, auth.uid(),
      case when v_conflict is not null then coalesce(p_override_reason, '') else '' end
    ) returning id into v_id;
    v_ids := v_ids || v_id;

    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'assignment_made', auth.uid(), 'staff',
            jsonb_build_object('assignment_id', v_id, 'contractor_id', v_cid,
                               'start_date', v_start, 'end_date', v_end,
                               'is_lead', v_cid = p_lead_contractor_id,
                               'override', v_conflict, 'override_reason',
                               case when v_conflict is not null then p_override_reason else null end));
  end loop;
  update public.wo_assignments set is_lead = true
   where work_order_id = p_work_order_id and contractor_id = p_lead_contractor_id and status <> 'released';

  -- The lead painter IS work_orders.contractor_id; the job's span is the
  -- union of everyone's days.
  select min(start_date), max(end_date) into v_span_start, v_span_end
    from public.wo_assignments where work_order_id = p_work_order_id and status <> 'released';
  update public.work_orders
     set contractor_id = p_lead_contractor_id, start_date = v_span_start, end_date = v_span_end
   where id = p_work_order_id;

  if v_first and v_wo.stage = 'offered' then
    v_stage := public.wo_set_stage(p_work_order_id, 'pre_start', 'staff',
                 jsonb_build_object('via', 'assigned', 'acceptance_mode', 'assigned',
                                    'assignment_ids', to_jsonb(v_ids)));
    if v_stage not like 'ok:%' then
      raise exception 'assign_job: stage refused (%)', v_stage;
    end if;
  end if;

  return 'ok:assigned:' || array_length(v_ids, 1)::text;
end $$;
grant execute on function public.assign_job(uuid, jsonb, uuid, text) to authenticated;

-- ---- 7. acknowledge_assignment — the painter's Accept tap --------------------
-- An acknowledgement, not approval (ruling 2). Idempotent. Nothing waits on it.
create or replace function public.acknowledge_assignment(p_assignment_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_assignments%rowtype;
begin
  select * into v_a from public.wo_assignments where id = p_assignment_id for update;
  if not found then return 'error:not_found'; end if;
  if v_a.contractor_id is distinct from public.current_contractor_id() then return 'error:not_yours'; end if;
  if v_a.status = 'released' then return 'error:released'; end if;
  if v_a.accepted_at is not null then return 'ok:accepted'; end if;

  update public.wo_assignments set status = 'accepted', accepted_at = now() where id = p_assignment_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'assignment_acknowledged', auth.uid(), 'contractor',
          jsonb_build_object('assignment_id', p_assignment_id, 'contractor_id', v_a.contractor_id));
  return 'ok:accepted';
end $$;
grant execute on function public.acknowledge_assignment(uuid) to authenticated;

-- ---- 8. reassign_dates — move one painter's days; they accept again ---------
create or replace function public.reassign_dates(
  p_assignment_id uuid, p_start date, p_end date, p_override_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_assignments%rowtype; v_conflict text; v_s date; v_e date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;
  if coalesce(p_end, p_start) < p_start then return 'error:bad_dates'; end if;

  select * into v_a from public.wo_assignments where id = p_assignment_id for update;
  if not found then return 'error:not_found'; end if;
  if v_a.status = 'released' then return 'error:released'; end if;
  if v_a.start_date = p_start and v_a.end_date = coalesce(p_end, p_start) then return 'ok:unchanged'; end if;

  v_conflict := public.wo_assignment_conflict(v_a.contractor_id, p_start, coalesce(p_end, p_start), p_assignment_id);
  if v_conflict is not null and coalesce(p_override_reason, '') = '' then return v_conflict; end if;

  update public.wo_assignments
     set start_date = p_start, end_date = coalesce(p_end, p_start),
         status = 'assigned', accepted_at = null,
         override_reason = case when v_conflict is not null then coalesce(p_override_reason, '') else override_reason end
   where id = p_assignment_id;

  select min(start_date), max(end_date) into v_s, v_e
    from public.wo_assignments where work_order_id = v_a.work_order_id and status <> 'released';
  update public.work_orders set start_date = v_s, end_date = v_e where id = v_a.work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'assignment_dates_changed', auth.uid(), 'staff',
          jsonb_build_object('assignment_id', p_assignment_id, 'contractor_id', v_a.contractor_id,
                             'from', jsonb_build_object('start_date', v_a.start_date, 'end_date', v_a.end_date),
                             'to', jsonb_build_object('start_date', p_start, 'end_date', coalesce(p_end, p_start)),
                             'override', v_conflict, 'override_reason',
                             case when v_conflict is not null then p_override_reason else null end));
  return 'ok:moved';
end $$;
grant execute on function public.reassign_dates(uuid, date, date, text) to authenticated;

-- ---- 9. set_lead_painter — the Lead painter button ---------------------------
create or replace function public.set_lead_painter(p_work_order_id uuid, p_contractor_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_stage public.wo_stage; v_old uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select stage into v_stage from public.work_orders where id = p_work_order_id for update;
  if v_stage is null then return 'error:work_order_not_found'; end if;
  if v_stage = 'closed' then return 'error:closed'; end if;
  if not exists (select 1 from public.wo_assignments
                  where work_order_id = p_work_order_id and contractor_id = p_contractor_id and status <> 'released') then
    return 'error:not_on_job';
  end if;
  select contractor_id into v_old from public.wo_assignments
   where work_order_id = p_work_order_id and is_lead and status <> 'released';
  if v_old = p_contractor_id then return 'ok:unchanged'; end if;

  update public.wo_assignments set is_lead = false
   where work_order_id = p_work_order_id and status <> 'released' and is_lead;
  update public.wo_assignments set is_lead = true
   where work_order_id = p_work_order_id and contractor_id = p_contractor_id and status <> 'released';
  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'lead_painter_changed', auth.uid(), 'staff',
          jsonb_build_object('from', v_old, 'to', p_contractor_id));
  return 'ok:lead';
end $$;
grant execute on function public.set_lead_painter(uuid, uuid) to authenticated;

-- ---- 10. release_assignment — future days only; past ticks stay -------------
-- The lead cannot be released while anyone else is on the job: name a new
-- lead first. Releasing the LAST painter sends the job back to the tray.
create or replace function public.release_assignment(p_assignment_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_assignments%rowtype; v_others integer; v_s date; v_e date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_a from public.wo_assignments where id = p_assignment_id for update;
  if not found then return 'error:not_found'; end if;
  if v_a.status = 'released' then return 'ok:released'; end if;

  select count(*) into v_others from public.wo_assignments
   where work_order_id = v_a.work_order_id and status <> 'released' and id <> p_assignment_id;
  if v_a.is_lead and v_others > 0 then return 'error:lead_needs_replacement'; end if;

  update public.wo_assignments
     set status = 'released', released_at = now(), released_reason = coalesce(p_reason, ''), is_lead = false
   where id = p_assignment_id;

  if v_others = 0 then
    update public.work_orders set contractor_id = null, start_date = null, end_date = null
     where id = v_a.work_order_id;
  else
    select min(start_date), max(end_date) into v_s, v_e
      from public.wo_assignments where work_order_id = v_a.work_order_id and status <> 'released';
    update public.work_orders set start_date = v_s, end_date = v_e where id = v_a.work_order_id;
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'assignment_released', auth.uid(), 'staff',
          jsonb_build_object('assignment_id', p_assignment_id, 'contractor_id', v_a.contractor_id,
                             'reason', coalesce(p_reason, ''), 'was_lead', v_a.is_lead));
  return 'ok:released';
end $$;
grant execute on function public.release_assignment(uuid, text) to authenticated;

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select relrowsecurity from pg_class where oid = 'public.wo_assignments'::regclass) as assignments_rls,
  (select count(*) from pg_policies where tablename = 'wo_assignments') = 2 as assignments_policies,
  (select count(*) from pg_indexes where tablename = 'wo_assignments' and indexname in ('wo_assignments_one_lead', 'wo_assignments_one_per_painter')) = 2 as lead_and_once_indexes,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractor_unavailability'
     and column_name in ('kind', 'requested_by', 'approved_by', 'approved_at')) = 4 as unavailability_columns,
  (select pg_get_viewdef('public.wo_visible_jobs'::regclass) like '%wo_assignments%') as visible_jobs_widened,
  (select count(*) from pg_proc where proname in ('wo_painters', 'wo_assignment_conflict', 'assign_job',
     'acknowledge_assignment', 'reassign_dates', 'set_lead_painter', 'release_assignment')) = 7 as seven_functions,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'wo_assignments' and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) = 0 as no_client_writes;

insert into public._prod_migrations(name) values ('20270154000000_wo_assignments.sql') on conflict (name) do nothing;

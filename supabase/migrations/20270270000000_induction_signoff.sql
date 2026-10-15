-- 20270270 · Induction sign-off: module ticks, the practical check, completion, the gates
-- (docs/briefs/claude-code-brief-induction-demo-property.md §5, §8 Step 5; rulings I1, I2, I5, I9, I11, ⚑1, ⚑5, ⚑9, ⚑15, ⚑17).
--
-- The standards sign-off (20270225) becomes the 13-module induction:
--   · induction_acks — one row per painter login per module (Module 5 for a contractor IS the
--     six standards_acks rows; for a worker login it is six induction_acks rows with a section).
--     Keyed by the auth user, because a worker has no contractors row (ruling I11).
--   · induction_checks — the facilitator practical check: five tasks for a contractor, three
--     for a worker (⚑17), pass or not_yet, recorded by staff only (⚑5).
--   · contractors.induction_kind — full (new painters) or refresher (modules 0, 3, 6, 7, 8, 9 plus
--     the standards; never the practical check). Every contractor on the books today becomes a
--     refresher once; a painter who joins after this file runs is full.
--   · contractors.induction_invited_at / induction_grace_until — the refresher is invited by the
--     office with the standards grace period (settings.standards_rules.graceDays); offers keep
--     flowing until the grace ends. A full induction has no grace: a new painter is blocked until
--     the induction is complete, the check passed and insurance on file (⚑1).
--   · The gates: induction_gate_of(contractor) is read by send_offer and the booking_offers
--     trigger (no path around the RPC); worker_rules.inductionGate turns ON (⚑15) and
--     contractor_users.inducted_at is written here when a worker completes the worker
--     induction and passes the three-task check — never by hand.
--   · induction_publish_version(no, changed_modules, note) — a material change bumps the
--     version, carries every tick forward except the changed modules, and keeps the note on
--     those modules so the painter reads what changed first (§5).
--   · settings.induction_rules: offerGate true; reTickMonths 12 (⚑9); expiryBlocks false (⚑).
-- Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. tables and columns ---------------------------------------------------------------
create table if not exists public.induction_acks (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references auth.users (id) on delete cascade,
  version_id  uuid not null references public.induction_versions (id) on delete cascade,
  module_key  text not null check (module_key ~ '^m[0-9]{2}$'),
  section_key text not null default '',
  language    text not null default 'en' references public.induction_languages (code),
  acked_at    timestamptz not null default now(),
  unique (profile_id, version_id, module_key, section_key)
);
create index if not exists induction_acks_profile_idx on public.induction_acks (profile_id, version_id);

create table if not exists public.induction_checks (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references auth.users (id) on delete cascade,
  version_id  uuid not null references public.induction_versions (id) on delete cascade,
  task_key    text not null,
  result      text not null check (result in ('pass', 'not_yet')),
  note        text not null default '',
  checked_by  uuid references auth.users (id) on delete set null,
  checked_at  timestamptz not null default now(),
  unique (profile_id, version_id, task_key)
);
create index if not exists induction_checks_profile_idx on public.induction_checks (profile_id, version_id);

alter table public.contractors add column if not exists induction_kind text not null default 'full';
alter table public.contractors drop constraint if exists contractors_induction_kind_check;
alter table public.contractors add constraint contractors_induction_kind_check check (induction_kind in ('full', 'refresher'));
alter table public.contractors add column if not exists induction_invited_at timestamptz;
alter table public.contractors add column if not exists induction_grace_until timestamptz;
alter table public.induction_modules add column if not exists change_note text not null default '';
alter type public.contractor_doc_kind add value if not exists 'induction';

-- ---- 2. settings ---------------------------------------------------------------------------
insert into public.settings (key, value) values ('induction_rules', jsonb_build_object(
  'offerGate', true,
  'reTickMonths', 12,
  'expiryBlocks', false,
  'fullTasks', jsonb_build_array('accept_job', 'before_photo', 'prepped', 'variation', 'invoice'),
  'workerTasks', jsonb_build_array('open_job', 'before_photo', 'prepped')
)) on conflict (key) do nothing;

-- Every contractor on the books before this file ran does the refresher (ruling I13), once.
update public.contractors set induction_kind = 'refresher'
 where induction_kind = 'full'
   and not exists (select 1 from public.settings where key = 'induction_rules' and value ? 'refresherAssignedAt');
update public.settings set value = value || jsonb_build_object('refresherAssignedAt', now())
 where key = 'induction_rules' and not (value ? 'refresherAssignedAt');

-- The share gate switches on (⚑15): a worker goes on a real job once inducted.
update public.settings set value = jsonb_set(value, '{inductionGate}', 'true'::jsonb) where key = 'worker_rules';

-- ---- 3. RLS: painters read their own rows, staff read all, nothing writes but the RPCs -----
alter table public.induction_acks   enable row level security;
alter table public.induction_checks enable row level security;
drop policy if exists induction_acks_own_read on public.induction_acks;
create policy induction_acks_own_read on public.induction_acks for select to authenticated using (profile_id = auth.uid());
drop policy if exists induction_acks_staff_read on public.induction_acks;
create policy induction_acks_staff_read on public.induction_acks for select to authenticated using (public.is_staff());
drop policy if exists induction_checks_own_read on public.induction_checks;
create policy induction_checks_own_read on public.induction_checks for select to authenticated using (profile_id = auth.uid());
drop policy if exists induction_checks_staff_read on public.induction_checks;
create policy induction_checks_staff_read on public.induction_checks for select to authenticated using (public.is_staff());
revoke all on public.induction_acks, public.induction_checks from anon;
revoke insert, update, delete on public.induction_acks, public.induction_checks from authenticated;
grant select on public.induction_acks, public.induction_checks to authenticated;

-- ---- 4. helpers (no grants: called by the definer functions below) ------------------------
-- The version everyone must have ticked: the newest PUBLISHED full one.
create or replace function public.induction_required_version()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.induction_versions where version_kind = 'full' and published_at is not null order by version_no desc limit 1
$$;

-- What kind of induction this login does: worker (a worker login), refresher or full (a contractor), null (neither).
create or replace function public.induction_kind_of(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'worker' from public.contractor_users cu where cu.profile_id = p_profile_id and cu.role = 'worker' and cu.removed_at is null),
    (select c.induction_kind from public.contractors c where c.profile_id = p_profile_id))
$$;

-- The modules a kind reads, in order: full = every module but the refresher one; refresher and
-- worker = the modules whose lines carry that audience (lib/induction/source.ts writes them).
create or replace function public.induction_modules_for(p_kind text)
returns table (module_key text, sort integer) language sql stable security definer set search_path = public as $$
  select m.module_key, m.sort
    from public.induction_modules m
   where m.version_id = public.induction_required_version()
     and case when p_kind = 'full' then m.module_key <> 'm00'
              else exists (select 1 from public.induction_blocks b where b.module_id = m.id and b.language = 'en' and b.audiences @> array[p_kind]) end
   order by m.sort
$$;

-- The practical check tasks for a kind: none for the refresher (§5).
create or replace function public.induction_tasks_for(p_kind text)
returns text[] language sql stable security definer set search_path = public as $$
  select case when p_kind = 'refresher' then array[]::text[]
              when p_kind = 'worker' then coalesce((select array(select jsonb_array_elements_text(value->'workerTasks')) from public.settings where key = 'induction_rules'), array['open_job','before_photo','prepped'])
              else coalesce((select array(select jsonb_array_elements_text(value->'fullTasks')) from public.settings where key = 'induction_rules'), array['accept_job','before_photo','prepped','variation','invoice']) end
$$;

-- Is one module ticked by this login on the required version. Module 5 is the standards:
-- a contractor is ticked when standards_acks has the six sections on the required standards
-- version (one writer, 20270225); a worker login when six induction_acks sections are in.
create or replace function public.induction_module_ticked(p_profile_id uuid, p_module_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_vid uuid; v_cid uuid;
begin
  v_vid := public.induction_required_version();
  if v_vid is null then return false; end if;
  if p_module_key = 'm05' then
    select id into v_cid from public.contractors where profile_id = p_profile_id;
    if v_cid is not null then
      return coalesce(public.standards_confirmed_no(v_cid), 0) >= coalesce(public.standards_required_no(), 1);
    end if;
    return (select count(distinct section_key) from public.induction_acks
             where profile_id = p_profile_id and version_id = v_vid and module_key = 'm05' and section_key <> '') >= 6;
  end if;
  return exists (select 1 from public.induction_acks where profile_id = p_profile_id and version_id = v_vid and module_key = p_module_key and section_key = '');
end $$;

-- When the induction was completed on the required version: the newest tick once every
-- module of the kind is in; null while incomplete.
create or replace function public.induction_completed_at(p_profile_id uuid)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v_kind text; v_vid uuid; v_missing integer; v_at timestamptz; v_cid uuid;
begin
  v_kind := public.induction_kind_of(p_profile_id);
  v_vid := public.induction_required_version();
  if v_kind is null or v_vid is null then return null; end if;
  select count(*) into v_missing from public.induction_modules_for(v_kind) m where not public.induction_module_ticked(p_profile_id, m.module_key);
  if v_missing > 0 then return null; end if;
  select max(acked_at) into v_at from public.induction_acks where profile_id = p_profile_id and version_id = v_vid;
  select id into v_cid from public.contractors where profile_id = p_profile_id;
  if v_cid is not null then
    v_at := greatest(coalesce(v_at, '-infinity'::timestamptz),
                     coalesce((select max(a.acked_at) from public.standards_acks a join public.standards_versions v on v.id = a.version_id
                                where a.contractor_id = v_cid and v.version_no = public.standards_required_no()), '-infinity'::timestamptz));
  end if;
  return nullif(v_at, '-infinity'::timestamptz);
end $$;

-- Has the practical check been passed: every task of the kind marked pass on the required version.
create or replace function public.induction_check_passed(p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_kind text; v_vid uuid; v_tasks text[]; v_t text;
begin
  v_kind := public.induction_kind_of(p_profile_id);
  v_vid := public.induction_required_version();
  if v_kind is null or v_vid is null then return false; end if;
  v_tasks := public.induction_tasks_for(v_kind);
  if coalesce(array_length(v_tasks, 1), 0) = 0 then return true; end if;
  foreach v_t in array v_tasks loop
    if not exists (select 1 from public.induction_checks where profile_id = p_profile_id and version_id = v_vid and task_key = v_t and result = 'pass') then return false; end if;
  end loop;
  return true;
end $$;

-- ---- 5. the one gate rule (mirrored word for word by lib/induction/status.ts) -------------
-- ok | induction_incomplete | check_not_passed. A full induction (a new painter) needs the
-- ticks and the check; a refresher needs the ticks, after the office has invited them and
-- the grace has run out; nothing is required while settings.induction_rules.offerGate is off
-- or while the required version is unpublished. A tick older than reTickMonths counts only
-- when expiryBlocks is on (⚑9).
create or replace function public.induction_gate_of(p_contractor_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid; v_kind text; v_rules jsonb; v_done timestamptz; v_grace timestamptz; v_months integer;
begin
  select profile_id, induction_kind, induction_grace_until into v_pid, v_kind, v_grace from public.contractors where id = p_contractor_id;
  if v_pid is null then return 'ok'; end if;
  select value into v_rules from public.settings where key = 'induction_rules';
  if not coalesce((v_rules->>'offerGate')::boolean, true) then return 'ok'; end if;
  if public.induction_required_version() is null then return 'ok'; end if;
  v_done := public.induction_completed_at(v_pid);
  v_months := coalesce((v_rules->>'reTickMonths')::integer, 12);
  if v_done is not null and coalesce((v_rules->>'expiryBlocks')::boolean, false) and v_done < now() - make_interval(months => v_months) then v_done := null; end if;
  if v_kind = 'refresher' then
    if v_grace is null then return 'ok'; end if;
    if now() < v_grace then return 'ok'; end if;
    return case when v_done is null then 'induction_incomplete' else 'ok' end;
  end if;
  if v_done is null then return 'induction_incomplete'; end if;
  if not public.induction_check_passed(v_pid) then return 'check_not_passed'; end if;
  return 'ok';
end $$;

-- A worker login is inducted (⚑15, the share gate) the moment the ticks and the three-task
-- check are both in. Written here and nowhere else.
create or replace function public.induction_worker_maybe_induct(p_profile_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_cu public.contractor_users%rowtype;
begin
  select * into v_cu from public.contractor_users where profile_id = p_profile_id and role = 'worker' and removed_at is null;
  if not found or v_cu.inducted_at is not null then return false; end if;
  if public.induction_completed_at(p_profile_id) is null or not public.induction_check_passed(p_profile_id) then return false; end if;
  update public.contractor_users set inducted_at = now() where id = v_cu.id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cu.contractor_id, 'worker_inducted', jsonb_build_object('contractor_user_id', v_cu.id, 'name', v_cu.name, 'profile_id', p_profile_id), auth.uid());
  return true;
end $$;

-- ---- 6. the status a screen reads ----------------------------------------------------------
create or replace function public.induction_status_of(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_kind text; v_vid uuid; v_no integer; v_cid uuid; v_done timestamptz; v_lang text; v_tasks text[];
        v_modules jsonb; v_checks jsonb; v_gate text; v_inv timestamptz; v_grace timestamptz; v_ticked integer; v_total integer;
begin
  v_kind := public.induction_kind_of(p_profile_id);
  if v_kind is null then return null; end if;
  v_vid := public.induction_required_version();
  select version_no into v_no from public.induction_versions where id = v_vid;
  select id, induction_language, induction_invited_at, induction_grace_until into v_cid, v_lang, v_inv, v_grace from public.contractors where profile_id = p_profile_id;
  if v_cid is null then select induction_language into v_lang from public.contractor_users where profile_id = p_profile_id and role = 'worker' and removed_at is null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', m.module_key, 'ticked', public.induction_module_ticked(p_profile_id, m.module_key),
                                               'sections', case when m.module_key = 'm05' and v_cid is null
                                                 then (select coalesce(jsonb_agg(section_key), '[]'::jsonb) from public.induction_acks a where a.profile_id = p_profile_id and a.version_id = v_vid and a.module_key = 'm05' and a.section_key <> '')
                                                 else '[]'::jsonb end,
                                               'change_note', (select im.change_note from public.induction_modules im where im.version_id = v_vid and im.module_key = m.module_key))
                            order by m.sort), '[]'::jsonb),
         count(*) filter (where public.induction_module_ticked(p_profile_id, m.module_key)), count(*)
    into v_modules, v_ticked, v_total
    from public.induction_modules_for(v_kind) m;
  v_tasks := public.induction_tasks_for(v_kind);
  select coalesce(jsonb_agg(jsonb_build_object('task', t, 'result', c.result, 'note', c.note, 'checked_at', c.checked_at) order by ord), '[]'::jsonb) into v_checks
    from unnest(v_tasks) with ordinality as u(t, ord)
    left join public.induction_checks c on c.profile_id = p_profile_id and c.version_id = v_vid and c.task_key = u.t;
  v_done := public.induction_completed_at(p_profile_id);
  v_gate := case when v_cid is not null then public.induction_gate_of(v_cid) else null end;
  return jsonb_build_object(
    'kind', v_kind, 'version_no', v_no, 'language', v_lang,
    'modules', v_modules, 'ticked', v_ticked, 'total', v_total,
    'complete', v_done is not null, 'completed_at', v_done,
    'tasks', v_checks, 'check_passed', public.induction_check_passed(p_profile_id),
    'gate', v_gate, 'invited_at', v_inv, 'grace_until', v_grace,
    'inducted_at', (select inducted_at from public.contractor_users where profile_id = p_profile_id and role = 'worker' and removed_at is null));
end $$;

-- A session asks about itself; staff ask about anyone.
create or replace function public.induction_status(p_profile_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := coalesce(p_profile_id, auth.uid());
  if v_pid is null then return null; end if;
  if not (public.is_staff() or v_pid = auth.uid()) then return null; end if;
  return public.induction_status_of(v_pid);
end $$;
revoke all on function public.induction_status(uuid) from public, anon;
grant execute on function public.induction_status(uuid) to authenticated;

-- Every contractor at once, for the staff list and the PC grid.
create or replace function public.induction_statuses()
returns table (contractor_id uuid, profile_id uuid, kind text, ticked integer, total integer, complete boolean, completed_at timestamptz,
               check_passed boolean, gate text, invited_at timestamptz, grace_until timestamptz, language text)
language sql stable security definer set search_path = public as $$
  select c.id, c.profile_id, c.induction_kind,
         (select count(*)::integer from public.induction_modules_for(c.induction_kind) m where public.induction_module_ticked(c.profile_id, m.module_key)),
         (select count(*)::integer from public.induction_modules_for(c.induction_kind)),
         public.induction_completed_at(c.profile_id) is not null,
         public.induction_completed_at(c.profile_id),
         public.induction_check_passed(c.profile_id),
         public.induction_gate_of(c.id),
         c.induction_invited_at, c.induction_grace_until, c.induction_language
    from public.contractors c
   where c.profile_id is not null and (public.is_staff() or auth.role() = 'service_role')
$$;
revoke all on function public.induction_statuses() from public, anon;
grant execute on function public.induction_statuses() to authenticated;

-- ---- 7. the painter ticks a module ----------------------------------------------------------
-- ok:<ticked>/<total> while modules remain, ok:complete on the last. Module 5 takes the section:
-- a contractor is sent through standards_ack_section (one writer for standards_acks); a worker
-- login gets an induction_acks row per section. Completion writes ONE event per version.
create or replace function public.induction_ack_module(p_module_key text, p_section_key text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_kind text; v_vid uuid; v_cid uuid; v_lang text; v_res text; v_done timestamptz; v_ticked integer; v_total integer; v_cu_id uuid;
begin
  v_pid := auth.uid();
  if v_pid is null then return 'error:not_signed_in'; end if;
  v_kind := public.induction_kind_of(v_pid);
  if v_kind is null then return 'error:not_a_painter'; end if;
  v_vid := public.induction_required_version();
  if v_vid is null then return 'error:no_version'; end if;
  if not exists (select 1 from public.induction_modules_for(v_kind) m where m.module_key = p_module_key) then return 'error:bad_module'; end if;
  select id, induction_language into v_cid, v_lang from public.contractors where profile_id = v_pid;
  if v_cid is null then select id, induction_language into v_cu_id, v_lang from public.contractor_users where profile_id = v_pid and role = 'worker' and removed_at is null; end if;

  if p_module_key = 'm05' then
    if coalesce(p_section_key, '') = '' then return 'error:section_required'; end if;
    if p_section_key not in ('levels','rules','time','interior','exterior','defect') then return 'error:bad_section'; end if;
    if v_cid is not null then
      v_res := public.standards_ack_section(p_section_key);
      if v_res not like 'ok:%' then return v_res; end if;
    else
      insert into public.induction_acks (profile_id, version_id, module_key, section_key, language)
        values (v_pid, v_vid, 'm05', p_section_key, coalesce(v_lang, 'en'))
        on conflict (profile_id, version_id, module_key, section_key) do nothing;
    end if;
  else
    insert into public.induction_acks (profile_id, version_id, module_key, section_key, language)
      values (v_pid, v_vid, p_module_key, '', coalesce(v_lang, 'en'))
      on conflict (profile_id, version_id, module_key, section_key) do nothing;
  end if;

  select count(*) filter (where public.induction_module_ticked(v_pid, m.module_key)), count(*) into v_ticked, v_total from public.induction_modules_for(v_kind) m;
  v_done := public.induction_completed_at(v_pid);
  if v_done is not null then
    if v_cid is not null then
      if not exists (select 1 from public.contractor_events where contractor_id = v_cid and type = 'induction_completed' and (detail->>'version_id')::uuid = v_vid) then
        insert into public.contractor_events (contractor_id, type, detail, actor)
          values (v_cid, 'induction_completed', jsonb_build_object('version_id', v_vid, 'kind', v_kind, 'language', coalesce(v_lang, 'en'), 'profile_id', v_pid), v_pid);
      end if;
    elsif v_cu_id is not null then
      if not exists (select 1 from public.contractor_events e join public.contractor_users cu on cu.id = v_cu_id
                      where e.contractor_id = cu.contractor_id and e.type = 'induction_completed' and e.detail->>'profile_id' = v_pid::text and (e.detail->>'version_id')::uuid = v_vid) then
        insert into public.contractor_events (contractor_id, type, detail, actor)
          select cu.contractor_id, 'induction_completed', jsonb_build_object('version_id', v_vid, 'kind', 'worker', 'language', coalesce(v_lang, 'en'), 'profile_id', v_pid, 'contractor_user_id', cu.id, 'name', cu.name), v_pid
            from public.contractor_users cu where cu.id = v_cu_id;
      end if;
      perform public.induction_worker_maybe_induct(v_pid);
    end if;
    return 'ok:complete';
  end if;
  return 'ok:' || v_ticked || '/' || v_total;
end $$;
revoke all on function public.induction_ack_module(text, text) from public, anon;
grant execute on function public.induction_ack_module(text, text) to authenticated;

-- ---- 8. the facilitator records the practical check (⚑5) -------------------------------------
create or replace function public.induction_check_record(p_profile_id uuid, p_task_key text, p_result text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_kind text; v_vid uuid; v_cid uuid; v_cu_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_result not in ('pass', 'not_yet') then return 'error:bad_result'; end if;
  v_kind := public.induction_kind_of(p_profile_id);
  if v_kind is null then return 'error:not_a_painter'; end if;
  if v_kind = 'refresher' then return 'error:no_check_for_refresher'; end if;
  if not (p_task_key = any (public.induction_tasks_for(v_kind))) then return 'error:bad_task'; end if;
  v_vid := public.induction_required_version();
  if v_vid is null then return 'error:no_version'; end if;
  insert into public.induction_checks (profile_id, version_id, task_key, result, note, checked_by, checked_at)
    values (p_profile_id, v_vid, p_task_key, p_result, left(coalesce(p_note, ''), 400), auth.uid(), now())
    on conflict (profile_id, version_id, task_key) do update set result = excluded.result, note = excluded.note, checked_by = excluded.checked_by, checked_at = now();
  if public.induction_check_passed(p_profile_id) then
    select id into v_cid from public.contractors where profile_id = p_profile_id;
    if v_cid is not null then
      if not exists (select 1 from public.contractor_events where contractor_id = v_cid and type = 'induction_check_passed' and (detail->>'version_id')::uuid = v_vid) then
        insert into public.contractor_events (contractor_id, type, detail, actor)
          values (v_cid, 'induction_check_passed', jsonb_build_object('version_id', v_vid, 'profile_id', p_profile_id), auth.uid());
      end if;
    else
      select id into v_cu_id from public.contractor_users where profile_id = p_profile_id and role = 'worker' and removed_at is null;
      perform public.induction_worker_maybe_induct(p_profile_id);
    end if;
    return 'ok:passed';
  end if;
  return 'ok:' || p_result;
end $$;
revoke all on function public.induction_check_record(uuid, text, text, text) from public, anon;
grant execute on function public.induction_check_record(uuid, text, text, text) to authenticated;

-- ---- 9. the office invites an existing painter to the refresher (same grace as the standards)
create or replace function public.induction_invite(p_contractor_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_grace timestamptz; v_days integer; v_pid uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select profile_id into v_pid from public.contractors where id = p_contractor_id;
  if v_pid is null then return 'error:not_found'; end if;
  if public.induction_completed_at(v_pid) is not null then return 'error:already_complete'; end if;
  v_days := public.standards_grace_days();
  v_grace := now() + make_interval(days => v_days);
  update public.contractors set induction_invited_at = now(), induction_grace_until = v_grace where id = p_contractor_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'induction_invited', jsonb_build_object('grace_until', v_grace, 'grace_days', v_days, 'kind', (select induction_kind from public.contractors where id = p_contractor_id)), auth.uid());
  return 'ok:' || v_grace::text;
end $$;
revoke all on function public.induction_invite(uuid) from public, anon;
grant execute on function public.induction_invite(uuid) to authenticated;

-- Staff set the kind by hand when the rule of thumb is wrong (a returning painter, a new one who sat the full day).
create or replace function public.induction_set_kind(p_contractor_id uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('full', 'refresher') then return 'error:bad_kind'; end if;
  update public.contractors set induction_kind = p_kind where id = p_contractor_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:' || p_kind;
end $$;
revoke all on function public.induction_set_kind(uuid, text) from public, anon;
grant execute on function public.induction_set_kind(uuid, text) to authenticated;

-- ---- 10. a material change: publish a version, carry every untouched tick forward (§5) ------
-- The seed loads the new version rows (unpublished when its file carries no approval date);
-- THIS publishes it. Ticks and checks on the previous version are copied to the new one for
-- every module NOT named in p_changed_modules, so a painter re-ticks exactly those, and the
-- note sits on them so it is read first.
create or replace function public.induction_publish_version(p_version_no integer, p_changed_modules text[] default '{}', p_change_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_old uuid; v_n integer := 0;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select id into v_new from public.induction_versions where version_kind = 'full' and version_no = p_version_no;
  if v_new is null then return 'error:not_found'; end if;
  select id into v_old from public.induction_versions where version_kind = 'full' and published_at is not null and version_no < p_version_no order by version_no desc limit 1;
  update public.induction_versions set published_at = coalesce(published_at, current_date), is_material = coalesce(array_length(p_changed_modules, 1), 0) > 0, change_note = coalesce(p_change_note, '') where id = v_new;
  update public.induction_modules set change_note = case when module_key = any (p_changed_modules) then coalesce(p_change_note, '') else '' end where version_id = v_new;
  if v_old is not null then
    insert into public.induction_acks (profile_id, version_id, module_key, section_key, language, acked_at)
      select a.profile_id, v_new, a.module_key, a.section_key, a.language, a.acked_at
        from public.induction_acks a
       where a.version_id = v_old and not (a.module_key = any (p_changed_modules))
         and exists (select 1 from public.induction_modules m where m.version_id = v_new and m.module_key = a.module_key)
      on conflict (profile_id, version_id, module_key, section_key) do nothing;
    get diagnostics v_n = row_count;
    insert into public.induction_checks (profile_id, version_id, task_key, result, note, checked_by, checked_at)
      select c.profile_id, v_new, c.task_key, c.result, c.note, c.checked_by, c.checked_at from public.induction_checks c where c.version_id = v_old
      on conflict (profile_id, version_id, task_key) do nothing;
  end if;
  return 'ok:' || v_n;
end $$;
revoke all on function public.induction_publish_version(integer, text[], text) from public, anon;
grant execute on function public.induction_publish_version(integer, text[], text) to authenticated;

-- ---- 11. the offers gate (⚑1): send_offer and the trigger, 20270230 bodies plus one line --
create or replace function public.send_offer(
  p_work_order_id uuid, p_contractor_id uuid, p_start date, p_end date default null, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype; v_active boolean; v_offerable boolean; v_hours numeric;
  v_offer_id uuid; v_base integer; v_pay integer; v_gate text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null then return 'error:no_start_date'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:work_order_not_found'; end if;
  if v_wo.issued_at is null then return 'error:not_issued'; end if;
  select active into v_active from public.contractors where id = p_contractor_id;
  if v_active is null then return 'error:contractor_not_found'; end if;
  if not v_active then return 'error:contractor_suspended'; end if;
  perform public.contractor_recompute_offerable(p_contractor_id);
  select offerable into v_offerable from public.contractors where id = p_contractor_id;
  if not coalesce(v_offerable, false) then return 'error:not_offerable'; end if;
  if public.standards_status_of(p_contractor_id) = 'blocked' then return 'error:standards_not_signed'; end if;
  -- Induction Step 5 (⚑1): no offer before the induction is complete and the check passed.
  v_gate := public.induction_gate_of(p_contractor_id);
  if v_gate <> 'ok' then return 'error:' || v_gate; end if;
  -- R12 / ⚑8: a Red painter gets no new offer until the owner has cleared them.
  if public.painter_offers_blocked(p_contractor_id) then return 'error:red_no_clearance'; end if;
  if exists (select 1 from public.booking_offers where work_order_id = p_work_order_id and state in ('offered', 'proposed')) then
    return 'conflict:already_offered';
  end if;
  select coalesce(sum((s->>'hours')::numeric), 0) into v_hours
    from jsonb_array_elements(coalesce(v_wo.wo_snapshot->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s;
  v_base := public.wo_base_pay_cents(v_wo);
  v_pay := case when v_base is null then null else greatest(0, v_base + public.wo_contractor_variations_cents(v_wo.id)) end;
  insert into public.booking_offers (work_order_id, contractor_id, start_date, end_date, hours_allowance, payment_cents, staff_note, expires_at)
  values (p_work_order_id, p_contractor_id, p_start, p_end, nullif(v_hours, 0), v_pay, coalesce(p_note, ''), now() + interval '24 hours')
  returning id into v_offer_id;
  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id, 'payment_cents', v_pay, 'base_payment_cents', v_base, 'start', p_start),
            auth.uid());
  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

create or replace function public.booking_offers_standards_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_gate text;
begin
  if new.is_demo then return new; end if;
  if new.state = 'offered' and public.standards_status_of(new.contractor_id) = 'blocked' then
    raise exception 'standards_not_signed' using hint = 'This painter has not confirmed the finish standards and their grace period has ended.';
  end if;
  if new.state = 'offered' then
    v_gate := public.induction_gate_of(new.contractor_id);
    if v_gate <> 'ok' then
      raise exception '%', v_gate using hint = 'This painter has not completed the induction, or the practical check has not been passed. No job offers until both are in.';
    end if;
  end if;
  if new.state = 'offered' and public.painter_offers_blocked(new.contractor_id) then
    raise exception 'red_no_clearance' using hint = 'This painter is on Red. The owner records Spoken with, offers allowed before any new offer.';
  end if;
  return new;
end $$;
drop trigger if exists t_booking_offers_standards_gate on public.booking_offers;
create trigger t_booking_offers_standards_gate before insert on public.booking_offers for each row execute function public.booking_offers_standards_gate();

-- ---- 12. read-back: compare each column to its _expect_ twin before calling this live ----
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('induction_acks','induction_checks')) as tables, 2 as _expect_tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('induction_acks','induction_checks')) as policies, 4 as _expect_policies,
  has_table_privilege('authenticated', 'public.induction_acks', 'insert') as auth_can_insert, false as _expect_auth_can_insert,
  (select count(*) from information_schema.columns where table_name = 'contractors' and column_name in ('induction_kind','induction_invited_at','induction_grace_until')) as contractor_columns, 3 as _expect_contractor_columns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('induction_required_version','induction_kind_of','induction_modules_for','induction_tasks_for','induction_module_ticked','induction_completed_at',
                       'induction_check_passed','induction_gate_of','induction_worker_maybe_induct','induction_status_of','induction_status','induction_statuses',
                       'induction_ack_module','induction_check_record','induction_invite','induction_set_kind','induction_publish_version')) as functions, 17 as _expect_functions,
  has_function_privilege('authenticated', 'public.induction_ack_module(text, text)', 'execute') as painter_can_ack, true as _expect_painter_can_ack,
  has_function_privilege('authenticated', 'public.induction_gate_of(uuid)', 'execute') as gate_callable_by_session, false as _expect_gate_callable_by_session,
  (select position('induction_gate_of' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_offer') as send_offer_gated, true as _expect_send_offer_gated,
  (select position('induction_gate_of' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'booking_offers_standards_gate') as trigger_gated, true as _expect_trigger_gated,
  (select (value->>'inductionGate')::boolean from public.settings where key = 'worker_rules') as worker_gate_on, true as _expect_worker_gate_on,
  (select (value->>'offerGate')::boolean from public.settings where key = 'induction_rules') as offer_gate_on, true as _expect_offer_gate_on,
  (select count(*) from public.contractors where induction_kind = 'full') as full_kind_contractors, 0 as _expect_full_kind_contractors_on_first_run,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'contractor_doc_kind' and e.enumlabel = 'induction') as doc_kind, true as _expect_doc_kind;

insert into public._prod_migrations(name) values ('20270270000000_induction_signoff.sql') on conflict (name) do nothing;

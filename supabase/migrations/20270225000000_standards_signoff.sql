-- =============================================================================
-- 20270225 · Finish standards sign-off and the offers gate (brief: standards /
-- status / call backs, Step 2; rulings S4–S8, ⚑1, ⚑2, ⚑17, ⚑18)
--
-- Every painter with a login confirms the standards once, six sections, one
-- tick each, no typed name. The ticks are rows (standards_acks: one per
-- painter, version, section — six rows = confirmed), written only by the RPC
-- below. A painter who has not confirmed the current required version cannot
-- be OFFERED work once their grace period has run out; the rule lives in
-- send_offer AND as a trigger on booking_offers, so no path around the RPC
-- exists. Employed painters are never offered work, so for them it is a
-- reminder and a PC card only (⚑2).
--
-- Who is required when:
--   · a NEW painter (redeem_contractor_invite) is invited the moment they join
--     with NO grace — sign-off is part of onboarding (brief Step 2);
--   · an EXISTING painter is invited by the office (standards_invite) and gets
--     settings.standards_rules.graceDays (default 7, ⚑1) before offers stop;
--   · a new MATERIAL version (standards_publish_version) re-invites everyone
--     not confirmed on it, same grace (⚑18). Wording-only versions
--     (is_material = false) require nothing new (ruling S7).
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. columns and the ack table ---------------------------------------------
-- Both RPC-written: contractors UPDATE is a column allow-list (20260824), and
-- these two deliberately stay off it.
alter table public.contractors add column if not exists standards_invited_at timestamptz;
alter table public.contractors add column if not exists standards_grace_until timestamptz;

create table if not exists public.standards_acks (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  version_id    uuid not null references public.standards_versions (id) on delete cascade,
  section_key   text not null check (section_key in ('levels','rules','time','interior','exterior','defect')),
  acked_at      timestamptz not null default now(),
  unique (contractor_id, version_id, section_key)
);
create index if not exists standards_acks_contractor_idx on public.standards_acks (contractor_id, version_id);

alter table public.standards_acks enable row level security;
drop policy if exists standards_acks_staff_read on public.standards_acks;
create policy standards_acks_staff_read on public.standards_acks
  for select to authenticated using (public.is_staff());
drop policy if exists standards_acks_own_read on public.standards_acks;
create policy standards_acks_own_read on public.standards_acks
  for select to authenticated using (contractor_id = public.current_contractor_id());
revoke all on public.standards_acks from anon;
revoke insert, update, delete on public.standards_acks from authenticated;
grant select on public.standards_acks to authenticated;

-- The PDF copy a confirmation leaves in the painter's documents (ruling S8).
alter type public.contractor_doc_kind add value if not exists 'standards';

-- ---- 2. the numbers (⚑1, ⚑17) --------------------------------------------------
insert into public.settings (key, value) values ('standards_rules', jsonb_build_object(
  'graceDays', 7,
  'reminderDays', jsonb_build_array(2, 4, 6),
  'reminderHour', 9,
  'pcCardDay', 7
)) on conflict (key) do nothing;

create or replace function public.standards_grace_days()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'graceDays')::integer from public.settings where key = 'standards_rules'), 7);
$$;

-- ---- 3. who has confirmed what ----------------------------------------------
-- The version everyone must have confirmed: the newest PUBLISHED, MATERIAL one.
create or replace function public.standards_required_no()
returns integer language sql stable security definer set search_path = public as $$
  select max(version_no) from public.standards_versions where published_at is not null and is_material;
$$;

-- The newest version this painter has all six sections on, or null.
create or replace function public.standards_confirmed_no(p_contractor_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select max(v.version_no)
    from public.standards_versions v
   where (select count(distinct a.section_key) from public.standards_acks a
           where a.contractor_id = p_contractor_id and a.version_id = v.id) >= 6;
$$;

-- The one rule, unrestricted (callers below gate who may ask). Mirrored in
-- TypeScript by lib/standards/acks.ts standardsStatusOf, which a test pins.
create or replace function public.standards_status_of(p_contractor_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_req integer; v_conf integer; v_type text; v_grace timestamptz;
begin
  v_req := public.standards_required_no();
  if v_req is null then return 'not_required'; end if;
  v_conf := public.standards_confirmed_no(p_contractor_id);
  if v_conf is not null and v_conf >= v_req then return 'confirmed'; end if;
  select employment_type, standards_grace_until into v_type, v_grace from public.contractors where id = p_contractor_id;
  if v_type is null then return 'not_required'; end if;
  if v_type = 'employee' then return 'employee_unsigned'; end if;
  if v_grace is null then return 'not_invited'; end if;
  if now() < v_grace then return 'grace'; end if;
  return 'blocked';
end $$;

-- A session asks about itself, or staff ask about anyone.
create or replace function public.standards_status(p_contractor_id uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := coalesce(p_contractor_id, public.current_contractor_id());
  if v_cid is null then return null; end if;
  if not (public.is_staff() or v_cid = public.current_contractor_id()) then return null; end if;
  return public.standards_status_of(v_cid);
end $$;
revoke all on function public.standards_status(uuid) from public, anon;
grant execute on function public.standards_status(uuid) to authenticated;

-- Every painter at once, for the staff list, the board and the PC queue.
create or replace function public.standards_statuses()
returns table (
  contractor_id uuid, status text, confirmed_version integer, confirmed_at timestamptz,
  invited_at timestamptz, grace_until timestamptz, acked_sections integer
) language sql stable security definer set search_path = public as $$
  select c.id,
         public.standards_status_of(c.id),
         public.standards_confirmed_no(c.id),
         (select max(a.acked_at) from public.standards_acks a join public.standards_versions v on v.id = a.version_id
           where a.contractor_id = c.id and v.version_no = public.standards_confirmed_no(c.id)),
         c.standards_invited_at,
         c.standards_grace_until,
         (select count(distinct a.section_key)::integer from public.standards_acks a join public.standards_versions v on v.id = a.version_id
           where a.contractor_id = c.id and v.version_no = public.standards_required_no())
    from public.contractors c
   -- Staff, and the service role (the reminder sweep runs as it).
   where public.is_staff() or auth.role() = 'service_role';
$$;
revoke all on function public.standards_statuses() from public, anon;
grant execute on function public.standards_statuses() to authenticated;

-- ---- 4. the painter ticks a section --------------------------------------------
create or replace function public.standards_ack_section(p_section text)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_req integer; v_vid uuid; v_n integer;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_painter'; end if;
  if p_section not in ('levels','rules','time','interior','exterior','defect') then return 'error:bad_section'; end if;
  v_req := public.standards_required_no();
  if v_req is null then return 'error:no_version'; end if;
  select id into v_vid from public.standards_versions where version_no = v_req;

  insert into public.standards_acks (contractor_id, version_id, section_key)
  values (v_cid, v_vid, p_section)
  on conflict (contractor_id, version_id, section_key) do nothing;

  select count(distinct section_key) into v_n from public.standards_acks where contractor_id = v_cid and version_id = v_vid;
  if v_n >= 6 then
    -- Confirmed: once on the record per version (ruling S7: who, when, which version).
    if not exists (select 1 from public.contractor_events
                    where contractor_id = v_cid and type = 'standards_confirmed'
                      and (detail->>'version_no')::integer = v_req) then
      insert into public.contractor_events (contractor_id, type, detail, actor)
        values (v_cid, 'standards_confirmed', jsonb_build_object('version_no', v_req, 'version_id', v_vid), auth.uid());
    end if;
    return 'ok:confirmed';
  end if;
  return 'ok:' || v_n;
end $$;
revoke all on function public.standards_ack_section(text) from public, anon;
grant execute on function public.standards_ack_section(text) to authenticated;

-- ---- 5. the office invites an existing painter (message 1) --------------------
create or replace function public.standards_invite(p_contractor_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_grace timestamptz; v_days integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then return 'error:not_found'; end if;
  if public.standards_status_of(p_contractor_id) = 'confirmed' then return 'error:already_confirmed'; end if;
  v_days := public.standards_grace_days();
  v_grace := now() + make_interval(days => v_days);
  update public.contractors
     set standards_invited_at = now(), standards_grace_until = v_grace
   where id = p_contractor_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'standards_invited',
            jsonb_build_object('grace_until', v_grace, 'grace_days', v_days, 'version_no', public.standards_required_no()),
            auth.uid());
  return 'ok:' || v_grace::text;
end $$;
revoke all on function public.standards_invite(uuid) from public, anon;
grant execute on function public.standards_invite(uuid) to authenticated;

-- ---- 6. a new version goes live (⚑18) ------------------------------------------
-- The seed script loads the rows; THIS publishes. A material version re-invites
-- everyone not yet confirmed on it, with the same grace; a wording fix does not.
create or replace function public.standards_publish_version(p_version_no integer)
returns text language plpgsql security definer set search_path = public as $$
declare v public.standards_versions%rowtype; v_days integer; v_n integer := 0;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.standards_versions where version_no = p_version_no;
  if not found then return 'error:not_found'; end if;
  update public.standards_versions set published_at = coalesce(published_at, current_date) where id = v.id;
  if v.is_material then
    v_days := public.standards_grace_days();
    with due as (
      update public.contractors c
         set standards_invited_at = now(), standards_grace_until = now() + make_interval(days => v_days)
       where c.active and coalesce(public.standards_confirmed_no(c.id), 0) < p_version_no
       returning c.id
    )
    insert into public.contractor_events (contractor_id, type, detail, actor)
      select id, 'standards_new_version', jsonb_build_object('version_no', p_version_no, 'change_note', v.change_note), auth.uid() from due;
    get diagnostics v_n = row_count;
  end if;
  return 'ok:' || v_n;
end $$;
revoke all on function public.standards_publish_version(integer) from public, anon;
grant execute on function public.standards_publish_version(integer) to authenticated;

-- ---- 7. a new painter is invited the moment they join, with no grace -------------
-- 20270161 body verbatim, plus the two standards columns on the INSERT only.
create or replace function public.redeem_contractor_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_invites%rowtype; v_uid uuid; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then return 'error:not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v from public.contractor_invites where token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v.revoked_at is not null then return 'error:revoked'; end if;
  if v.accepted_at is not null then return 'error:used'; end if;
  if v.expires_at < now() then return 'error:expired'; end if;

  -- The link is tied to the person it was sent to. Forwarding it doesn't work.
  if lower(v_email) <> lower(v.email) then return 'error:email_mismatch'; end if;

  update public.profiles
     set role = 'contractor', name = coalesce(nullif(v.name, ''), name)
   where id = v_uid;

  insert into public.contractors (profile_id, company_name, tier, active, employment_type, standards_invited_at, standards_grace_until)
  values (v_uid, coalesce(v.company_name, ''), v.tier, true, coalesce(v.employment_type, 'contractor'), now(), now())
  on conflict (profile_id) do update
    set company_name = coalesce(nullif(excluded.company_name, ''), public.contractors.company_name),
        tier = coalesce(excluded.tier, public.contractors.tier),
        active = true,
        employment_type = excluded.employment_type;

  update public.contractor_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v.id;

  return 'ok';
end $$;
grant execute on function public.redeem_contractor_invite(text) to authenticated;

-- ---- 8. the offers gate (§6 rule 2) ----------------------------------------------
-- 20270208 body verbatim, plus the standards check after the compliance one.
create or replace function public.send_offer(
  p_work_order_id uuid,
  p_contractor_id uuid,
  p_start date,
  p_end date default null,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_active boolean;
  v_offerable boolean;
  v_hours numeric;
  v_offer_id uuid;
  v_base integer;
  v_pay integer;
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

  -- Ruling S6: no job offers until the finish standards are confirmed (after
  -- the grace period for painters who were here before the standards).
  if public.standards_status_of(p_contractor_id) = 'blocked' then return 'error:standards_not_signed'; end if;

  if exists (
    select 1 from public.booking_offers
     where work_order_id = p_work_order_id and state in ('offered', 'proposed')
  ) then
    return 'conflict:already_offered';
  end if;

  -- Hours allowance comes from the frozen work-order document, not the caller.
  select coalesce(sum((s->>'hours')::numeric), 0) into v_hours
    from jsonb_array_elements(coalesce(v_wo.wo_snapshot->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s;

  -- Server-side truth, never the client's number: the job's base pay (column,
  -- else the frozen document — 20270208) plus what the customer has already
  -- signed and nobody was on the job to accept.
  v_base := public.wo_base_pay_cents(v_wo);
  v_pay := case when v_base is null then null
                else greatest(0, v_base + public.wo_contractor_variations_cents(v_wo.id)) end;

  insert into public.booking_offers (
    work_order_id, contractor_id, start_date, end_date,
    hours_allowance, payment_cents, staff_note, expires_at
  ) values (
    p_work_order_id, p_contractor_id, p_start, p_end,
    nullif(v_hours, 0),
    v_pay,
    coalesce(p_note, ''),
    now() + interval '24 hours'
  ) returning id into v_offer_id;

  update public.work_orders set contractor_id = p_contractor_id where id = p_work_order_id;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (p_contractor_id, 'offer_sent',
            jsonb_build_object('work_order_id', p_work_order_id, 'offer_id', v_offer_id,
                               'payment_cents', v_pay, 'base_payment_cents', v_base,
                               'start', p_start),
            auth.uid());

  return 'ok:offered';
end $$;
grant execute on function public.send_offer(uuid, uuid, date, date, text) to authenticated;

-- The database is the last line of defence: ANY new offer to a blocked painter
-- is refused, whichever function wrote it (reassign, re-offer, a future path).
create or replace function public.booking_offers_standards_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'offered' and public.standards_status_of(new.contractor_id) = 'blocked' then
    raise exception 'standards_not_signed' using hint = 'This painter has not confirmed the finish standards and their grace period has ended.';
  end if;
  return new;
end $$;
drop trigger if exists t_booking_offers_standards_gate on public.booking_offers;
create trigger t_booking_offers_standards_gate
  before insert on public.booking_offers
  for each row execute function public.booking_offers_standards_gate();

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contractors'
     and column_name in ('standards_invited_at', 'standards_grace_until'))                 as new_columns,     2 as _expect_columns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'standards_acks') as ack_policies,   2 as _expect_policies,
  has_table_privilege('authenticated', 'public.standards_acks', 'insert')                    as auth_can_insert, false as _expect_no_insert,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('standards_status_of','standards_status','standards_statuses','standards_ack_section',
                       'standards_invite','standards_publish_version','booking_offers_standards_gate'))  as functions,     7 as _expect_functions,
  has_function_privilege('authenticated', 'public.standards_ack_section(text)', 'execute')   as painter_can_ack,  true as _expect_ack_grant,
  (select count(*) from pg_trigger where tgname = 't_booking_offers_standards_gate')         as gate_trigger,    1 as _expect_trigger,
  (select position('standards_not_signed' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'send_offer')                                as send_offer_gated, true as _expect_gated,
  (select position('standards_invited_at' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'redeem_contractor_invite')                  as join_invites,     true as _expect_join,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'contractor_doc_kind' and e.enumlabel = 'standards') as doc_kind, true as _expect_doc_kind,
  (select value->>'graceDays' from public.settings where key = 'standards_rules')            as grace_days,      '7' as _expect_grace;

insert into public._prod_migrations(name) values ('20270225000000_standards_signoff.sql') on conflict (name) do nothing;

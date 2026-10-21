-- 20270285 · Signed subcontractor agreements: contractor_agreements, the RPCs, the gate
--
-- Contractor-agreement brief (21 Oct 2026), Step 2. One signed row per contractor at a
-- time, written only by three RPCs: agreement_sign (the contractor, on their phone),
-- agreement_upload (staff, a scanned paper copy) and agreement_attach_pdf (the server,
-- once). A new signature supersedes the last; nothing else updates a signed row.
-- The merge snapshot (every value the document printed) and the audit trail (name,
-- time, IP, user agent, hash of the rendered HTML) live on the row. The company side
-- is countersigned in the same transaction (ruling 2). The gate, agreement_gate_of,
-- is a definer helper with no grant, read by send_offer and the booking_offers
-- trigger from Step 6 and mirrored word for word by lib/agreements/status.ts.
--   · contractors.agreement_kind: new (signs before any offer) or existing (on the
--     books before this ran; offers flow until Request signature starts a grace window,
--     settings.agreement_rules.graceDays, ruling 14 pending).
--   · contractors.agreement_requested_at is the Commencement Date for an existing
--     contractor (ruling 5); a new contractor takes the date of the invite they accepted.
--   · contractor_doc_kind gains agreement so the signed PDF sits with the insurance;
--     contractor_documents.contractor_agreement_id ties the card to the row.
-- Converges on a re-run. No quotes in comments. The enum value is added here and used
-- only inside function bodies, so one transaction is safe.

set lock_timeout = '15s';

-- ---- 1. the enum value and the columns ----------------------------------------------------
alter type public.contractor_doc_kind add value if not exists 'agreement';

alter table public.contractors add column if not exists agreement_kind text not null default 'new';
alter table public.contractors drop constraint if exists contractors_agreement_kind_check;
alter table public.contractors add constraint contractors_agreement_kind_check check (agreement_kind in ('new', 'existing'));
alter table public.contractors add column if not exists agreement_requested_at timestamptz;
alter table public.contractors add column if not exists agreement_grace_until timestamptz;

-- Everyone on the books before this ran is an existing contractor (ruling 14): offers keep
-- flowing until the office asks them to sign. Only once, so a re-run changes nobody.
update public.contractors set agreement_kind = 'existing'
 where not exists (select 1 from public.settings where key = 'agreement_rules');

insert into public.settings (key, value) values ('agreement_rules', jsonb_build_object(
  'offerGate', true, 'graceDays', 14, 'renewalWarnDays', 30, 'termMonths', 12,
  'signatoryName', 'Tom Roman', 'signatoryTitle', 'Director'))
on conflict (key) do nothing;

-- ---- 2. the table --------------------------------------------------------------------------
create table if not exists public.contractor_agreements (
  id                  uuid primary key default gen_random_uuid(),
  contractor_id       uuid not null references public.contractors (id) on delete cascade,
  version             integer references public.agreement_versions (version) on delete restrict,
  source              text not null check (source in ('portal', 'uploaded')),
  status              text not null default 'signed' check (status in ('draft', 'signed', 'superseded', 'void')),
  merged              jsonb not null default '{}'::jsonb check (jsonb_typeof(merged) = 'object'),
  signed_name         text not null default '',
  signature           text,
  signed_at           timestamptz not null default now(),
  signed_ip           inet,
  signed_user_agent   text not null default '',
  body_sha256         text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  countersigned_name  text,
  countersigned_at    timestamptz,
  pdf_path            text,
  commencement_on     date,
  expires_on          date,
  uploaded_by         uuid references auth.users (id) on delete set null,
  uploaded_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint contractor_agreements_portal_has_version check (source <> 'portal' or version is not null),
  constraint contractor_agreements_portal_is_signed check (source <> 'portal' or status = 'draft' or (length(signed_name) > 0 and signature is not null and body_sha256 is not null)),
  constraint contractor_agreements_uploaded_has_pdf check (source <> 'uploaded' or pdf_path is not null),
  unique (contractor_id, version, signed_at)
);
create index if not exists contractor_agreements_cid_idx on public.contractor_agreements (contractor_id, signed_at desc);
create unique index if not exists contractor_agreements_one_signed on public.contractor_agreements (contractor_id) where status = 'signed';

comment on table public.contractor_agreements is
  'A signed subcontractor agreement: one status=signed row per contractor, written only by agreement_sign / agreement_upload / agreement_attach_pdf. merged is the snapshot of every merge field at signing; signed_ip, signed_user_agent and body_sha256 are the audit trail.';

alter table public.contractor_documents add column if not exists contractor_agreement_id uuid references public.contractor_agreements (id) on delete set null;
create index if not exists contractor_documents_agreement_idx on public.contractor_documents (contractor_agreement_id) where contractor_agreement_id is not null;

-- ---- 3. RLS: a contractor reads their own rows, staff read all, nobody writes by hand ------
alter table public.contractor_agreements enable row level security;

drop policy if exists contractor_agreements_read on public.contractor_agreements;
create policy contractor_agreements_read on public.contractor_agreements
  for select to authenticated
  using (public.is_staff() or contractor_id = public.current_contractor_id());

revoke all on public.contractor_agreements from anon;
revoke insert, update, delete on public.contractor_agreements from authenticated;
grant select on public.contractor_agreements to authenticated;

-- ---- 4. helpers (definer, no grants: the RPCs and the gate call them) ----------------------
create or replace function public.agreement_rules()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.settings where key = 'agreement_rules'), '{}'::jsonb)
$$;

create or replace function public.agreement_melbourne_date(p_at timestamptz)
returns date language sql immutable as $$
  select (p_at at time zone 'Australia/Melbourne')::date
$$;

-- Schedule D for the NEXT signature: the Request signature date for an existing contractor
-- (ruling 5), else the date of the invite they accepted, else the day their record was made.
create or replace function public.agreement_commencement_of(p_contractor_id uuid)
returns date language sql stable security definer set search_path = public as $$
  select coalesce(
    public.agreement_melbourne_date(c.agreement_requested_at),
    (select public.agreement_melbourne_date(i.created_at) from public.contractor_invites i
      where i.accepted_by = c.profile_id order by i.accepted_at desc nulls last limit 1),
    public.agreement_melbourne_date(c.created_at))
  from public.contractors c where c.id = p_contractor_id
$$;

-- Schedule D and M for the NEXT signature: a renewal runs on from the last expiry (clause 2.3),
-- a lapsed one starts today, a first one starts on the commencement date above.
create or replace function public.agreement_next_term_of(p_contractor_id uuid, out commencement_on date, out expires_on date)
language plpgsql stable security definer set search_path = public as $$
declare v_prev date; v_found boolean; v_today date; v_months integer;
begin
  v_today := public.agreement_melbourne_date(now());
  v_months := coalesce((public.agreement_rules()->>'termMonths')::integer, 12);
  select true, a.expires_on into v_found, v_prev from public.contractor_agreements a where a.contractor_id = p_contractor_id and a.status = 'signed';
  if coalesce(v_found, false) then
    commencement_on := case when v_prev is not null and v_prev >= v_today then v_prev else v_today end;
  else
    commencement_on := public.agreement_commencement_of(p_contractor_id);
  end if;
  expires_on := commencement_on + make_interval(months => v_months);
end $$;

-- The one word the offer gate reads: ok, agreement_unsigned or agreement_expired.
-- Mirrored word for word by agreementGateOf in lib/agreements/status.ts (test-pinned).
create or replace function public.agreement_gate_of(p_contractor_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid; v_kind text; v_grace timestamptz; v_rules jsonb; v_exp date; v_signed boolean;
begin
  select profile_id, agreement_kind, agreement_grace_until into v_pid, v_kind, v_grace from public.contractors where id = p_contractor_id;
  if v_pid is null then return 'ok'; end if;
  v_rules := public.agreement_rules();
  if not coalesce((v_rules->>'offerGate')::boolean, true) then return 'ok'; end if;
  if public.agreement_current_version() is null then return 'ok'; end if;
  select true, expires_on into v_signed, v_exp from public.contractor_agreements where contractor_id = p_contractor_id and status = 'signed';
  if coalesce(v_signed, false) then
    if v_exp is null or v_exp >= public.agreement_melbourne_date(now()) then return 'ok'; end if;
    return 'agreement_expired';
  end if;
  if v_kind = 'existing' then
    if v_grace is null then return 'ok'; end if;
    if now() < v_grace then return 'ok'; end if;
  end if;
  return 'agreement_unsigned';
end $$;

-- ---- 5. the contractor signs ---------------------------------------------------------------
-- Idempotent per (contractor, version): a second tap finds the signed, unexpired row and
-- returns it. A renewal (the signed row has expired, or is inside the renewal window) makes a
-- new row and marks the old one superseded. The company countersigns in the same transaction.
create or replace function public.agreement_sign(p_version integer, p_signed_name text, p_signature_path text, p_ip text, p_user_agent text, p_body_sha256 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_c public.contractors%rowtype; v_cur integer; v_prev public.contractor_agreements%rowtype;
        v_missing text[] := '{}'; v_rules jsonb; v_comm date; v_exp date; v_signed_on date; v_warn integer;
        v_merged jsonb; v_id uuid; v_abn text; v_name text; v_ip inet;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return jsonb_build_object('status', 'error', 'reason', 'not_contractor'); end if;
  select * into v_c from public.contractors where id = v_cid;
  v_abn := regexp_replace(coalesce(v_c.abn, ''), '\s', '', 'g');
  if coalesce(trim(v_c.company_name), '') = '' then v_missing := v_missing || 'company_name'; end if;
  if v_abn !~ '^[0-9]{11}$' then v_missing := v_missing || 'abn'; end if;
  if coalesce(trim(v_c.address), '') = '' then v_missing := v_missing || 'address'; end if;
  if array_length(v_missing, 1) > 0 then return jsonb_build_object('status', 'error', 'reason', 'profile_incomplete', 'missing', to_jsonb(v_missing)); end if;

  v_cur := public.agreement_current_version();
  if v_cur is null then return jsonb_build_object('status', 'error', 'reason', 'no_version'); end if;
  if p_version is distinct from v_cur then return jsonb_build_object('status', 'error', 'reason', 'wrong_version', 'current', v_cur); end if;

  v_name := trim(coalesce(p_signed_name, ''));
  if length(v_name) < 2 or length(v_name) > 120 then return jsonb_build_object('status', 'error', 'reason', 'bad_name'); end if;
  if coalesce(p_signature_path, '') !~ ('^' || v_cid::text || '/agreements/signature-[0-9a-f-]{36}\.png$') then return jsonb_build_object('status', 'error', 'reason', 'bad_signature'); end if;
  if coalesce(p_body_sha256, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'error', 'reason', 'bad_hash'); end if;

  begin v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet; exception when others then v_ip := null; end;
  v_rules := public.agreement_rules();
  v_warn := coalesce((v_rules->>'renewalWarnDays')::integer, 30);
  v_signed_on := public.agreement_melbourne_date(now());

  select * into v_prev from public.contractor_agreements where contractor_id = v_cid and status = 'signed';
  if found and v_prev.version = p_version and (v_prev.expires_on is null or v_prev.expires_on - v_warn > v_signed_on) then
    return jsonb_build_object('status', 'exists', 'id', v_prev.id, 'expires_on', v_prev.expires_on);
  end if;
  select t.commencement_on, t.expires_on into v_comm, v_exp from public.agreement_next_term_of(v_cid) t;

  v_merged := jsonb_build_object(
    'contractor.company_name', trim(v_c.company_name),
    'contractor.abn', substr(v_abn, 1, 2) || ' ' || substr(v_abn, 3, 3) || ' ' || substr(v_abn, 6, 3) || ' ' || substr(v_abn, 9, 3),
    'contractor.address', trim(v_c.address),
    'contractor.signed_name', v_name,
    'contractor.signed_on', v_signed_on,
    'company.signatory_name', coalesce(v_rules->>'signatoryName', 'Tom Roman') || ', ' || coalesce(v_rules->>'signatoryTitle', 'Director'),
    'company.signed_on', v_signed_on,
    'agreement.signed_on', v_signed_on,
    'agreement.commencement_on', v_comm,
    'agreement.expires_on', v_exp,
    'gst_registered', coalesce(v_c.gst_registered, false));

  update public.contractor_agreements set status = 'superseded' where contractor_id = v_cid and status = 'signed';
  insert into public.contractor_agreements (contractor_id, version, source, status, merged, signed_name, signature, signed_at, signed_ip, signed_user_agent, body_sha256,
                                            countersigned_name, countersigned_at, commencement_on, expires_on)
  values (v_cid, p_version, 'portal', 'signed', v_merged, v_name, p_signature_path, now(), v_ip, left(coalesce(p_user_agent, ''), 400), p_body_sha256,
          v_merged->>'company.signatory_name', now(), v_comm, v_exp)
  returning id into v_id;
  insert into public.contractor_documents (contractor_id, kind, name, file_url, status, verified_at, verify_note, contractor_agreement_id)
  values (v_cid, 'agreement', 'Subcontractor agreement - Version ' || p_version::text, '', 'valid', now(), 'Signed in the portal', v_id);
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (v_cid, 'agreement_signed', jsonb_build_object('agreement_id', v_id, 'version', p_version, 'signed_name', v_name, 'expires_on', v_exp, 'renewal', v_prev.id is not null), auth.uid());
  return jsonb_build_object('status', 'ok', 'id', v_id, 'merged', v_merged, 'expires_on', v_exp);
end $$;
revoke all on function public.agreement_sign(integer, text, text, text, text, text) from public, anon;
grant execute on function public.agreement_sign(integer, text, text, text, text, text) to authenticated;

-- ---- 6. the server attaches the rendered PDF, once -------------------------------------------
create or replace function public.agreement_attach_pdf(p_agreement_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.contractor_agreements%rowtype;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then return 'error:not_staff'; end if;
  if coalesce(trim(p_path), '') = '' then return 'error:bad_path'; end if;
  select * into v from public.contractor_agreements where id = p_agreement_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status not in ('signed', 'superseded') then return 'error:not_signed'; end if;
  if v.pdf_path is not null then return 'error:pdf_immutable'; end if;
  update public.contractor_agreements set pdf_path = trim(p_path) where id = p_agreement_id;
  update public.contractor_documents set file_url = trim(p_path) where contractor_agreement_id = p_agreement_id and file_url = '';
  return 'ok:attached';
end $$;
revoke all on function public.agreement_attach_pdf(uuid, text) from public, anon;
grant execute on function public.agreement_attach_pdf(uuid, text) to authenticated, service_role;

-- ---- 7. staff upload a signed paper copy ---------------------------------------------------
create or replace function public.agreement_upload(p_contractor_id uuid, p_file_path text, p_signed_on date, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rules jsonb; v_months integer; v_exp date; v_id uuid; v_prev uuid;
begin
  if not public.is_staff() then return jsonb_build_object('status', 'error', 'reason', 'not_staff'); end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  if coalesce(p_file_path, '') !~ ('^' || p_contractor_id::text || '/agreements/upload-[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$') then return jsonb_build_object('status', 'error', 'reason', 'bad_path'); end if;
  if p_signed_on is null or p_signed_on > public.agreement_melbourne_date(now()) then return jsonb_build_object('status', 'error', 'reason', 'bad_date'); end if;
  if p_version is not null and not exists (select 1 from public.agreement_versions where version = p_version) then return jsonb_build_object('status', 'error', 'reason', 'bad_version'); end if;
  v_rules := public.agreement_rules();
  v_months := coalesce((v_rules->>'termMonths')::integer, 12);
  v_exp := p_signed_on + make_interval(months => v_months);
  select id into v_prev from public.contractor_agreements where contractor_id = p_contractor_id and status = 'signed';
  update public.contractor_agreements set status = 'superseded' where contractor_id = p_contractor_id and status = 'signed';
  insert into public.contractor_agreements (contractor_id, version, source, status, signed_at, pdf_path, commencement_on, expires_on, uploaded_by, uploaded_at)
  values (p_contractor_id, p_version, 'uploaded', 'signed', (p_signed_on::timestamp + interval '12 hours') at time zone 'Australia/Melbourne', trim(p_file_path), p_signed_on, v_exp, auth.uid(), now())
  returning id into v_id;
  insert into public.contractor_documents (contractor_id, kind, name, file_url, status, verified_at, verify_note, contractor_agreement_id)
  values (p_contractor_id, 'agreement', 'Subcontractor agreement - signed on paper ' || to_char(p_signed_on, 'DD Mon YYYY'), trim(p_file_path), 'valid', now(), 'Uploaded by the office', v_id);
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (p_contractor_id, 'agreement_uploaded', jsonb_build_object('agreement_id', v_id, 'version', p_version, 'signed_on', p_signed_on, 'expires_on', v_exp, 'superseded', v_prev), auth.uid());
  return jsonb_build_object('status', 'ok', 'id', v_id, 'expires_on', v_exp);
end $$;
revoke all on function public.agreement_upload(uuid, text, date, integer) from public, anon;
grant execute on function public.agreement_upload(uuid, text, date, integer) to authenticated;

-- ---- 8. staff ask an existing contractor to sign (the grace window starts, ruling 14) -------
create or replace function public.agreement_request(p_contractor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days integer; v_at timestamptz := now(); v_grace timestamptz;
begin
  if not public.is_staff() then return jsonb_build_object('status', 'error', 'reason', 'not_staff'); end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  if exists (select 1 from public.contractor_agreements where contractor_id = p_contractor_id and status = 'signed' and (expires_on is null or expires_on >= public.agreement_melbourne_date(now()))) then
    return jsonb_build_object('status', 'error', 'reason', 'already_signed');
  end if;
  v_days := coalesce((public.agreement_rules()->>'graceDays')::integer, 14);
  v_grace := v_at + make_interval(days => v_days);
  update public.contractors set agreement_requested_at = v_at, agreement_grace_until = v_grace where id = p_contractor_id;
  insert into public.contractor_events (contractor_id, type, detail, actor)
  values (p_contractor_id, 'agreement_requested', jsonb_build_object('requested_at', v_at, 'grace_until', v_grace), auth.uid());
  return jsonb_build_object('status', 'ok', 'requested_at', v_at, 'grace_until', v_grace);
end $$;
revoke all on function public.agreement_request(uuid) from public, anon;
grant execute on function public.agreement_request(uuid) to authenticated;

-- ---- 9. the status a screen reads ------------------------------------------------------------
create or replace function public.agreement_status_of(p_contractor_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c public.contractors%rowtype; v_signed jsonb; v_history jsonb;
begin
  select * into v_c from public.contractors where id = p_contractor_id;
  if not found then return null; end if;
  select jsonb_build_object('id', a.id, 'version', a.version, 'source', a.source, 'signed_at', a.signed_at, 'signed_name', a.signed_name,
                            'commencement_on', a.commencement_on, 'expires_on', a.expires_on, 'pdf_path', a.pdf_path, 'countersigned_at', a.countersigned_at)
    into v_signed from public.contractor_agreements a where a.contractor_id = p_contractor_id and a.status = 'signed';
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'version', a.version, 'source', a.source, 'status', a.status, 'signed_at', a.signed_at,
                                               'expires_on', a.expires_on, 'pdf_path', a.pdf_path) order by a.signed_at desc), '[]'::jsonb)
    into v_history from public.contractor_agreements a where a.contractor_id = p_contractor_id and a.status in ('signed', 'superseded');
  return jsonb_build_object(
    'kind', v_c.agreement_kind, 'gate', public.agreement_gate_of(p_contractor_id),
    'current_version', public.agreement_current_version(),
    'requested_at', v_c.agreement_requested_at, 'grace_until', v_c.agreement_grace_until,
    'commencement_on', (select t.commencement_on from public.agreement_next_term_of(p_contractor_id) t),
    'next_expires_on', (select t.expires_on from public.agreement_next_term_of(p_contractor_id) t),
    'renewal_warn_days', coalesce((public.agreement_rules()->>'renewalWarnDays')::integer, 30),
    'signed', v_signed, 'history', v_history);
end $$;

-- A contractor asks about themselves; staff ask about anyone.
create or replace function public.agreement_status(p_contractor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := coalesce(p_contractor_id, public.current_contractor_id());
  if v_cid is null then return null; end if;
  if not (public.is_staff() or v_cid = public.current_contractor_id()) then return null; end if;
  return public.agreement_status_of(v_cid);
end $$;
revoke all on function public.agreement_status(uuid) from public, anon;
grant execute on function public.agreement_status(uuid) to authenticated;

-- Every contractor at once, for the Contractors list, the dashboard tile and the work queue.
create or replace function public.agreement_statuses()
returns table (contractor_id uuid, kind text, gate text, agreement_id uuid, version integer, source text, signed_at timestamptz,
               expires_on date, pdf_path text, requested_at timestamptz, grace_until timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.agreement_kind, public.agreement_gate_of(c.id), a.id, a.version, a.source, a.signed_at, a.expires_on, a.pdf_path,
         c.agreement_requested_at, c.agreement_grace_until
    from public.contractors c
    left join public.contractor_agreements a on a.contractor_id = c.id and a.status = 'signed'
   where c.profile_id is not null and (public.is_staff() or auth.role() = 'service_role')
$$;
revoke all on function public.agreement_statuses() from public, anon;
grant execute on function public.agreement_statuses() to authenticated;

-- ---- 10. read-back: compare each column to its _expect_ twin before calling this live -------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'contractor_agreements') as tables, 1 as _expect_tables,
  (select relrowsecurity from pg_class where oid = 'public.contractor_agreements'::regclass) as rls_on, true as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'contractor_agreements') as policies, 1 as _expect_policies,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'contractor_doc_kind' and e.enumlabel = 'agreement') as enum_value, true as _expect_enum_value,
  (select count(*) from information_schema.columns where table_name = 'contractors' and column_name in ('agreement_kind', 'agreement_requested_at', 'agreement_grace_until')) as contractor_columns, 3 as _expect_contractor_columns,
  (select count(*) from information_schema.columns where table_name = 'contractor_documents' and column_name = 'contractor_agreement_id') as document_column, 1 as _expect_document_column,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('agreement_rules','agreement_melbourne_date','agreement_commencement_of','agreement_next_term_of','agreement_gate_of','agreement_sign','agreement_attach_pdf','agreement_upload','agreement_request','agreement_status_of','agreement_status','agreement_statuses')) as functions, 12 as _expect_functions,
  has_function_privilege('authenticated', 'public.agreement_sign(integer, text, text, text, text, text)', 'execute') as sign_callable, true as _expect_sign_callable,
  has_function_privilege('authenticated', 'public.agreement_gate_of(uuid)', 'execute') as gate_by_session, false as _expect_gate_by_session,
  has_function_privilege('authenticated', 'public.agreement_status_of(uuid)', 'execute') as status_of_by_session, false as _expect_status_of_by_session,
  has_table_privilege('authenticated', 'public.contractor_agreements', 'insert') as authenticated_inserts, false as _expect_authenticated_inserts,
  (select count(*) from public.settings where key = 'agreement_rules') as rules_row, 1 as _expect_rules_row,
  (select count(*) from public.contractors where agreement_kind = 'existing') as existing_contractors,
  (select count(*) from public.contractors where agreement_kind = 'new') as new_contractors;

insert into public._prod_migrations(name) values ('20270285000000_contractor_agreements.sql') on conflict (name) do nothing;
